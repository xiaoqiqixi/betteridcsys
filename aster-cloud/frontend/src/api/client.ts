import type {
  Action,
  Artifact,
  Audit,
  Instance,
  InstanceDetail,
  InstanceObservation,
  Node,
  Operation,
  Page,
  Resources,
  Role,
  Session,
  User,
  UsersResult,
} from "./types";
export type FailureKind =
  | "network"
  | "unknown"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "invalid"
  | "unavailable";
export class ApiError extends Error {
  constructor(
    public kind: FailureKind,
    public code = "",
    public status = 0,
  ) {
    super(kind);
    this.name = "ApiError";
  }
}
export const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string";
const finite = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
export const validUser = (x: unknown): x is User =>
  record(x) &&
  text(x.id) &&
  text(x.email) &&
  text(x.name) &&
  text(x.role) &&
  typeof x.enabled === "boolean" &&
  Array.isArray(x.permissions) &&
  x.permissions.every(text);
export const validSession = (x: unknown): x is Session =>
  record(x) &&
  validUser(x.user) &&
  text(x.csrf_token) &&
  x.csrf_token.length > 0;
export const validResources = (x: unknown): x is Resources =>
  record(x) &&
  [
    "cpu_cores",
    "memory_mib",
    "system_disk_gib",
    "data_disk_gib",
    "ipv4_count",
    "ipv6_count",
    "bandwidth_mbps",
    "inbound_bandwidth_mbps",
    "transfer_gib",
  ].every((k) => finite(x[k])) &&
  [
    "image_id",
    "datacenter_id",
    "compute_node_id",
    "node_group_id",
    "system_storage_id",
    "data_storage_id",
    "network_type",
    "traffic_direction",
  ].every((k) => text(x[k]));
export const validInstance = (x: unknown): x is Instance =>
  record(x) &&
  [
    "id",
    "owner_ref",
    "node_id",
    "hostname",
    "state",
    "created_at",
    "updated_at",
  ].every((k) => text(x[k])) &&
  validResources(x.resources);
export const validOperation = (x: unknown): x is Operation =>
  record(x) &&
  [
    "id",
    "instance_id",
    "node_id",
    "action",
    "state",
    "artifact_id",
    "target_node_id",
    "created_at",
    "updated_at",
  ].every((k) => text(x[k]));
export const validArtifact = (x: unknown): x is Artifact =>
  record(x) &&
  ["id", "instance_id", "state", "created_at"].every((k) => text(x[k])) &&
  (x.kind === "snapshot" || x.kind === "backup");
export const validNode = (x: unknown): x is Node =>
  record(x) &&
  text(x.id) &&
  text(x.datacenter_id) &&
  typeof x.online === "boolean" &&
  typeof x.maintenance === "boolean" &&
  (x.heartbeat_at === null || text(x.heartbeat_at)) &&
  [
    "free_cpu",
    "free_memory_mib",
    "free_disk_gib",
    "reserved_cpu",
    "reserved_memory_mib",
    "reserved_disk_gib",
  ].every((k) => finite(x[k]));
export const validAudit = (x: unknown): x is Audit =>
  record(x) &&
  (text(x.id) || finite(x.id)) &&
  (x.source === "identity" || x.source === "resource") &&
  ["actor", "action", "target", "created_at"].every((k) => text(x[k]));
export function validPage<T>(
  x: unknown,
  guard: (v: unknown) => v is T,
): x is Page<T> {
  return (
    record(x) &&
    Array.isArray(x.items) &&
    x.items.every(guard) &&
    (x.next_cursor === null || text(x.next_cursor))
  );
}
export const validDetail = (x: unknown): x is InstanceDetail =>
  record(x) &&
  validInstance(x.instance) &&
  Array.isArray(x.operations) &&
  x.operations.every(validOperation) &&
  Array.isArray(x.artifacts) &&
  x.artifacts.every(validArtifact) &&
  Array.isArray(x.migrations) &&
  x.migrations.every(
    (v) =>
      record(v) &&
      [
        "id",
        "instance_id",
        "source_node_id",
        "target_node_id",
        "phase",
        "created_at",
        "updated_at",
      ].every((k) => text(v[k])),
  );
export const validObservation = (x: unknown): x is InstanceObservation =>
  record(x) &&
  x.protocol === "aster.node.instance/1" &&
  [
    "node_id",
    "instance_id",
    "owner_ref",
    "hostname",
    "state",
    "ipv4",
    "mac",
    "observed_at",
  ].every((k) => text(x[k])) &&
  /^\d{4}-\d\d-\d\dT/.test(String(x.observed_at)) &&
  Number.isFinite(Date.parse(String(x.observed_at))) &&
  typeof x.source_fenced === "boolean" &&
  typeof x.target_pending === "boolean";
