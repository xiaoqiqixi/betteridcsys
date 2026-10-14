#!/usr/bin/env python3
"""Binary-only core/plugin publication checks; all GitHub operations are mocked."""
import base64
import copy
from pathlib import Path
import unittest
from unittest import mock
from test_release_pipeline import (
    pipeline, flow_fixture, SHA, DEFAULT_SHA, PREFIX, RELEASE_ID, RUN_ID,
    json_bytes, tar_bytes, zip_bytes, refresh_checksums, git_blob_sha,
)


def elf_bytes():
    data = bytearray(120)
    data[:7] = b'\x7fELF\x02\x01\x01'
    data[16:18] = (2).to_bytes(2, 'little')
    data[18:20] = (62).to_bytes(2, 'little')
    data[20:24] = (1).to_bytes(4, 'little')
    data[24:32] = (0x400040).to_bytes(8, 'little')
    data[52:54] = (64).to_bytes(2, 'little')
    data[32:40] = (64).to_bytes(8, 'little')
    data[54:56] = (56).to_bytes(2, 'little')
    data[56:58] = (1).to_bytes(2, 'little')
    data[64:68] = (1).to_bytes(4, 'little')
    data[68:72] = (5).to_bytes(4, 'little')
    data[80:88] = (0x400000).to_bytes(8, 'little')
    data[96:104] = (len(data)).to_bytes(8, 'little')
    data[104:112] = (len(data)).to_bytes(8, 'little')
    data[112:120] = (4096).to_bytes(8, 'little')
    return bytes(data)


def runtime_fixture(kind='core', binary_override=None, build_override=None):
    version = '0.4.0' if kind == 'core' else '1.0.0'
    tag = ('v' if kind == 'core' else 'smtp-v') + version
    root = ('aster' if kind == 'core' else 'aster-smtp') + '-' + version + '-linux-amd64'
    license_bytes = (Path(__file__).resolve().parents[3] / 'LICENSE').read_bytes()
    inputs = {path: ('input fixture ' + path + '\n').encode() for path in pipeline.CURRENT_INPUT_PATHS}
    inputs.update({'LICENSE': license_bytes, 'README.md': '# updated repository README\n'.encode(),
                   'vps-billing/backend/pkg/pluginapi/protocol.go': b'package pluginapi\nconst CoreVersion = "0.4.0"\n',
                   'vps-billing/backend/plugins/smtp/VERSION': b'1.0.0\n'})
    copies = {'LICENSE': 'LICENSE'}
    binaries = {'bin/aster-api': elf_bytes(), 'bin/aster-plugin-host': elf_bytes()} if kind == 'core' else {'plugin': elf_bytes()}
    bundle = {'LICENSE': license_bytes, **binaries}
    if kind == 'core':
        copies.update({'REPOSITORY-README.md': 'README.md', 'PROJECT-README.md': 'vps-billing/README.md'})
        for path in pipeline.CORE_DEPLOY_FILES:
            copies[path] = 'vps-billing/' + path
            inputs.setdefault('vps-billing/' + path, ('deployed input ' + path + '\n').encode())
        for source in pipeline.INPUT_PATHS[2:]:
            copies['manifests/' + source.rsplit('/', 1)[-1]] = source
        inputs['vps-billing/README.md'] = b'# project fixture\n'
        bundle.update({path: inputs[source] for path, source in copies.items()})
        bundle.update({'web/index.html': b'<!doctype html><title>core fixture</title>',
                       'manifests/go-dependencies.json': b'[]\n',
                       'manifests/npm-installed-dependencies.json': b'[]\n',
                       'manifests/aster-api-build.txt': b'aster-api: fixture\n',
                       'manifests/aster-plugin-host-build.txt': b'aster-plugin-host: fixture\n'})
    else:
        copies["README.md"] = "vps-billing/backend/plugins/smtp/README.md"
        inputs[copies["README.md"]] = b"# independent SMTP fixture\n"
        notice = b'Original Go runtime license fixture\n'
        bundle.update({'manifest.json': json_bytes({'schema': 1, 'id': 'email.smtp', 'version': version,
                        'protocol': 'aster.smtp/1', 'core_min': '0.4.0', 'core_max_exclusive': '0.5.0',
                        'capabilities': ['smtp.send'], 'executable': 'plugin', 'sha256': pipeline.sha256(bundle['plugin'])}),
                       'README.md': b'# independent SMTP fixture\n',
                       'THIRD_PARTY_NOTICES.json': json_bytes({'schema': 1, 'notices': [{'path': 'go-runtime/LICENSE',
                       'sha256': pipeline.sha256(notice), 'text': notice.decode()}]})})
        bundle['SHA256SUMS'] = ''.join(pipeline.sha256(data) + '  ' + name + '\n' for name, data in sorted(bundle.items())).encode()
    build = {'schema': 2, 'release_kind': kind, 'release_label': version, 'source_commit': SHA,
             'source_date_epoch': 1791936000, 'target': 'linux/amd64', 'cgo_enabled': False,
             'component_versions': {'core': '0.4.0', 'smtp': '1.0.0'}, 'plugin_protocol': 'aster.smtp/1',
             'smtp_core_compatibility': {'min': '0.4.0', 'max_exclusive': '0.5.0'},
             'input_sha256': {path: pipeline.sha256(inputs[path]) for path in pipeline.CURRENT_INPUT_PATHS},
             'source_files': copies, 'binary_sha256': {path: pipeline.sha256(data) for path, data in binaries.items()}}
    build.update(build_override or {})
    build_raw = json_bytes(build)
    if kind == 'core':
        bundle['manifests/BUILD.json'] = build_raw
    bundle.update(binary_override or {})
    # Helper defaults chmod only aster-api; set explicit modes for each runtime binary/script.
    import io, tarfile
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz', format=tarfile.GNU_FORMAT) as archive:
        for name, data in sorted(bundle.items()):
            item = tarfile.TarInfo(root + '/' + name)
            item.mode = 0o755 if name in set(binaries) | {'deploy/scripts/plugin-manager.py', 'deploy/scripts/backup-native.sh'} else 0o644
            item.size = len(data)
            archive.addfile(item, io.BytesIO(data))
    files = refresh_checksums({'BUILD.json': build_raw, root + '.tar.gz': output.getvalue()})
    return tag, version, files, inputs, bundle


