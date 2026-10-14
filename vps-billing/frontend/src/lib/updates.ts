import { ApiError } from "./api";
import { tr } from "./i18n";

export const officialRepository = "xiaoqiqixi/betteridcsys";
export type UpdateComponent = "core" | "smtp";
export type PluginStatus =
  "not_installed" | "disabled" | "unavailable" | "approved";
export interface UpdateAsset {
  name: string;
  id: number;
  size: number;
  sha256: string;
}
export interface UpdateCandidate {
  component: UpdateComponent;
  tag: string;
  version: string;
  release_url: string;
  notes: string;
  published_at: string;
  source_sha: string;
  release_id: number;
  run_id: number;
  run_attempt: number;
  compatible: boolean;
  update_available: boolean;
  preconditions: string[];
  assets: UpdateAsset[];
  catalog_sha256: string;
}
export interface UpdateStatus {
  current: {
    core_version: string;
    smtp_version: string;
    smtp_status: PluginStatus;
    plugin_policy_revision: number;
  };
  source: {
    repository: typeof officialRepository;
    status: "not_checked" | "available" | "unavailable";
  };
  checked_at: string;
  items: UpdateCandidate[];
  mode: "manual_host_handoff";
}
export interface UpdateHandoff {
  schema: 1;
  status: "awaiting_host_operator";
  intent: {
    schema: 1;
    request_id: string;
    actor_id: string;
    created_at: string;
    expires_at: string;
    repository: typeof officialRepository;
    repository_id: number;
    component: UpdateComponent;
    tag: string;
    version: string;
    source_sha: string;
    release_id: number;
    run_id: number;
    run_attempt: number;
    current_core_version: string;
    current_plugin_version: string;
    plugin_policy_revision: number;
    assets: UpdateAsset[];
  };
}

const semver =
  /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const bytes = new TextEncoder();
function invalid(): never {
  throw new ApiError(
    "INVALID_UPDATE_RESPONSE",
    tr(
      "版本信息无效，请重新读取。",
      "Invalid version information. Reload and try again.",
    ),
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, multiline = false): string {
  if (
    typeof value !== "string" ||
    bytes.encode(value).length > max ||
    (multiline
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
      : /[\u0000-\u001f\u007f]/
    ).test(value)
  )
    return invalid();
  return value;
}
function version(value: unknown, optional = false): string {
  const result = text(value, 32);
  if (!semver.test(result) && !(optional && result === "")) return invalid();
  return result;
}
function integer(value: unknown, min: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) return invalid();
  return value as number;
}
function timestamp(value: unknown, optional = false): string {
  const result = text(value, 64);
  if (
    result !== "" &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result) ||
      !Number.isFinite(Date.parse(result)))
  )
    return invalid();
  if (!optional && !result) return invalid();
  return result;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}
function hash(value: unknown): string {
  const result = text(value, 64);
  if (!digest.test(result)) return invalid();
  return result;
}
function readAssets(
  value: unknown,
  component: UpdateComponent,
  itemVersion: string,
): UpdateAsset[] {
  if (!Array.isArray(value) || value.length !== 4) return invalid();
  const required = new Set([
    `${component === "core" ? "aster" : "aster-smtp"}-${itemVersion}-linux-amd64.tar.gz`,
    "BUILD.json",
    "PROVENANCE.json",
    "SHA256SUMS",
  ]);
  const result = value.map((entry) => {
    const asset = record(entry);
    const name = text(asset.name, 100);
    if (!required.delete(name)) return invalid();
    const size = integer(asset.size, 1);
    if (size > 512 * 1024 * 1024) return invalid();
    return { name, id: integer(asset.id, 1), size, sha256: hash(asset.sha256) };
  });
  if (
    required.size ||
    new Set(result.map((asset) => asset.id)).size !== result.length
  )
    return invalid();
  return result;
}
export function componentName(component: UpdateComponent): string {
  return component === "core"
    ? tr("核心程序", "Core")
    : tr("SMTP 插件", "SMTP plugin");
}

