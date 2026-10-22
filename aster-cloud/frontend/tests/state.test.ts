import { defineComponent, h, shallowRef, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  ApiError,
  createApiClient,
  operationResponse,
  validPage,
  validInstance,
} from "../src/api/client";
import { useMutation, fingerprint } from "../src/composables/mutation";
import { useQuery } from "../src/composables/query";
import { consoleKey } from "../src/context";
import { useSession } from "../src/composables/session";
import { readPreferences } from "../src/composables/preferences";
import { actionAllowed, actionPermission } from "../src/permissions";
import type { Instance, Page } from "../src/api/types";
import { admin, instance, operation } from "./fixtures";
import { deferred, mockContext } from "./helpers";
vi.stubGlobal("crypto", webcrypto);
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
describe("identity and request lifetime", () => {
  it("does not restore a logged-out identity from a late me response", async () => {
    const response = deferred<unknown>();
    const { context } = mockContext(() => response.promise);
    const session = useSession(context.api);
    const pending = session.refresh();
    session.invalidate();
    response.resolve({ user: admin, csrf_token: "private" });
    await pending;
    expect(session.user.value).toBeNull();
    expect(context.api.setCSRF).not.toHaveBeenLastCalledWith("private");
  });
  it("does not commit a late resource response after grants change", async () => {
    const response = deferred<unknown>();
    const { context } = mockContext(() => response.promise);
    let query!: ReturnType<typeof useQuery<Page<Instance>>>;
    const wrapper = mount(
      defineComponent({
        setup() {
          query = useQuery(
            () => "/instances",
            (v): v is Page<Instance> => validPage(v, validInstance),
          );
          return () => h("div");
        },
      }),
      { global: { provide: { [consoleKey as symbol]: context } } },
    );
    context.session.invalidate();
    response.resolve({ items: [instance], next_cursor: null });
    await flushPromises();
    expect(query.data.value).toBeNull();
    wrapper.unmount();
  });
  it("a stale query cannot replace a newer path response", async () => {
    const first = deferred<unknown>();
    const path = shallowRef("/instances");
    const { context } = mockContext((_m, p) =>
      p === "/instances" ? first.promise : { items: [], next_cursor: null },
    );
    let query!: ReturnType<typeof useQuery<Page<Instance>>>;
    const wrapper = mount(
      defineComponent({
        setup() {
          query = useQuery(
            () => path.value,
            (v): v is Page<Instance> => validPage(v, validInstance),
          );
          return () => h("div");
        },
      }),
      { global: { provide: { [consoleKey as symbol]: context } } },
    );
    path.value = "/instances?cursor=abc";
    await nextTick();
    await flushPromises();
    first.resolve({ items: [instance], next_cursor: null });
    await flushPromises();
    expect(query.data.value?.items).toEqual([]);
    wrapper.unmount();
  });
});
describe("stable mutation intent", () => {
  it("keeps unknown key across close/reopen and never sends twice", async () => {
    const { context, calls } = mockContext(() => {
      throw new ApiError("unknown");
    });
    let mutation!: ReturnType<typeof useMutation>;
    const wrapper = mount(
      defineComponent({
        setup() {
          mutation = useMutation();
          return () => h("div");
        },
      }),
      { global: { provide: { [consoleKey as symbol]: context } } },
    );
    const path = `/instances/${instance.id}/operations`;
    await mutation.execute(
      "POST",
      path,
      { action: "shutdown", confirmation: instance.id },
      operationResponse,
    );
    const key = mutation.pendingKey.value;
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    mutation.clearMessage();
    await mutation.execute(
      "POST",
      path,
      { action: "shutdown", confirmation: instance.id },
      operationResponse,
    );
    expect(calls).toHaveLength(1);
    expect(mutation.pendingKey.value).toBe(key);
    expect(mutation.error.value).toBe("unknown");
    wrapper.unmount();
  });
  it("does not send after identity changes during intent hashing", async () => {
    const { context, calls } = mockContext(() => ({ operation }));
    let mutation!: ReturnType<typeof useMutation>;
    const wrapper = mount(
      defineComponent({
        setup() {
          mutation = useMutation();
          return () => h("div");
        },
      }),
      { global: { provide: { [consoleKey as symbol]: context } } },
    );
    const pending = mutation.execute(
      "POST",
      "/instances",
      { hostname: "new" },
      operationResponse,
    );
    context.session.invalidate();
    await pending;
    expect(calls).toHaveLength(0);
    wrapper.unmount();
  });
  it("validates operation ID/action/instance before accepting an ACK", async () => {
    const { context, calls } = mockContext(() => ({ operation }));
    let mutation!: ReturnType<typeof useMutation>;
    const wrapper = mount(
      defineComponent({
        setup() {
          mutation = useMutation();
          return () => h("div");
        },
      }),
      { global: { provide: { [consoleKey as symbol]: context } } },
    );
    const result = await mutation.execute(
      "POST",
      "/instances/other/operations",
      { action: "start" },
      operationResponse,
      { bindOperation: { action: "start", instanceId: "other" } },
    );
    expect(result).toBeNull();
    expect(mutation.error.value).toBe("unknown");
    expect(calls).toHaveLength(1);
    expect(mutation.pendingKey.value).toBe(calls[0]?.key);
    wrapper.unmount();
  });
  it("uses existing operation ID for explicit reconcile; never rotates its key", async () => {
    const { context, calls } = mockContext((_m, _p, _b, key) => ({
      operation: { ...operation, id: key, state: "uncertain" },
    }));
    let mutation!: ReturnType<typeof useMutation>;
    const wrapper = mount(
      defineComponent({
        setup() {
          mutation = useMutation();
          return () => h("div");
        },
      }),
      { global: { provide: { [consoleKey as symbol]: context } } },
    );
    await mutation.execute(
      "POST",
      `/operations/${operation.id}/reconcile`,
      {},
      operationResponse,
      {
        key: operation.id,
        bindOperation: { action: "start", instanceId: instance.id },
        allowUncertainReconcile: true,
      },
    );
    expect(calls[0]?.key).toBe(operation.id);
    wrapper.unmount();
  });
  it("does not persist credentials or credential-derived hashes", async () => {
    expect(
      await fingerprint("/users", { email: "x", password: "OneSecret123!" }),
    ).toBe(
      await fingerprint("/users", { email: "x", password: "OtherSecret456!" }),
    );
    expect(
      await fingerprint("/users", { email: "y", password: "OneSecret123!" }),
    ).not.toBe(
      await fingerprint("/users", { email: "x", password: "OneSecret123!" }),
    );
  });
});
describe("preferences and permission gates", () => {
  it.each([null, "{broken", '{"locale":"bad","appearance":"bad"}'])(
    "fails closed for stored preferences %s",
    (raw) =>
      expect(readPreferences({ getItem: () => raw })).toEqual({
        locale: "zh-CN",
        appearance: "system",
      }),
  );
  it("keeps only legal saved values", () =>
    expect(
      readPreferences({
        getItem: () => '{"locale":"en","appearance":"dark","token":"ignored"}',
      }),
    ).toEqual({ locale: "en", appearance: "dark" }));
  it("maps action grants explicitly without assuming admin from a role string", () => {
    expect(actionPermission("delete")).toBe("instances.dangerous");
    expect(actionPermission("backup_restore")).toBe("storage.restore");
    expect(actionPermission("migrate_activate")).toBe("migration.manage");
    expect(actionPermission("unknown")).toBe("");
    expect(actionAllowed("delete", "running", ["instances.manage"])).toBe(
      false,
    );
  });
  it.each([
    "snapshot_create",
    "snapshot_restore",
    "snapshot_delete",
    "backup_create",
    "backup_verify",
    "backup_restore",
    "backup_delete",
  ] as const)("blocks %s before confirmed shutoff", (action) => {
    expect(actionAllowed(action, "running", admin.permissions)).toBe(false);
    expect(actionAllowed(action, "shutoff", admin.permissions)).toBe(true);
    expect(actionAllowed(action, "ShutOff", admin.permissions)).toBe(false);
  });
});

