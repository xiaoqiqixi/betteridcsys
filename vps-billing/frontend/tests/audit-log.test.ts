// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuditLogPage from "../src/components/AuditLogPage.vue";
import { setLocale } from "../src/lib/i18n";
const account = "a".repeat(32);
const event = {
  id: "b".repeat(32),
  action: "order.cancelled",
  target: "c".repeat(32),
  created_at: "2026-10-20T08:35:42.123456Z",
  actor_email: "admin@example.invalid",
  owner_id: "d".repeat(32),
  detail: "Reason kept in business audit, not a system log.",
};
const reply = (items = [event], has_more = false, next_cursor = "") => ({
  data: { items, has_more, ...(has_more ? { next_cursor } : {}), limit: 50 },
});
function response(body: unknown, status = 200) {
  return {
    ok: status === 200,
    status,
    headers: new Headers(),
    json: async () => body,
  };
}
let calls: { path: string; method: string }[];
let answer: (url: URL) => unknown | Promise<unknown>;
const wrappers: ReturnType<typeof mount>[] = [];
async function app(props: Record<string, unknown> = {}) {
  const wrapper = mount(AuditLogPage, {
    props: { account: account + ":admin", administrator: true, ...props },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
beforeEach(() => {
  setLocale("zh-CN");
  calls = [];
  answer = () => response(reply());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      calls.push({ path, method: init.method ?? "GET" });
      return answer(new URL(path, "http://localhost"));
    }),
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
describe("server-paged business audit", () => {
  it.each(["constructor", "toString", "__proto__"])(
    "renders inherited-looking historical action %s as inert unknown text",
    async (action) => {
      answer = () => response(reply([{ ...event, action }]));
      const w = await app();
      expect(w.get(".audit-event-heading strong").text()).toBe("其他操作");
      expect(w.get(".audit-event-heading code").text()).toBe(action);
      expect(w.get(".audit-event-detail").text()).toBe(event.detail);
    },
  );
  it("queries the administrator endpoint and keeps actor distinct from owner", async () => {
    const w = await app();
    expect(calls[0]?.path).toBe("/api/v1/admin/audit-events?limit=50");
    const row = w.get(".audit-event");
    expect(row.text()).toContain(event.actor_email);
    expect(row.text()).toContain(event.owner_id);
    expect(row.text()).toContain(event.id);
    expect(row.text()).toContain("08:35:42 UTC");
    expect(w.text()).toContain("不是 HTTP 请求编号");
    expect(w.find("table").exists()).toBe(false);
    expect(w.find(".audit-event details").exists()).toBe(true);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });
  it("uses opaque server cursors for next and previous without inventing totals", async () => {
    answer = (url) =>
      response(
        url.searchParams.has("cursor")
          ? reply([{ ...event, id: "e".repeat(32), detail: "Second page" }])
          : reply([event], true, "opaque+/=cursor"),
      );
    const w = await app();
    await w.get(".audit-pagination button:last-child").trigger("click");
    await flushPromises();
    expect(
      new URL(calls.at(-1)!.path, "http://localhost").searchParams.get(
        "cursor",
      ),
    ).toBe("opaque+/=cursor");
    expect(w.text()).toContain("第 2 页");
    expect(w.text()).toContain("Second page");
    await w.get(".audit-pagination button:first-child").trigger("click");
    await flushPromises();
    expect(calls.at(-1)!.path).toBe("/api/v1/admin/audit-events?limit=50");
    expect(w.text()).toContain("第 1 页");
    expect(w.text()).not.toContain("1,000");
  });
  it("sends exact action, system actor, owner and inclusive/exclusive UTC bounds; reset returns to page one", async () => {
    const w = await app();
    await w.get('[name="audit_action"]').setValue("order.cancelled");
    await w.get('[name="audit_actor"]').setValue("payment:approved-provider");
    await w.get('[name="audit_owner"]').setValue(event.owner_id);
    await w.get('[name="audit_from"]').setValue("2026-10-20T08:00:00");
    await w.get('[name="audit_until"]').setValue("2026-10-20T09:00:01");
    await w.get("form").trigger("submit");
    await flushPromises();
    const params = Object.fromEntries(
      new URL(calls.at(-1)!.path, "http://localhost").searchParams,
    );
    expect(params).toEqual({
      limit: "50",
      action: "order.cancelled",
      actor_email: "payment:approved-provider",
      owner_id: event.owner_id,
      from: "2026-10-20T08:00:00Z",
      until: "2026-10-20T09:00:01Z",
    });
    await w.get('.audit-filter-actions button[type="button"]').trigger("click");
    await flushPromises();
    expect(calls.at(-1)!.path).toBe("/api/v1/admin/audit-events?limit=50");
  });
  it.each(["zh-CN", "en"] as const)(
    "keeps customer queries owner-scoped and renders no admin owner projection in %s",
    async (language) => {
      setLocale(language);
      const w = await app({
        account: account + ":customer",
        administrator: false,
      });
      expect(calls[0]!.path).toBe("/api/v1/audit-events?limit=50");
      expect(w.find('[name="audit_owner"]').exists()).toBe(false);
      expect(w.text()).not.toContain(event.owner_id);
      expect(w.text()).toContain(event.actor_email);
      expect(w.text()).toContain("08:35:42 UTC");
      expect(w.text()).toContain(
        language === "en" ? "Page 1 · 1 record" : "第 1 页",
      );
      if (language === "en") expect(w.text()).not.toContain("1 records");
    },
  );
  it("does not render a fake empty state during an initial pending or failed query and can retry", async () => {
    let release!: (value: unknown) => void;
    answer = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const w = await app();
    expect(w.find(".audit-empty").exists()).toBe(false);
    expect(w.text()).toContain("正在查询");
    release(
      response(
        {
          error: {
            code: "UNAVAILABLE",
            message: "raw-storage-secret",
            request_id: "legacy-request",
          },
        },
        503,
      ),
    );
    await flushPromises();
    expect(w.find(".audit-empty").exists()).toBe(false);
    expect(w.text()).not.toContain("raw-storage-secret");
    expect(w.text()).toContain("legacy-request");
    answer = () => response(reply());
    await w.get(".audit-query-error button").trigger("click");
    await flushPromises();
    expect(w.findAll(".audit-event")).toHaveLength(1);
  });
  it("keeps the last successful page and retries the failed next cursor without silently advancing", async () => {
    let failed = true;
    answer = (url) =>
      response(
        url.searchParams.has("cursor") && failed
          ? { error: { code: "UNAVAILABLE", message: "safe" } }
          : url.searchParams.has("cursor")
            ? reply([{ ...event, detail: "Next page recovered" }])
            : reply([event], true, "next"),
        url.searchParams.has("cursor") && failed ? 503 : 200,
      );
    const w = await app();
    await w.get(".audit-pagination button:last-child").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("第 1 页");
    expect(w.text()).toContain(event.detail);
    expect(w.text()).toContain("上次成功查询");
    failed = false;
    await w.get(".audit-query-error button").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("第 2 页");
    expect(w.text()).toContain("Next page recovered");
  });
  it("does not auto-retry, skip or reset a rejected opaque cursor", async () => {
    answer = (url) =>
      url.searchParams.has("cursor")
        ? response(
            {
              error: {
                code: "INVALID_AUDIT_QUERY",
                message: "safe",
                request_id: "cursor-request",
              },
            },
            400,
          )
        : response(reply([event], true, "rejected-cursor"));
    const w = await app();
    await w.get(".audit-pagination button:last-child").trigger("click");
    await flushPromises();
    await flushPromises();
    expect(calls).toHaveLength(2);
    expect(w.text()).toContain("第 1 页");
    expect(w.text()).toContain("cursor-request");
    expect(w.text()).toContain(event.detail);
    await w.get('.audit-filter-actions button[type="button"]').trigger("click");
    await flushPromises();
    expect(calls).toHaveLength(3);
    expect(calls.at(-1)!.path).toBe("/api/v1/admin/audit-events?limit=50");
  });
  it("rejects malformed pages without replacing readable cached records", async () => {
    const w = await app();
    answer = () => response({ data: { items: [], has_more: true, limit: 50 } });
    await w.get(".audit-filter-actions button:last-child").trigger("click");
    await flushPromises();
    expect(w.text()).toContain(event.detail);
    expect(w.find(".audit-query-error").exists()).toBe(true);
  });
  it("invalidates late administrator results and clears all filters on same-ID role change", async () => {
    let release!: (value: unknown) => void;
    answer = (url) =>
      url.pathname.includes("/admin/")
        ? new Promise((resolve) => {
            release = resolve;
          })
        : response(
            reply([
              { ...event, id: "f".repeat(32), detail: "Customer-owned result" },
            ]),
          );
    const w = await app();
    await w.get('[name="audit_action"]').setValue("order.cancelled");
    await w.setProps({ account: account + ":customer", administrator: false });
    await flushPromises();
    release(response(reply()));
    await flushPromises();
    expect(w.text()).toContain("Customer-owned result");
    expect(w.text()).not.toContain(event.detail);
    expect(w.text()).not.toContain(event.owner_id);
    expect(
      (w.get('[name="audit_action"]').element as HTMLInputElement).value,
    ).toBe("");
  });
  it("clears cached events and reports expired authorization rather than exposing stale data", async () => {
    const w = await app();
    answer = () =>
      response({ error: { code: "AUTH_REQUIRED", message: "safe" } }, 401);
    await w.get(".audit-filter-actions button:last-child").trigger("click");
    await flushPromises();
    expect(w.findAll(".audit-event")).toHaveLength(0);
    expect(w.emitted("auth-expired")).toHaveLength(1);
  });
  it("keeps detail text inert and does not expose extra unknown response fields", async () => {
    const detail =
      '<img src=x onerror="alert(1)"> and <script>secret()</script>';
    answer = () =>
      response(
        reply([
          {
            ...event,
            detail,
            internal_secret: "hidden-provider-secret",
          } as typeof event,
        ]),
      );
    const w = await app();
    expect(w.get(".audit-event-detail").text()).toBe(detail);
    expect(w.find(".audit-event img").exists()).toBe(false);
    expect(w.text()).not.toContain("hidden-provider-secret");
  });
  it("validates inputs without issuing queries and opens advanced errors for focus", async () => {
    const w = await app();
    await w.get('[name="audit_owner"]').setValue("not-an-id");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(w.get('[name="audit_owner"]').attributes("aria-invalid")).toBe(
      "true",
    );
    expect((w.get(".audit-advanced").element as HTMLDetailsElement).open).toBe(
      true,
    );
    expect(document.activeElement).toBe(w.get('[name="audit_owner"]').element);
    await w.get('[name="audit_owner"]').setValue("");
    await w.get('[name="audit_from"]').setValue("2026-10-20T09:00:00");
    await w.get('[name="audit_until"]').setValue("2026-10-20T08:00:00");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(w.text()).toContain("结束时间必须晚于开始时间");
  });
  it("keeps offline preview visibly separate and never queries or writes", async () => {
    const w = await app({ preview: true, previewItems: [event] });
    expect(calls).toHaveLength(0);
    expect(w.text()).toContain("离线示例");
    expect(w.findAll(".audit-event")).toHaveLength(1);
    expect(w.get('button[type="submit"]').attributes("disabled")).toBeDefined();
  });
});
