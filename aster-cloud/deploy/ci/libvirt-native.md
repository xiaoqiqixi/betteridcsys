# Owned native-libvirt software preparation gate

This is a **TCG virtual-machine CI fixture**, not a production installer, Docker
deployment, KVM guest acceptance, or permission to use the finance host. Local
offline contract tests do not establish that a native boot succeeded.

## Entry point and host prerequisites

```sh
python3 -I aster-cloud/deploy/ci/libvirt-native.py \
  --ubuntu 22.04 \
  --source-root "$GITHUB_WORKSPACE" --source-sha "$GITHUB_SHA" \
  --output "$RUNNER_TEMP/cloud-libvirt-native"
python3 -I aster-cloud/deploy/ci/test_libvirt_native.py
```

`--ubuntu` accepts `22.04`, `24.04`, `26.04`. Ubuntu 26.04 runs on an Ubuntu
24.04 host runner. The host must be non-root Linux amd64, with Go **1.27.3**,
Python 3.10+, `qemu-system-x86_64`, `qemu-img`, `cloud-localds`, `gpg`, `gpgv`,
`ip`, and an existing read-only firewall inspection tool (`nft`, otherwise both
`iptables-save`/`ip6tables-save`). Only the read-only firewall dump uses `sudo -n`.
The harness never installs a firewall or libvirt daemon on the host, purges host
packages, modifies host NICs/routes, or stops host services. No Node/npm is needed.

## Image and execution trust

- Images use **dated** Canonical cloud-image directories: Jammy `20261020`, Noble
  `20261017`, Resolute `20261016`; full image SHA256 values are pinned in code.
  Neither `current`, `release`, nor `latest` is used for image resolution.
- The vendored **public** UEC image key is independently pinned by complete-file
  SHA256 and primary fingerprint
  `D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81`. An isolated GnuPG home plus `gpgv`
  verifies the signed SHA256SUMS before image bytes are accepted. HTTPS verification
  stays on and redirects cannot leave the fixed cloud-image origin.
- QEMU is unprivileged, **TCG only**, with `max,vmx=off,svm=off`, 3GiB RAM, its
  own qcow2 overlay, a read-only NoCloud seed, and a read-only raw second drive
  containing the **complete signed original QCOW2 file bytes**. The latter is
  copied and rehashed inside the guest; no fake boot image is generated.
- There is no SSH, host port forwarding, TAP, bridge helper, 9p/host filesystem
  share, or imported repo credentials. Only three fixed files and a real compiled
  `aster-node` enter the seed. Subprocess environments exclude inherited tokens.
- User networking has `restrict=on`. Two fixed guest forwarding rules provide
  TLS-transparent TCP relays solely to public IPv4 addresses of
  `archive.ubuntu.com:443` and `security.ubuntu.com:443`. Guest `/etc/hosts` maps
  these names to the two virtual forwarding endpoints. APT still verifies the
  original TLS hostname and signed Ubuntu metadata; there is no generic proxy,
  TLS interception, or arbitrary host/metadata access.

## Actual acceptance contract

The official guest must start with no pre-existing MySQL/libvirt workload. If it
does not, the gate fails; it never deletes a pre-existing workload to make the
fixture appear fresh. In this owned guest only, background apt/SSH units are
disabled to avoid unrelated timer races and unintended login listeners.

The guest invokes the production
`prepare_libvirt(root_private_state, resume=False)` and its explicit resume path,
without mocks or a production safety bypass. It requires real APT installation,
real PID-1 systemd, active owned libvirt/log/lock units, persistent vendor-unit
masks, an effective read-only empty-network mount in the daemon namespace,
real Unix-socket `virsh qemu:///system` queries/capabilities, no visible default
network, and no `virbr` interface. Official package-created on-disk default XML
may remain, but the owned daemon must not see or activate it.

The node config uses a real signed Canonical image, its exact whole-file hash,
real ephemeral CA/server/client certificates, protected paths, and valid bounded
allocation settings. **Any doctor nonzero exit is not enough.** Its actual JSON
must identify this node and protocol, include every expected doctor check,
explicitly fail `dev_kvm_read_write`, and pass all non-KVM prerequisites. A
configuration rejection, missing binary, unavailable libvirt, missing image or
bad storage path cannot be counted as a KVM-denial success. `/dev/kvm` is never
fabricated. `kvm_ready` must remain false.