describe("uncertain authentication", () => {
  it("confirms an empty 204 logout and clears identity without pending uncertainty", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const api = createApiClient(fetcher);
    api.setCSRF("logout-csrf");
    const session = useSession(api);
    session.user.value = admin;
    await session.logout();
    expect(session.user.value).toBeNull();
    expect(session.pendingAuth.value).toBeNull();
    expect(session.error.value).toBe("");
    expect(session.busy.value).toBe(false);
    expect(session.epoch.value).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps a mismatched logout ACK unknown and blocks another authentication write", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = createApiClient(fetcher);
    api.setCSRF("logout-csrf");
    const session = useSession(api);
    session.user.value = admin;
    await session.logout();
    expect(session.user.value).toBeNull();
    expect(session.pendingAuth.value).toBe("logout");
    expect(session.error.value).toBe("unknown");
    await session.logout();
    await session.login("admin@example.invalid", "NeverPersist123!");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not issue another login until a safe session read resolves the outcome", async () => {
    let uncertain = true;
    const { context, calls } = mockContext((method, path) =>
      method === "GET"
        ? path === "/auth/csrf"
          ? { csrf_token: "csrf" }
          : uncertain
            ? Promise.reject(new ApiError("unauthorized"))
            : { user: admin, csrf_token: "csrf" }
        : Promise.reject(new ApiError("unknown")),
    );
    const session = useSession(context.api);
    await session.login("admin@example.invalid", "NeverPersist123!");
    expect(session.pendingAuth.value).toBe("login");
    await session.login("admin@example.invalid", "NeverPersist123!");
    expect(calls).toHaveLength(1);
    uncertain = false;
    await session.refresh();
    expect(session.pendingAuth.value).toBeNull();
    expect(session.user.value?.id).toBe(admin.id);
  });
  it("uncertain logout hides sensitive resources without claiming confirmed sign-out", async () => {
    const { context, calls } = mockContext(() =>
      Promise.reject(new ApiError("unknown")),
    );
    const session = useSession(context.api);
    session.user.value = admin;
    await session.logout();
    expect(session.user.value).toBeNull();
    expect(session.pendingAuth.value).toBe("logout");
    expect(session.error.value).toBe("unknown");
    await session.logout();
    expect(calls).toHaveLength(1);
  });
});

