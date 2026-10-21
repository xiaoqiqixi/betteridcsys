import type {
  NativeOperationView,
  UpdateCandidate,
  UpdateStatus,
} from "../types/idc";
const repo = "xiaoqiqixi/betteridcsys";
const obj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const pos = (v: unknown): v is number => count(v) && v > 0;
const sha = (v: unknown, n: number) =>
  str(v) && new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const version = (v: unknown): v is string =>
  str(v) &&
  /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(v);
/** Validate the date, not only Date.parse's permissive rollover, preserving nanosecond order. */
function utc(v: unknown): bigint | null {
  if (!str(v) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(v))
    return null;
  const ms = Date.parse(v),
    base = v.slice(0, 19),
    fraction = /\.(\d+)Z$/.exec(v)?.[1] || "";
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== base)
    return null;
  return (
    BigInt(Date.parse(base + "Z")) * 1000000n + BigInt(fraction.padEnd(9, "0"))
  );
}
function assetsValid(
  component: string,
  v: string,
  format: string,
  assets: unknown,
): boolean {
  if (!Array.isArray(assets)) return false;
  const base = ["BUILD.json", "PROVENANCE.json", "SHA256SUMS"],
    prefix = component === "core" ? "aster" : "aster-smtp";
  const expected =
    format === "archive-v1"
      ? [...base, `${prefix}-${v}-linux-amd64.tar.gz`]
      : format === "raw-binaries-v1"
        ? [
            ...base,
            ...(component === "core"
              ? [
                  `aster-api-${v}-linux-amd64`,
                  `aster-plugin-host-${v}-linux-amd64`,
                  `aster-core-${v}-linux-amd64-resources.tar.gz`,
                ]
              : [
                  `aster-smtp-${v}-linux-amd64`,
                  `aster-smtp-${v}-linux-amd64-resources.tar.gz`,
                ]),
          ]
        : [];
  if (!expected.length || assets.length !== expected.length) return false;
  const names = new Set<string>(),
    ids = new Set<number>();
  return assets.every((a) => {
    if (
      !obj(a) ||
      !str(a.name) ||
      !expected.includes(a.name) ||
      names.has(a.name) ||
      !pos(a.id) ||
      ids.has(a.id) ||
      !pos(a.size) ||
      !sha(a.sha256, 64)
    )
      return false;
    names.add(a.name);
    ids.add(a.id);
    const limit =
      a.name === "BUILD.json"
        ? 2 << 20
        : a.name === "PROVENANCE.json"
          ? 128 << 10
          : a.name === "SHA256SUMS"
            ? 1024
            : !a.name.endsWith(".tar.gz")
              ? 64 << 20
              : 80 << 20;
    return a.size <= limit;
  });
}
export function updateCandidate(v: unknown): v is UpdateCandidate {
  if (
    !obj(v) ||
    !["core", "smtp"].includes(v.component) ||
    !version(v.version) ||
    v.tag !== (v.component === "core" ? "v" : "smtp-v") + v.version ||
    v.release_url !== `https://github.com/${repo}/releases/tag/${v.tag}` ||
    !str(v.notes) ||
    new TextEncoder().encode(v.notes).length > 16 << 10 ||
    v.notes.includes("\0") ||
    utc(v.published_at) === null ||
    !sha(v.source_sha, 40) ||
    !sha(v.catalog_sha256, 64) ||
    !["release_id", "run_id", "run_attempt"].every((k) => pos(v[k])) ||
    typeof v.compatible !== "boolean" ||
    typeof v.update_available !== "boolean" ||
    !Array.isArray(v.preconditions) ||
    !v.preconditions.every(str) ||
    !assetsValid(v.component, v.version, v.distribution_format, v.assets)
  )
    return false;
  return true;
}
export function updateStatus(v: unknown): v is UpdateStatus {
  if (
    !obj(v) ||
    v.mode !== "manual_host_handoff" ||
    !obj(v.current) ||
    !str(v.current.core_version) ||
    !str(v.current.smtp_version) ||
    !["not_installed", "disabled", "unavailable", "approved"].includes(
      v.current.smtp_status,
    ) ||
    !count(v.current.plugin_policy_revision) ||
    !["smtp_protocol", "smtp_core_min", "smtp_core_max_exclusive"].every(
      (k) => v.current[k] === undefined || str(v.current[k]),
    ) ||
    !obj(v.source) ||
    v.source.repository !== repo ||
    !["not_checked", "available", "unavailable"].includes(v.source.status) ||
    !str(v.checked_at) ||
    !Array.isArray(v.items) ||
    !v.items.every(updateCandidate)
  )
    return false;
  if (v.source.status === "not_checked")
    return v.checked_at === "" && v.items.length === 0;
  if (
    (v.source.status === "available" && utc(v.checked_at) === null) ||
    (v.source.status === "unavailable" &&
      ((v.checked_at !== "" && utc(v.checked_at) === null) ||
        v.items.length > 0))
  )
    return false;
  const seen = new Set<string>();
  return v.items.every((c: UpdateCandidate) => {
    const key = c.component + ":" + c.tag;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function nativeOperation(v: unknown): v is NativeOperationView {
  if (!obj(v)) return false;
  if (["unconfigured", "absent", "unavailable"].includes(v.state))
    return !("operation" in v);
  const o = v.operation;
  if (
    v.state !== "available" ||
    !obj(o) ||
    o.schema !== 1 ||
    !sha(o.operation_id, 32) ||
    !["install", "upgrade", "recover"].includes(o.action) ||
    ![
      "checking",
      "prepared",
      "executing",
      "succeeded",
      "failed",
      "needs_manual_recovery",
      "rolled_back",
    ].includes(o.status) ||
    ![
      "confirmed",
      "install_preflight",
      "provision",
      "configure",
      "old_schema_preflight",
      "maintenance",
      "backup",
      "migrate",
      "first_admin",
      "activate",
      "readiness",
      "complete",
    ].includes(o.phase) ||
    !version(o.target_core_version) ||
    !sha(o.target_source_sha, 40) ||
    ![
      "maintenance",
      "active_release_changed",
      "https_ready",
      "business_validation_required",
    ].every((k) => typeof o[k] === "boolean") ||
    !obj(o.database_migration) ||
    typeof o.database_migration.started !== "boolean" ||
    typeof o.database_migration.completed !== "boolean" ||
    !["none", "stopped", "started", "previous_started"].includes(
      o.service_action,
    ) ||
    !["none", "verified_old_schema", "blocked_schema_or_readiness"].includes(
      o.program_rollback,
    ) ||
    !["none", "operation_failed", "interrupted_requires_recovery"].includes(
      o.error_code,
    )
  )
    return false;
  const previousAbsent =
    o.previous_core_version === "" && o.previous_source_sha === "";
  if (
    (!previousAbsent &&
      (!version(o.previous_core_version) || !sha(o.previous_source_sha, 40))) ||
    (o.action === "install" && !previousAbsent) ||
    (o.action === "upgrade" && previousAbsent)
  )
    return false;
  const started = utc(o.started_at),
    updated = utc(o.updated_at);
  if (
    started === null ||
    updated === null ||
    o.started_at.slice(0, 4) < "2020" ||
    updated < started
  )
    return false;
  if (o.database_migration.completed && !o.database_migration.started)
    return false;
  if (
    o.https_ready &&
    (o.status !== "succeeded" || o.phase !== "complete" || o.maintenance)
  )
    return false;
  if (
    o.status === "succeeded" &&
    (o.phase !== "complete" ||
      o.maintenance ||
      !o.database_migration.completed ||
      !o.active_release_changed ||
      o.service_action !== "started" ||
      !o.https_ready ||
      o.program_rollback !== "none" ||
      o.error_code !== "none")
  )
    return false;
  if (
    (o.status === "rolled_back" &&
      (o.program_rollback !== "verified_old_schema" ||
        previousAbsent ||
        o.active_release_changed ||
        o.service_action !== "previous_started")) ||
    (o.program_rollback === "verified_old_schema" && o.status !== "rolled_back")
  )
    return false;
  return true;
}
export function validHandoff(
  v: unknown,
  c: UpdateCandidate,
  current?: UpdateStatus["current"],
  actorId?: string,
): boolean {
  if (
    !updateCandidate(c) ||
    !obj(v) ||
    v.schema !== 2 ||
    v.status !== "awaiting_host_operator" ||
    !obj(v.intent)
  )
    return false;
  const i = v.intent,
    created = utc(i.created_at),
    expires = utc(i.expires_at),
    now = BigInt(Date.now()) * 1000000n;
  if (
    created === null ||
    expires === null ||
    created > now ||
    expires <= now ||
    expires <= created ||
    expires - created > 1800000000000n
  )
    return false;
  const canonical = (assets: UpdateCandidate["assets"]) =>
    JSON.stringify(
      [...assets]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, id, size, sha256 }) => ({ name, id, size, sha256 })),
    );
  return (
    i.schema === 2 &&
    i.repository === repo &&
    i.repository_id === 1418618420 &&
    sha(i.request_id, 32) &&
    sha(i.actor_id, 32) &&
    (!actorId || i.actor_id === actorId) &&
    i.component === c.component &&
    i.tag === c.tag &&
    i.version === c.version &&
    i.source_sha === c.source_sha &&
    i.release_id === c.release_id &&
    i.run_id === c.run_id &&
    i.run_attempt === c.run_attempt &&
    i.distribution_format === c.distribution_format &&
    count(i.plugin_policy_revision) &&
    version(i.current_core_version) &&
    (i.current_plugin_version === "" || version(i.current_plugin_version)) &&
    (!current ||
      (i.current_core_version === current.core_version &&
        i.current_plugin_version === current.smtp_version &&
        i.plugin_policy_revision === current.plugin_policy_revision)) &&
    assetsValid(i.component, i.version, i.distribution_format, i.assets) &&
    canonical(i.assets) === canonical(c.assets)
  );
}