export const observationResponse = (
  x: unknown,
): x is { observation: InstanceObservation } =>
  record(x) && validObservation(x.observation);
export const validRoles = (x: unknown): x is { items: Role[] } =>
  record(x) &&
  Array.isArray(x.items) &&
  x.items.every(
    (v) =>
      record(v) &&
      text(v.id) &&
      text(v.name) &&
      Array.isArray(v.permissions) &&
      v.permissions.every(text),
  );
export const validUsers = (x: unknown): x is UsersResult =>
  record(x) &&
  Array.isArray(x.items) &&
  x.items.every(validUser) &&
  finite(x.limit) &&
  typeof x.truncated_possible === "boolean";
export function key32(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
}
export interface ApiClient {
  get<T>(
    path: string,
    guard: (v: unknown) => v is T,
    signal?: AbortSignal,
  ): Promise<T>;
  write<T>(
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
    key: string,
    guard: (v: unknown) => v is T,
    expectedStatus?: number,
  ): Promise<T>;
  setCSRF(value: string): void;
}
export function createApiClient(
  fetcher: typeof fetch = (...args) => fetch(...args),
): ApiClient {
  let csrf = "";
  async function request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body: unknown,
    key: string,
    guard: (v: unknown) => v is T,
    signal?: AbortSignal,
    expectedStatus?: number,
  ): Promise<T> {
    if (
      !/^\/[a-z0-9/?=&_%.-]+$/i.test(path) ||
      path.includes("..") ||
      path.startsWith("//")
    )
      throw new ApiError("invalid");
    const writing = method !== "GET";
    if (writing && (!csrf || !/^([a-f0-9]{32})$/.test(key)))
      throw new ApiError("invalid");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, writing ? 30000 : 15000);
    try {
      const response = await fetcher(`/console/v1${path}`, {
        method,
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: writing
          ? {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf,
              "Idempotency-Key": key,
            }
          : { Accept: "application/json" },
        ...(writing ? { body: JSON.stringify(body) } : {}),
      });
      if (
        !/^application\/json(?:;|$)/i.test(
          response.headers.get("Content-Type") || "",
        )
      )
        throw new ApiError(writing ? "unknown" : "invalid");
      let data: unknown;
      const raw = await response.text();
      if (raw.length > 2 * 1024 * 1024)
        throw new ApiError(writing ? "unknown" : "invalid");
      try {
        data = JSON.parse(raw);
      } catch {
        throw new ApiError(writing ? "unknown" : "invalid");
      }
      if (!response.ok) {
        const code =
          record(data) &&
          record(data.error) &&
          typeof data.error.code === "string" &&
          /^[A-Z0-9_]{1,80}$/.test(data.error.code)
            ? data.error.code
            : "";
        throw new ApiError(
          response.status === 401
            ? "unauthorized"
            : response.status === 403
              ? "forbidden"
              : response.status === 409
                ? "conflict"
                : response.status >= 500
                  ? writing
                    ? "unknown"
                    : "unavailable"
                  : "invalid",
          code,
          response.status,
        );
      }
      if (expectedStatus !== undefined && response.status !== expectedStatus)
        throw new ApiError(writing ? "unknown" : "invalid");
      if (!guard(data)) throw new ApiError(writing ? "unknown" : "invalid");
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(writing ? "unknown" : "network");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  return {
    get: (p, g, s) => request("GET", p, undefined, "", g, s),
    write: (m, p, b, k, g, status) => request(m, p, b, k, g, undefined, status),
    setCSRF: (v) => {
      csrf = v;
    },
  };
}
export const operationResponse = (x: unknown): x is { operation: Operation } =>
  record(x) && validOperation(x.operation);
export const userResponse = (x: unknown): x is { user: User } =>
  record(x) && validUser(x.user);
export const emptyResponse = (x: unknown): x is Record<string, never> =>
  record(x) && Object.keys(x).length === 0;
export const actions: readonly Action[] = [
  "start",
  "shutdown",
  "reboot",
  "force_off",
  "delete",
  "snapshot_create",
  "snapshot_restore",
  "snapshot_delete",
  "backup_create",
  "backup_verify",
  "backup_restore",
  "backup_delete",
  "migrate_prepare",
  "migrate_transfer",
  "migrate_import",
  "migrate_activate",
];