describe("read-confirmed recovery", () => {
  it("clears a lost creation acknowledgement only when a bound persisted task is read", async () => {
    const { acknowledgeOperations } =
      await import("../src/composables/mutation");
    let attempt = 0;
    const { context, calls } = mockContext((_m, _p, _b, key) => {
      if (attempt++ === 0) throw new ApiError("unknown");
      return { operation: { ...operation, id: key, action: "reboot" } };
    });
    let mutation!: ReturnType<typeof useMutation>;
    const wrapper = mount(
      defineComponent({
        setup() {
          mutation = useMutation();
          return () => h("div");
        },
      }),
      { global: { provide: { [consoleKey as symbol]: context } } },
    );
    const path = `/instances/${instance.id}/operations`,
      body = { action: "reboot", confirmation: instance.id };
    await mutation.execute("POST", path, body, operationResponse);
    const key = mutation.pendingKey.value;
    acknowledgeOperations(admin.id, [
      { ...operation, id: key, action: "reboot", actor_id: "other" },
    ]);
    mutation.clearMessage();
    await mutation.execute("POST", path, body, operationResponse);
    expect(calls).toHaveLength(1);
    acknowledgeOperations(admin.id, [
      { ...operation, id: key, action: "reboot" },
    ]);
    expect(calls).toHaveLength(1);
    mutation.clearMessage();
    await mutation.execute("POST", path, body, operationResponse, {
      bindOperation: { action: "reboot", instanceId: instance.id },
    });
    expect(calls).toHaveLength(2);
    wrapper.unmount();
  });
  it("a still-accepted task cannot authorize replay of an uncertain dispatch", async () => {
    const { acknowledgeOperations } =
      await import("../src/composables/mutation");
    const { context, calls } = mockContext(() => {
      throw new ApiError("unknown");
    });
    let mutation!: ReturnType<typeof useMutation>;
    const wrapper = mount(
      defineComponent({
        setup() {
          mutation = useMutation();
          return () => h("div");
        },
      }),
      { global: { provide: { [consoleKey as symbol]: context } } },
    );
    const path = `/operations/${operation.id}/dispatch`;
    await mutation.execute("POST", path, {}, operationResponse, {
      key: operation.id,
    });
    acknowledgeOperations(admin.id, [operation]);
    mutation.clearMessage();
    await mutation.execute("POST", path, {}, operationResponse, {
      key: operation.id,
      allowUncertainReconcile: true,
    });
    expect(calls).toHaveLength(1);
    expect(mutation.pendingKey.value).toBe(operation.id);
    wrapper.unmount();
  });
});