def normal_flow(kind='core'):
    api, env, event, policy, _, _ = flow_fixture()
    tag, version, files, inputs, _ = runtime_fixture(kind)
    run = api.responses[('GET', PREFIX + f'/actions/runs/{RUN_ID}')]
    old_tag = run['head_branch']
    run['head_branch'] = tag
    event['workflow_run']['head_branch'] = tag
    api.responses[('GET', PREFIX + '/git/ref/tags/' + tag)] = {'ref': 'refs/tags/' + tag, 'object': {'type': 'commit', 'sha': SHA}}
    api.responses[('GET', PREFIX + '/releases/tags/' + tag)] = pipeline.APIError(404)
    for commit in (SHA, DEFAULT_SHA):
        tree = api.responses[('GET', PREFIX + f'/git/trees/{commit}?recursive=1')]
        tree['tree'] = [item for item in tree['tree'] if item['path'] not in inputs]
        tree['tree'].extend({'path': path, 'sha': git_blob_sha(data), 'type': 'blob', 'mode': '100644', 'size': len(data)} for path, data in inputs.items())
    for path in pipeline.CURRENT_INPUT_PATHS:
        data = inputs[path]; digest = git_blob_sha(data)
        api.responses[('GET', PREFIX + '/git/blobs/' + digest)] = {'sha': digest, 'size': len(data), 'encoding': 'base64', 'content': base64.b64encode(data).decode()}
    policy.update(tag=tag, version=version, trusted_blobs=pipeline.trusted_blobs(api, SHA))
    files['PROVENANCE.json'] = json_bytes(dict(policy, assets={name: meta for name, meta in pipeline.validate_package(files, SHA, version, kind).items() if name != 'SHA256SUMS'}))
    files['SHA256SUMS'] = ''.join(pipeline.sha256(data) + '  ' + name + '\n' for name, data in sorted(files.items()) if name != 'SHA256SUMS').encode()
    archive = zip_bytes(files)
    artifact = api.responses[('GET', PREFIX + f'/actions/runs/{RUN_ID}/artifacts?per_page=100&page=1')]['artifacts'][0]
    artifact.update(size_in_bytes=len(archive), digest='sha256:' + pipeline.sha256(archive))
    draft = api.responses[('GET', PREFIX + f'/releases/{RELEASE_ID}')]
    draft.update(tag_name=tag, prerelease=False)
    api.responses[('POST', PREFIX + '/releases')].update(tag_name=tag, prerelease=False)
    api.responses[('GET', PREFIX + '/releases/latest')] = {'id': 12345} if kind == 'smtp' else {'id': RELEASE_ID}
    def publication(data):
        draft.update(draft=data['draft'], prerelease=data['prerelease'])
        return draft
    api.responses[('PATCH', PREFIX + f'/releases/{RELEASE_ID}')] = publication
    return api, env, event, files, archive, kind, version


