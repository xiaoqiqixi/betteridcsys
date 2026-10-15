// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import NativeOperationStatus from "../src/components/NativeOperationStatus.vue";
import { locale } from "../src/lib/i18n";
import {
  nativeOperationStates,
  readNativeOperationView,
  type NativeOperation,
} from "../src/lib/native-operations";

const receipt = (
  overrides: Partial<NativeOperation> = {},
): NativeOperation => ({
  schema: 1,
  operation_id: "a".repeat(32),
  action: "upgrade",
  status: "checking",
  phase: "confirmed",
  target_core_version: "0.5.2",
  previous_core_version: "0.5.1",
  target_source_sha: "b".repeat(40),
  previous_source_sha: "c".repeat(40),
  maintenance: false,
  database_migration: { started: false, completed: false },
  active_release_changed: false,
  service_action: "none",
  program_rollback: "none",
  https_ready: false,
  business_validation_required: true,
  started_at: "2026-10-15T09:00:00Z",
  updated_at: "2026-10-15T09:00:01Z",
  error_code: "none",
  ...(overrides.status === "succeeded"
    ? ({
        phase: "complete",
        https_ready: true,
        database_migration: { started: true, completed: true },
        active_release_changed: true,
        service_action: "started",
      } as const)
    : {}),
  ...(overrides.status === "rolled_back"
    ? ({
        service_action: "previous_started",
        program_rollback: "verified_old_schema",
      } as const)
    : {}),
  ...overrides,
});
const available = (overrides: Partial<NativeOperation> = {}) => ({
  state: "available",
  operation: receipt(overrides),
});
const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const failure = (code: string, status = 503) => ({
  ok: false,
  status,
  json: async () => ({ error: { code, message: "private-provider-secret" } }),
});
const mountPanel = async (
  fetcher: ReturnType<typeof vi.fn>,
  props = { preview: false, administrator: true },
) => {
  vi.stubGlobal("fetch", fetcher);
  const wrapper = mount(NativeOperationStatus, { props });
  await flushPromises();
  return wrapper;
};
const advance = async (milliseconds = 5000) => {
  await vi.advanceTimersByTimeAsync(milliseconds);
  await flushPromises();
};
beforeEach(() => {
  locale.value = "en";
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bounded native operation receipts", () => {
  it.each(nativeOperationStates)("accepts the %s executor state", (status) => {
    expect(readNativeOperationView(available({ status }))).toEqual(
      available({ status }),
    );
  });
  it("copies the public contract without host output, paths or other unexpected data", () => {
    const value = {
      ...available(),
      secret: "private-provider-secret",
      operation: {
        ...receipt(),
        stdout: "private-provider-secret",
        secret_file: "/etc/private-secret",
      },
    };
    expect(readNativeOperationView(value)).toEqual(available());
    expect(JSON.stringify(readNativeOperationView(value))).not.toContain(
      "private",
    );
  });
  it.each([
    { schema: 2 },
    { operation_id: "../../etc/private-secret" },
    { action: "exec" },
    { status: "installed" },
    { phase: "<script>alert(1)</script>" },
    { target_core_version: "latest" },
    { target_source_sha: "private-provider-secret" },
    { service_action: "systemctl restart anything" },
    { program_rollback: "none\nprivate-provider-secret" },
    { maintenance: "true" },
    { https_ready: null },
    { started_at: "yesterday" },
    { updated_at: "2026-10-14T09:00:00Z" },
    { database_migration: { completed: true, started: false } },
    { error_code: "private-provider-secret" },
    { action: "install" },
    { previous_core_version: "", previous_source_sha: "" },
    { https_ready: true },
    { status: "succeeded", phase: "complete", https_ready: true },
    { status: "rolled_back", service_action: "none" },
    { program_rollback: "verified_old_schema" },
  ])("rejects a malformed receipt %o", (override) => {
    expect(() =>
      readNativeOperationView({
        state: "available",
        operation: { ...receipt(), ...override },
      }),
    ).toThrow();
  });
  it.each([
    null,
    [],
    {},
    { state: "available" },
    { state: "unconfigured", operation: receipt() },
    { state: "absent", operation: null },
  ])("rejects an invalid observation %o", (value) => {
    expect(() => readNativeOperationView(value)).toThrow();
  });
});