## Bounded cleanup and public evidence

The output directory is new/0700 for each invocation. Owned subprocess groups
use `start_new_session`; deadline, interruption and exception cleanup target only
their original child group, TERM then bounded KILL. VM runtime is bounded to
20 minutes. Private serial/seed/disks/build scratch are removed. Host address,
route and firewall rule structures are compared before/after; dynamic counters
and lifetimes are excluded, not policy content.

Only upload `summary.json`, `guest-report.json`, `image-provenance.json`. **Never
upload serial logs, cloud-init logs, seed data, private keys or raw syslogs.** A
passing summary binds `ubuntu`, `source_sha`, `image_sha256`, `real_apt:true`,
`real_systemd:true`, `libvirt_prepared:true`, `kvm_ready:false`. Failure/missing
proof is a hard failure, never a skipped or claimed KVM-ready result.

Failed guest reports expose only fixed `phase`/`code` enums and a small optional
`diagnostics` object: up to four fixed failed-command categories, whitelisted
dependency/libvirt receipt statuses, and whitelisted completed-step names.
The command observer transparently calls the original production `run_fixed`
with unchanged arguments, results and exceptions. It does not export command
arguments/output, paths, policy nonces, receipt bodies or keys. The host filters
failure reports before export and fully validates successful reports before
writing them; a forged nested value cannot enter a public artifact. APT
update/simulation/install, systemd start, and mount-isolation failures therefore
remain distinguishable without uploading raw guest logs. Relays exit when their
QEMU input pipe closes rather than lingering on a remote HTTP keep-alive.

## Primary sources and remaining validation

- [Canonical released image directories](https://cloud-images.ubuntu.com/releases/)
- [Canonical public-images verification guidance and UEC fingerprint](https://documentation.ubuntu.com/_/downloads/public-images/en/latest/pdf/)
- [QEMU user-network restriction and guest forwarding](https://www.qemu.org/docs/master/system/invocation.html)
- [NoCloud local seed datasource](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html)
- [QEMU 8.2 TCG CPU feature implementation](https://raw.githubusercontent.com/qemu/qemu/v8.2.0/target/i386/cpu.c)
- [Ubuntu architecture variants](https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/supported-architectures/)

QEMU 8.2 source includes TCG AVX/F16C/FMA and AVX2/BMI support, making the 26.04
`max` CPU choice source-supported. This is **not a successful 26.04 boot record**;
the actual required native job must pass before claiming that guest accepted.
None of these tests establishes real KVM creation, physical guest networking,
controller admission, provider ownership, or production-host installation.

## 首次 native CI 失败与诊断修正

`766c055` 的三份 Ubuntu 镜像均实际通过签名与完整 SHA256 校验，不能因此称安装成功。
24.04 / 26.04 在真实 APT simulate 失败，只有 owned policy-created，尚未安装 libvirt；
22.04 在固定 1200 秒 VM deadline 退出，没有收到最终 guest report。原始脱敏结果保存在该 CI artifact。

后续 fixture 不延长超时、不重试包安装、不把失败改成 SKIP。增加只含固定阶段 / 命令类别
start-done-failed 与秒数的 serial 心跳；原始 serial、stdout/stderr、nonce、路径和秘密不上传。
收到最终 report 即先做绑定 / 完整 schema 校验并保存，避免关机超时丢失已经产生的诊断；
超时仍失败，不能因 report 存在就通过。失败 report 不再误套成功 schema。

宿主网络仍逐项比较真实地址、路由与规则。只略去 IP 运行期 lifetime / last-use 与 nft
**counter 对象内部**的 packets/bytes；限额、规则字段中的 bytes/rate 必须保留，不能通用删键。
失败摘要另给固定 category、schema field path 和各部分 SHA256，不输出地址 / 链名 / 规则值。
任何结构变化仍 hard-fail，不把未知 runner 变化推定为无害。

APT 错误只接收 production `ProvisionError.code` 的固定白名单，未知错误仍拒绝；
新增分类不放宽正式验证或变更执行器的原调用、返回值和异常。所有离线合同是模型回归，
需下一精确 main SHA 的三套真实 Ubuntu CI 重新验收。