class RuntimeReleaseTests(unittest.TestCase):
    def test_core_and_smtp_are_independent_binary_only_packages(self):
        for kind in ('core', 'smtp'):
            _, version, files, _, _ = runtime_fixture(kind)
            with self.subTest(kind=kind):
                self.assertEqual(len(files), 3)
                self.assertFalse(any('source.tar.gz' in name for name in files))
                self.assertEqual(set(pipeline.validate_package(files, SHA, version, kind)), set(files))

    def test_new_main_readme_is_bound_to_selected_git_not_old_baseline(self):
        api, env, event, files, _, _, _ = normal_flow()
        policy = pipeline.prepare_publish(api, env, event)
        pipeline.verify_provenance(files, policy, api)
        self.assertFalse(api.mutations)

    def test_source_input_hashes_and_declared_versions_must_match_git(self):
        for change in ('blob', 'version', 'readme'):
            api, env, event, files, _, _, _ = normal_flow()
            policy = pipeline.prepare_publish(api, env, event)
            if change == 'blob':
                key = next(key for key in api.responses if key[1].startswith(PREFIX + '/git/blobs/'))
                api.responses[key]['content'] = base64.b64encode(b'changed').decode()
            elif change == 'version':
                build = pipeline.strict_json(files['BUILD.json']); build['component_versions']['core'] = '0.4.1'
                files['BUILD.json'] = json_bytes(build)
            else:
                tree = api.responses[('GET', PREFIX + f'/git/trees/{SHA}?recursive=1')]
                next(item for item in tree['tree'] if item['path'] == 'README.md')['sha'] = 'f' * 40
            with self.subTest(change=change), self.assertRaises(pipeline.GuardError):
                pipeline.verify_provenance(files, policy, api)
            self.assertFalse(api.mutations)

    def test_runtime_manifest_core_hash_and_missing_host_are_rejected(self):
        for override in ({'schema': True}, {'release_kind': 'smtp'}, {'component_versions': {'core': '0.5.0', 'smtp': '1.0.0'}}, {'binary_sha256': {'bin/aster-api': '0' * 64}}, {'input_sha256': {}}):
            _, version, files, _, _ = runtime_fixture(build_override=override)
            with self.subTest(override=override), self.assertRaises(pipeline.GuardError):
                pipeline.validate_package(files, SHA, version)
        _, version, files, _, _ = runtime_fixture(binary_override={'bin/aster-plugin-host': b'not an executable'})
        with self.assertRaises(pipeline.GuardError): pipeline.validate_package(files, SHA, version)

    def test_smtp_fixed_inventory_manifest_inner_hash_and_notice_text_are_enforced(self):
        for path, data in (('unknown.go', b'package fixture'), ('plugin', b'not ELF'), ('manifest.json', b'{}'), ('SHA256SUMS', b''), ('THIRD_PARTY_NOTICES.json', b'{"schema":1,"notices":[]}')):
            _, version, files, _, _ = runtime_fixture('smtp', binary_override={path: data})
            with self.subTest(path=path), self.assertRaises(pipeline.GuardError):
                pipeline.validate_package(files, SHA, version, 'smtp')

    def test_each_normal_release_uploads_four_verified_assets_then_publishes_once(self):
        for kind in ('core', 'smtp'):
            api, env, event, files, archive, _, _ = normal_flow(kind)
            policy = pipeline.prepare_publish(api, env, event)
            self.assertEqual(pipeline.publish(api, policy, archive), RELEASE_ID)
            self.assertEqual(len(api.uploads), 4)
            self.assertEqual([call[0] for call in api.mutations], ['POST', 'PATCH'])
            self.assertIs(api.mutations[0][2]['draft'], True)
            self.assertIs(api.mutations[0][2]['prerelease'], False)
            self.assertEqual(api.mutations[-1][2], {'draft': False, 'prerelease': False, 'make_latest': 'true' if kind == 'core' else 'false'})
            self.assertEqual({name: data for _, name, data in api.uploads}, files)

    def test_sealing_checksums_cover_provenance_without_a_hash_cycle(self):
        import tempfile
        _, version, files, _, _ = runtime_fixture()
        api, _, _, policy, _, _ = flow_fixture()
        policy.update(tag="v" + version, version=version)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name, data in files.items(): (directory / name).write_bytes(data)
            provenance = pipeline.seal_build(policy, directory)
            self.assertNotIn("SHA256SUMS", provenance["assets"])
            final = {path.name: path.read_bytes() for path in directory.iterdir()}
            covered = pipeline.checksum_inventory(final["SHA256SUMS"], {"BUILD.json", "PROVENANCE.json", "aster-0.4.0-linux-amd64.tar.gz"})
            self.assertTrue(all(pipeline.sha256(final[name]) == digest for name, digest in covered.items()))
            pipeline.validate_package({k: v for k, v in final.items() if k != "PROVENANCE.json"}, SHA, version, "core", final["PROVENANCE.json"])

    def test_partial_upload_never_reaches_public_patch(self):
        api, env, event, _, archive, _, _ = normal_flow()
        policy = pipeline.prepare_publish(api, env, event); api.fail_upload_number = 2
        with self.assertRaises(pipeline.GuardError): pipeline.publish(api, policy, archive)
        self.assertEqual([call[0] for call in api.mutations], ['POST'])
        self.assertIs(api.responses[('GET', PREFIX + f'/releases/{RELEASE_ID}')]['draft'], True)

    def test_uncertain_publication_not_retried_or_claimed_as_success(self):
        api, env, event, _, archive, _, _ = normal_flow()
        policy = pipeline.prepare_publish(api, env, event)
        api.responses[('PATCH', PREFIX + f'/releases/{RELEASE_ID}')] = pipeline.GuardError('synthetic uncertain outcome')
        with self.assertRaisesRegex(pipeline.GuardError, 'uncertain'):
            pipeline.publish(api, policy, archive)
        self.assertEqual([call[0] for call in api.mutations], ['POST', 'PATCH'])

    def test_plugin_cannot_take_over_latest_core(self):
        api, env, event, _, archive, _, _ = normal_flow('smtp')
        policy = pipeline.prepare_publish(api, env, event)
        original = api.responses[('PATCH', PREFIX + f'/releases/{RELEASE_ID}')]
        def wrong_latest(data):
            result = original(data); api.responses[('GET', PREFIX + '/releases/latest')] = {'id': RELEASE_ID}; return result
        api.responses[('PATCH', PREFIX + f'/releases/{RELEASE_ID}')] = wrong_latest
        with self.assertRaisesRegex(pipeline.GuardError, 'latest-release'):
            pipeline.publish(api, policy, archive)

    def test_transport_patch_only_changes_newly_created_release_public_state(self):
        api = pipeline.GitHub('fixture-token')
        api.created_releases.add(RELEASE_ID)
        body = {'draft': False, 'prerelease': False, 'make_latest': 'true'}
        for path, fields in ((PREFIX + '/releases/123', body), (PREFIX + f'/releases/{RELEASE_ID}', dict(body, body='edit history')), (PREFIX + f'/releases/{RELEASE_ID}', dict(body, draft=True)), (PREFIX + f'/releases/{RELEASE_ID}', dict(body, make_latest='legacy'))):
            with self.subTest(path=path, fields=fields), mock.patch.object(api, '_open') as opened, self.assertRaises(pipeline.GuardError):
                api.request('PATCH', path, data=fields)
            opened.assert_not_called()
        with mock.patch.object(api, '_open', return_value=(200, {}, b'{"id":900}')) as opened:
            self.assertEqual(api.request('PATCH', PREFIX + f'/releases/{RELEASE_ID}', data=body), {'id': RELEASE_ID})
            self.assertEqual(opened.call_count, 1)


if __name__ == '__main__': unittest.main()
