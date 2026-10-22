import { shallowRef } from "vue";
import { ApiError, key32, record, validOperation } from "../api/client";
import { useConsole } from "../context";
import type { Operation } from "../api/types";
interface Pending {
  owner: string;
  fingerprint: string;
  key: string;
  purpose?: "creation" | "dispatch" | "reconcile" | "other";
}
const ledger = new Map<string, Pending>();
let loaded = false;
function loadLedger() {
  if (loaded) return;
  loaded = true;
  try {
    const value = JSON.parse(
      sessionStorage.getItem("aster.cloud.pending.v1") || "[]",
    );
    if (Array.isArray(value))
      for (const p of value.slice(0, 64))
        if (
          p &&
          typeof p.owner === "string" &&
          /^[a-f0-9]{64}$/.test(p.fingerprint) &&
          /^[a-f0-9]{32}$/.test(p.key)
        )
          ledger.set(`${p.owner}:${p.fingerprint}`, p);
  } catch {
    /* Failures never create a request. */
  }
}
function saveLedger() {
  try {
    sessionStorage.setItem(
      "aster.cloud.pending.v1",
      JSON.stringify([...ledger.values()]),
    );
  } catch {
    /* In-memory guard remains active. */
  }
}
// A read of the persisted task can resolve a lost creation acknowledgement.
// An accepted task alone cannot prove that an uncertain dispatch was not sent.
export function acknowledgeOperations(
  owner: string,
  operations: readonly Operation[],
) {
  loadLedger();
  let changed = false;
  for (const [slot, entry] of ledger) {
    if (entry.owner !== owner) continue;
    const operation = operations.find(
      (value) => value.id === entry.key && value.actor_id === owner,
    );
    if (!operation) continue;
    if (
      entry.purpose === "creation" ||
      ((entry.purpose === "dispatch" || entry.purpose === "reconcile") &&
        [
          "sending",
          "dispatched",
          "uncertain",
          "succeeded",
          "rejected",
        ].includes(operation.state))
    ) {
      ledger.delete(slot);
      changed = true;
    }
  }
  if (changed) saveLedger();
}
export async function fingerprint(path: string, body: unknown) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([path, body], (key, value) =>
      /^(password|token|csrf_token|secret)$/i.test(key) ? "[private]" : value,
    ),
  );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function useMutation() {
  const { api, session } = useConsole();
  const busy = shallowRef(false),
    error = shallowRef(""),
    pendingKey = shallowRef("");
  loadLedger();
  async function execute<T>(
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
    guard: (x: unknown) => x is T,
    options: {
      key?: string;
      expectedStatus?: number;
      allowUncertainReconcile?: boolean;
      bindOperation?: {
        action?: string;
        instanceId?: string;
        artifactId?: string;
        targetNodeId?: string;
      };
    } = {},
  ): Promise<T | null> {
    if (busy.value) return null;
    const owner = session.user.value?.id,
      identity = session.epoch.value;
    if (!owner) {
      error.value = "unauthorized";
      return null;
    }
    busy.value = true;
    error.value = "";
    try {
      const digest = await fingerprint(path, body),
        slot = `${owner}:${digest}`;
      const prior = ledger.get(slot);
      const allowReconcile =
        options.allowUncertainReconcile &&
        method === "POST" &&
        /^\/operations\/([a-f0-9]{32})\/reconcile$/.exec(path)?.[1] ===
          options.key &&
        record(body) &&
        Object.keys(body).length === 0;
      if (prior && !allowReconcile) {
        pendingKey.value = prior.key;
        error.value = "unknown";
        return null;
      }
      if (!prior && ledger.size >= 64) {
        error.value = "unavailable";
        return null;
      }
      if (identity !== session.epoch.value || session.user.value?.id !== owner)
        return null;
      const key = prior?.key || options.key || key32();
      const purpose =
        path === "/instances" ||
        /^\/instances\/[a-f0-9]{32}\/operations$/.test(path)
          ? "creation"
          : /\/dispatch$/.test(path)
            ? "dispatch"
            : /\/reconcile$/.test(path)
              ? "reconcile"
              : "other";
      ledger.set(slot, { owner, fingerprint: digest, key, purpose });
      saveLedger();
      pendingKey.value = key;
      try {
        const result = await api.write(
          method,
          path,
          body,
          key,
          guard,
          options.expectedStatus,
        );
        if (options.bindOperation) {
          const binding = options.bindOperation;
          if (
            !record(result) ||
            !validOperation(result.operation) ||
            result.operation.id !== key ||
            (binding.action !== undefined &&
              result.operation.action !== binding.action) ||
            (binding.instanceId !== undefined &&
              result.operation.instance_id !== binding.instanceId) ||
            (binding.artifactId !== undefined &&
              result.operation.artifact_id !== binding.artifactId) ||
            (binding.targetNodeId !== undefined &&
              result.operation.target_node_id !== binding.targetNodeId)
          )
            throw new ApiError("unknown");
        }
        ledger.delete(slot);
        saveLedger();
        if (identity !== session.epoch.value) return null;
        pendingKey.value = "";
        return result;
      } catch (cause) {
        const kind = cause instanceof ApiError ? cause.kind : "unknown";
        if (kind !== "unknown") {
          ledger.delete(slot);
          saveLedger();
          pendingKey.value = "";
        }
        if (identity === session.epoch.value) {
          error.value = kind;
          if (kind === "unauthorized") session.invalidate();
        }
        return null;
      }
    } catch {
      error.value = "unavailable";
      return null;
    } finally {
      busy.value = false;
    }
  }
  function clearMessage() {
    if (!busy.value) {
      error.value = "";
      pendingKey.value = "";
    }
  }
  return { busy, error, pendingKey, execute, clearMessage };
}
