import { ApiError } from "./api";

export const nativeOperationStates = [
  "checking",
  "prepared",
  "executing",
  "succeeded",
  "failed",
  "needs_manual_recovery",
  "rolled_back",
] as const;
const phases = [
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
] as const;

export interface NativeOperation {
  schema: 1;
  operation_id: string;
  action: "install" | "upgrade" | "recover";
  status: (typeof nativeOperationStates)[number];
  phase: (typeof phases)[number];
  target_core_version: string;
  target_source_sha: string;
  previous_core_version: string;
  previous_source_sha: string;
  maintenance: boolean;
  database_migration: { started: boolean; completed: boolean };
  active_release_changed: boolean;
  service_action: "none" | "stopped" | "started" | "previous_started";
  program_rollback:
    "none" | "verified_old_schema" | "blocked_schema_or_readiness";
  https_ready: boolean;
  business_validation_required: boolean;
  started_at: string;
  updated_at: string;
  error_code: "none" | "operation_failed" | "interrupted_requires_recovery";
}

export type NativeOperationView =
  | { state: "unconfigured" | "absent" | "unavailable" }
  | { state: "available"; operation: NativeOperation };

function invalid(): never {
  throw new ApiError(
    "INVALID_OPERATION_RESPONSE",
    "Host operation status unavailable",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function match(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) return invalid();
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}
function timestamp(value: unknown): string {
  const result = match(
    value,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/,
  );
  if (!Number.isFinite(Date.parse(result))) return invalid();
  return result;
}

// Copy only the public receipt contract. Never forward arbitrary host output,
// filesystem paths, environment values or provider diagnostics to the page.
export function readNativeOperationView(value: unknown): NativeOperationView {
  const view = record(value);
  if (
    ["unconfigured", "absent", "unavailable"].includes(view.state as string)
  ) {
    if (view.operation !== undefined) return invalid();
    return { state: view.state as "unconfigured" | "absent" | "unavailable" };
  }
  if (view.state !== "available") return invalid();
  const operation = record(view.operation);
  if (
    operation.schema !== 1 ||
    !["install", "upgrade", "recover"].includes(operation.action as string) ||
    !nativeOperationStates.includes(
      operation.status as NativeOperation["status"],
    ) ||
    !phases.includes(operation.phase as NativeOperation["phase"]) ||
    !["none", "stopped", "started", "previous_started"].includes(
      operation.service_action as string,
    ) ||
    !["none", "verified_old_schema", "blocked_schema_or_readiness"].includes(
      operation.program_rollback as string,
    ) ||
    !["none", "operation_failed", "interrupted_requires_recovery"].includes(
      operation.error_code as string,
    )
  )
    return invalid();
  const version =
    /^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})$/;
  const previousVersion =
    operation.previous_core_version === ""
      ? ""
      : match(operation.previous_core_version, version);
  const previousSHA =
    operation.previous_source_sha === ""
      ? ""
      : match(operation.previous_source_sha, /^[a-f0-9]{40}$/);
  if ((previousVersion === "") !== (previousSHA === "")) return invalid();
  const migration = record(operation.database_migration);
  const startedAt = timestamp(operation.started_at);
  const updatedAt = timestamp(operation.updated_at);
  if (Date.parse(updatedAt) < Date.parse(startedAt)) return invalid();
  const result: NativeOperation = {
    schema: 1,
    operation_id: match(operation.operation_id, /^[a-f0-9]{32}$/),
    action: operation.action as NativeOperation["action"],
    status: operation.status as NativeOperation["status"],
    phase: operation.phase as NativeOperation["phase"],
    target_core_version: match(operation.target_core_version, version),
    target_source_sha: match(operation.target_source_sha, /^[a-f0-9]{40}$/),
    previous_core_version: previousVersion,
    previous_source_sha: previousSHA,
    maintenance: flag(operation.maintenance),
    database_migration: {
      started: flag(migration.started),
      completed: flag(migration.completed),
    },
    active_release_changed: flag(operation.active_release_changed),
    service_action:
      operation.service_action as NativeOperation["service_action"],
    program_rollback:
      operation.program_rollback as NativeOperation["program_rollback"],
    https_ready: flag(operation.https_ready),
    business_validation_required: flag(operation.business_validation_required),
    started_at: startedAt,
    updated_at: updatedAt,
    error_code: operation.error_code as NativeOperation["error_code"],
  };
  if (result.database_migration.completed && !result.database_migration.started)
    return invalid();
  if (
    (result.action === "install" && previousVersion !== "") ||
    (result.action === "upgrade" && previousVersion === "") ||
    (result.https_ready &&
      (result.status !== "succeeded" ||
        result.phase !== "complete" ||
        result.maintenance)) ||
    (result.status === "succeeded" &&
      (!result.https_ready ||
        !result.database_migration.completed ||
        !result.active_release_changed ||
        result.service_action !== "started" ||
        result.program_rollback !== "none" ||
        result.error_code !== "none")) ||
    (result.status === "rolled_back" &&
      (previousVersion === "" ||
        result.active_release_changed ||
        result.service_action !== "previous_started" ||
        result.program_rollback !== "verified_old_schema")) ||
    (result.program_rollback === "verified_old_schema" &&
      result.status !== "rolled_back")
  )
    return invalid();
  return { state: "available", operation: result };
}

export function isNativeOperationActive(operation: NativeOperation): boolean {
  return operation.status === "checking" || operation.status === "executing";
}