describe("administrator native execution observations", () => {
  it.each([
    ["unconfigured", "Host receipt access is not configured"],
    ["absent", "No host execution receipt is present"],
    ["unavailable", "The host execution receipt is unavailable"],
  ])(
    "shows %s without inferring execution or retrying",
    async (state, message) => {
      const fetcher = vi.fn().mockResolvedValue(reply({ state }));
      const wrapper = await mountPanel(fetcher);
      expect(wrapper.text()).toContain(message);
      expect(wrapper.text()).not.toContain("execution succeeded");
      expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/admin/updates/operation");
      expect(fetcher.mock.calls[0]![1].method).toBe("GET");
      expect(fetcher.mock.calls[0]![1].credentials).toBe("same-origin");
      expect(fetcher.mock.calls[0]![1].body).toBeUndefined();
      await advance(30000);
      expect(fetcher).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    },
  );
  it("follows observed checking, prepared, executing and success with no execution request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(available()))
      .mockResolvedValueOnce(
        reply(available({ status: "prepared", phase: "confirmed" })),
      )
      .mockResolvedValueOnce(
        reply(
          available({
            status: "executing",
            phase: "migrate",
            database_migration: { started: true, completed: false },
            maintenance: true,
          }),
        ),
      )
      .mockResolvedValueOnce(
        reply(
          available({
            status: "succeeded",
            phase: "complete",
            database_migration: { started: true, completed: true },
            active_release_changed: true,
            https_ready: true,
          }),
        ),
      );
    const wrapper = await mountPanel(fetcher);
    expect(wrapper.text()).toContain("Host checks in progress");
    await advance(4999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(wrapper.text()).toContain("Host preparation complete");
    expect(wrapper.text()).toContain("Prepared does not mean installed");
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await wrapper.get('[data-action="refresh-operation"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Host execution in progress");
    expect(wrapper.text()).toContain("maintenance remains enabled");
    expect(wrapper.text()).toContain("without reported completion");
    await advance();
    expect(wrapper.text()).toContain("Host execution succeeded");
    expect(wrapper.text()).toContain("Business validation is still required");
    expect(wrapper.text()).not.toContain(
      "HTTPS readiness has not been confirmed",
    );
    expect(wrapper.text()).not.toContain("maintenance remains enabled");
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every((call) => call[1].method === "GET")).toBe(
      true,
    );
    wrapper.unmount();
  });
  it.each([
    ["failed", "Host execution failed"],
    ["needs_manual_recovery", "Manual recovery required"],
    ["rolled_back", "Program rolled back"],
  ] as const)(
    "stops at %s and retains recovery warnings",
    async (status, message) => {
      const fetcher = vi.fn().mockResolvedValue(
        reply(
          available({
            status,
            phase: "readiness",
            maintenance: true,
            database_migration: { started: true, completed: false },
            program_rollback:
              status === "rolled_back"
                ? "verified_old_schema"
                : "blocked_schema_or_readiness",
            error_code: "operation_failed",
          }),
        ),
      );
      const wrapper = await mountPanel(fetcher);
      expect(wrapper.text()).toContain(message);
      expect(wrapper.text()).toContain("maintenance remains enabled");
      expect(wrapper.text()).toContain(
        status === "rolled_back"
          ? "no automatic database downgrade or recovery guarantee"
          : "Program rollback was blocked",
      );
      expect(wrapper.text()).toContain("Business validation is still required");
      await advance(30000);
      expect(fetcher).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    },
  );
  it("clears stale success when a later read fails without exposing backend diagnostics", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply(
          available({
            status: "succeeded",
            phase: "complete",
            https_ready: true,
          }),
        ),
      )
      .mockResolvedValueOnce(failure("HOST_OPERATION_UNAVAILABLE"));
    const wrapper = await mountPanel(fetcher);
    expect(wrapper.text()).toContain("Host execution succeeded");
    await wrapper.get('[data-action="refresh-operation"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("The current result is unknown");
    expect(wrapper.text()).not.toContain("Host execution succeeded");
    expect(wrapper.text()).not.toContain("private-provider-secret");
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it.each([401, 403])("stops receipt reads after HTTP %s", async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(available()))
      .mockResolvedValueOnce(failure("REQUEST_FAILED", status));
    const wrapper = await mountPanel(fetcher);
    await advance();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "administrator session expired",
    );
    expect(
      wrapper.get('[data-action="refresh-operation"]').attributes("disabled"),
    ).toBeDefined();
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain("private-provider-secret");
    wrapper.unmount();
  });
  it("reconnects with read-only receipt requests after the executing API restarts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply(available({ status: "executing", phase: "activate" })),
      )
      .mockResolvedValueOnce(failure("REQUEST_FAILED", 502))
      .mockRejectedValueOnce(new TypeError("private-provider-secret"))
      .mockResolvedValueOnce(reply(available({ status: "succeeded" })));
    const wrapper = await mountPanel(fetcher);
    await advance();
    expect(wrapper.text()).toContain("The current result is unknown");
    expect(wrapper.text()).toContain("host operation will not be retried");
    expect(wrapper.text()).not.toContain("Host execution in progress");
    await advance();
    expect(fetcher).toHaveBeenCalledTimes(3);
    await advance(9999);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(wrapper.text()).toContain("Host execution succeeded");
    expect(wrapper.text()).not.toContain("private-provider-secret");
    expect(fetcher.mock.calls.every((call) => call[1].method === "GET")).toBe(
      true,
    );
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    wrapper.unmount();
  });
  it("bounds reconnection attempts and keeps an unknown result when the API remains unavailable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply(available({ status: "executing", phase: "activate" })),
      )
      .mockResolvedValue(failure("REQUEST_FAILED", 503));
    const wrapper = await mountPanel(fetcher);
    await advance(300000);
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(wrapper.text()).toContain("The current result is unknown");
    expect(wrapper.text()).not.toContain("Receipt reads will retry");
    await advance(300000);
    expect(fetcher).toHaveBeenCalledTimes(8);
    wrapper.unmount();
  });
  it("rejects invalid receipt fields and never renders arbitrary phase or host output", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply({
        state: "available",
        operation: {
          ...receipt(),
          phase: "<img src=x onerror=alert(1)>",
          stdout: "private-provider-secret",
        },
      }),
    );
    const wrapper = await mountPanel(fetcher);
    expect(wrapper.text()).toContain("The current result is unknown");
    expect(wrapper.text()).not.toContain("private-provider-secret");
    expect(wrapper.find("img").exists()).toBe(false);
    wrapper.unmount();
  });
  it("pauses hidden-tab polling and resumes active observations when visible", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(available()));
    const wrapper = await mountPanel(fetcher);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await advance();
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not overlap reads while an active receipt request is pending", async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(available()))
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    const wrapper = await mountPanel(fetcher);
    await advance();
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      wrapper.get('[data-action="refresh-operation"]').attributes("disabled"),
    ).toBeDefined();
    resolve(reply(available({ status: "succeeded" })));
    await flushPromises();
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it.each([
    { preview: true, administrator: true },
    { preview: false, administrator: false },
  ])("does not read receipts with restricted access %o", async (props) => {
    const fetcher = vi.fn();
    const wrapper = await mountPanel(fetcher, props);
    await advance(30000);
    expect(fetcher).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("discards a pending receipt and polling when administrator access is removed", async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi.fn().mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const wrapper = await mountPanel(fetcher);
    await wrapper.setProps({ administrator: false });
    resolve(reply(available({ status: "succeeded" })));
    await flushPromises();
    expect(wrapper.text()).toBe("");
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