// The server contacts a fixed official repository. Independently constrain the
// only external link rendered by the browser; release notes remain plain text.
export function readUpdateCandidate(value: unknown): UpdateCandidate {
  const item = record(value);
  if (item.component !== "core" && item.component !== "smtp") return invalid();
  const component = item.component;
  const itemVersion = version(item.version);
  const tag = text(item.tag, 48);
  if (tag !== `${component === "core" ? "v" : "smtp-v"}${itemVersion}`)
    return invalid();
  const releaseURL = text(item.release_url, 180);
  if (
    releaseURL !==
    `https://github.com/${officialRepository}/releases/tag/${tag}`
  )
    return invalid();
  const sourceSHA = text(item.source_sha, 40);
  if (!sha.test(sourceSHA)) return invalid();
  if (!Array.isArray(item.preconditions) || item.preconditions.length > 16)
    return invalid();
  const preconditions = item.preconditions.map((value) => text(value, 256));
  if (new Set(preconditions).size !== preconditions.length) return invalid();
  return {
    component,
    tag,
    version: itemVersion,
    release_url: releaseURL,
    notes: text(item.notes, 16384, true),
    published_at: timestamp(item.published_at),
    source_sha: sourceSHA,
    release_id: integer(item.release_id, 1),
    run_id: integer(item.run_id, 1),
    run_attempt: integer(item.run_attempt, 1),
    compatible: boolean(item.compatible),
    update_available: boolean(item.update_available),
    preconditions,
    assets: readAssets(item.assets, component, itemVersion),
    catalog_sha256: hash(item.catalog_sha256),
  };
}

// A handoff is an unsigned proposal, not permission to install. The host tool
// independently authenticates the fixed official release and checks backups.
export function readUpdateHandoff(
  value: unknown,
  candidate: UpdateCandidate,
  current: UpdateStatus["current"],
): UpdateHandoff {
  const result = record(value);
  const intent = record(result.intent);
  if (
    result.schema !== 1 ||
    result.status !== "awaiting_host_operator" ||
    intent.schema !== 1 ||
    intent.repository !== officialRepository ||
    intent.repository_id !== 1418618420 ||
    intent.component !== candidate.component ||
    intent.tag !== candidate.tag ||
    intent.version !== candidate.version ||
    intent.source_sha !== candidate.source_sha ||
    intent.release_id !== candidate.release_id ||
    intent.run_id !== candidate.run_id ||
    intent.run_attempt !== candidate.run_attempt ||
    intent.current_core_version !== current.core_version ||
    intent.current_plugin_version !== current.smtp_version ||
    intent.plugin_policy_revision !== current.plugin_policy_revision
  )
    return invalid();
  const requestID = text(intent.request_id, 32);
  if (!/^[a-f0-9]{32}$/.test(requestID)) return invalid();
  const actorID = text(intent.actor_id, 128);
  if (!actorID) return invalid();
  const createdAt = timestamp(intent.created_at),
    expiresAt = timestamp(intent.expires_at);
  const lifetime = Date.parse(expiresAt) - Date.parse(createdAt);
  if (lifetime <= 0 || lifetime > 30 * 60 * 1000) return invalid();
  const assets = readAssets(
    intent.assets,
    candidate.component,
    candidate.version,
  );
  const sameAsset = (asset: UpdateAsset) =>
    candidate.assets.some(
      (expected) =>
        expected.name === asset.name &&
        expected.id === asset.id &&
        expected.size === asset.size &&
        expected.sha256 === asset.sha256,
    );
  if (!assets.every(sameAsset)) return invalid();
  return {
    schema: 1,
    status: "awaiting_host_operator",
    intent: {
      schema: 1,
      request_id: requestID,
      actor_id: actorID,
      created_at: createdAt,
      expires_at: expiresAt,
      repository: officialRepository,
      repository_id: 1418618420,
      component: candidate.component,
      tag: candidate.tag,
      version: candidate.version,
      source_sha: candidate.source_sha,
      release_id: candidate.release_id,
      run_id: candidate.run_id,
      run_attempt: candidate.run_attempt,
      current_core_version: current.core_version,
      current_plugin_version: current.smtp_version,
      plugin_policy_revision: current.plugin_policy_revision,
      assets,
    },
  };
}
export function readUpdateStatus(value: unknown): UpdateStatus {
  const result = record(value);
  const current = record(result.current);
  const source = record(result.source);
  if (
    result.mode !== "manual_host_handoff" ||
    source.repository !== officialRepository ||
    !["not_checked", "available", "unavailable"].includes(
      source.status as string,
    ) ||
    !["not_installed", "disabled", "unavailable", "approved"].includes(
      current.smtp_status as string,
    ) ||
    !Array.isArray(result.items) ||
    result.items.length > 2
  )
    return invalid();
  const items = result.items.map(readUpdateCandidate);
  if (new Set(items.map((item) => item.component)).size !== items.length)
    return invalid();
  const checkedAt = timestamp(result.checked_at, true);
  if (source.status === "available" && !checkedAt) return invalid();
  if (source.status === "not_checked" && (checkedAt || items.length))
    return invalid();
  return {
    current: {
      core_version: version(current.core_version),
      smtp_version: version(current.smtp_version, true),
      smtp_status: current.smtp_status as PluginStatus,
      plugin_policy_revision: integer(current.plugin_policy_revision, 0),
    },
    source: {
      repository: officialRepository,
      status: source.status as UpdateStatus["source"]["status"],
    },
    checked_at: checkedAt,
    items,
    mode: "manual_host_handoff",
  };
}
