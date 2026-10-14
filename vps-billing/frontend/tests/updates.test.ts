// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import UpdatesPage from "../src/components/UpdatesPage.vue";
import App from "../src/App.vue";
import { setCsrf } from "../src/lib/api";
import { locale } from "../src/lib/i18n";
import { defaultSiteSettings } from "../src/lib/settings";
import * as fixture from "../src/lib/preview";
import {
  readUpdateHandoff,
  readUpdateStatus,
  type UpdateCandidate,
  type UpdateHandoff,
  type UpdateStatus,
} from "../src/lib/updates";

const candidate = (
  overrides: Partial<UpdateCandidate> = {},
): UpdateCandidate => ({
  component: "core",
  tag: "v0.4.1",
  version: "0.4.1",
  release_url: "https://github.com/xiaoqiqixi/betteridcsys/releases/tag/v0.4.1",
  notes: "Update the core after a verified backup.\nReview the release notes.",
  published_at: "2026-10-14T10:00:00Z",
  source_sha: "a".repeat(40),
  release_id: 101,
  run_id: 201,
  run_attempt: 1,
  compatible: true,
  update_available: true,
  preconditions: [
    "backup_required",
    "exclusive_lock_required",
    "restore_test_required",
  ],
  assets: [
    "aster-0.4.1-linux-amd64.tar.gz",
    "BUILD.json",
    "PROVENANCE.json",
    "SHA256SUMS",
  ].map((name, index) => ({
    name,
    id: 300 + index,
    size: 100 + index,
    sha256: String(index).repeat(64),
  })),
  catalog_sha256: "b".repeat(64),
  ...overrides,
});
const snapshot = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: {
    core_version: "0.4.0",
    smtp_version: "1.0.0",
    smtp_status: "approved",
    plugin_policy_revision: 5,
  },
  source: { repository: "xiaoqiqixi/betteridcsys", status: "not_checked" },
  checked_at: "",
  items: [],
  mode: "manual_host_handoff",
  ...overrides,
});
const checked = (items = [candidate()]): UpdateStatus =>
  snapshot({
    source: { repository: "xiaoqiqixi/betteridcsys", status: "available" },
    checked_at: "2026-10-14T11:00:00Z",
    items,
  });
const handoff = (item = candidate()): UpdateHandoff => ({
  schema: 1,
  status: "awaiting_host_operator",
  intent: {
    schema: 1,
    request_id: "c".repeat(32),
    actor_id: "admin-1",
    created_at: "2026-10-14T11:01:00Z",
    expires_at: "2026-10-14T11:31:00Z",
    repository: "xiaoqiqixi/betteridcsys",
    repository_id: 1418618420,
    component: item.component,
    tag: item.tag,
    version: item.version,
    source_sha: item.source_sha,
    release_id: item.release_id,
    run_id: item.run_id,
    run_attempt: item.run_attempt,
    current_core_version: "0.4.0",
    current_plugin_version: "1.0.0",
    plugin_policy_revision: 5,
    assets: item.assets,
  },
});
const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const failure = (code: string) => ({
  ok: false,
  status: 409,
  json: async () => ({
    error: { code, message: "private-backend-diagnostic" },
  }),
});
const mountPage = async (
  fetcher: ReturnType<typeof vi.fn>,
  props = { preview: false, administrator: true },
) => {
  vi.stubGlobal("fetch", fetcher);
  const wrapper = mount(UpdatesPage, { props });
  await flushPromises();
  return wrapper;
};
const choose = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get('[data-action="check"]').trigger("click");
  await flushPromises();
  await wrapper.get('[data-action="select"]').trigger("click");
  await wrapper.get('[name="acknowledge_manual_handoff"]').setValue(true);
};
beforeEach(() => {
  locale.value = "zh-CN";
  setCsrf("update-csrf");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("bounded official update responses", () => {
  it("retains only documented non-secret fields, with independent core and SMTP versions", () => {
    const value = {
      ...checked(),
      token: "accidental-secret",
      root_command: "unsafe",
    };
    expect(readUpdateStatus(value)).toEqual(checked());
    expect(JSON.stringify(readUpdateStatus(value))).not.toContain(
      "accidental-secret",
    );
    const smtp = candidate({
      component: "smtp",
      tag: "smtp-v1.0.1",
      version: "1.0.1",
      release_url:
        "https://github.com/xiaoqiqixi/betteridcsys/releases/tag/smtp-v1.0.1",
      assets: candidate().assets.map((asset, index) =>
        index === 0
          ? { ...asset, name: "aster-smtp-1.0.1-linux-amd64.tar.gz" }
          : asset,
      ),
    });
    expect(readUpdateStatus(checked([smtp])).items[0]!.component).toBe("smtp");
  });
  it.each([
    [
      "foreign repository",
      {
        ...checked(),
        source: { repository: "attacker/repo", status: "available" },
      },
    ],
    [
      "executable URL",
      checked([candidate({ release_url: "javascript:alert(1)" })]),
    ],
    [
      "foreign URL",
      checked([
        candidate({ release_url: "https://evil.example/releases/tag/v0.4.1" }),
      ]),
    ],
    ["tag/version mismatch", checked([candidate({ tag: "v0.4.2" })])],
    [
      "inaccurate run ID",
      checked([candidate({ run_id: Number.MAX_SAFE_INTEGER + 1 })]),
    ],
    [
      "invalid asset digest",
      checked([
        candidate({
          assets: candidate().assets.map((asset) => ({
            ...asset,
            sha256: "fake",
          })),
        }),
      ]),
    ],
    [
      "source archive",
      checked([
        candidate({
          assets: candidate().assets.map((asset, index) =>
            index === 0 ? { ...asset, name: "source.tar.gz" } : asset,
          ),
        }),
      ]),
    ],
    ["duplicate components", checked([candidate(), candidate()])],
    [
      "oversize release notes",
      checked([candidate({ notes: "x".repeat(16385) })]),
    ],
    ["missing check time", { ...checked(), checked_at: "" }],
  ])("rejects %s", (_name, value) => {
    expect(() => readUpdateStatus(value)).toThrow();
  });
  it("binds a pending handoff to the displayed release, assets, and local state", () => {
    expect(
      readUpdateHandoff(handoff(), candidate(), snapshot().current),
    ).toEqual(handoff());
    const tampered = handoff();
    tampered.intent.assets = tampered.intent.assets.map((asset, index) =>
      index === 0 ? { ...asset, id: 900 } : asset,
    );
    expect(() =>
      readUpdateHandoff(tampered, candidate(), snapshot().current),
    ).toThrow();
    expect(() =>
      readUpdateHandoff(
        { ...handoff(), status: "installed" },
        candidate(),
        snapshot().current,
      ),
    ).toThrow();
    expect(() =>
      readUpdateHandoff(handoff(), candidate(), {
        ...snapshot().current,
        plugin_policy_revision: 6,
      }),
    ).toThrow();
    expect(() =>
      readUpdateHandoff(
        { ...handoff(), intent: { ...handoff().intent, repository_id: 1 } },
        candidate(),
        snapshot().current,
      ),
    ).toThrow();
  });
});

describe("administrator update handoff", () => {
  it("loads local status only and requires an explicit official check and acknowledgement", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(snapshot()))
      .mockResolvedValueOnce(reply(checked()))
      .mockResolvedValueOnce(reply(handoff()));
    const wrapper = await mountPage(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/admin/updates");
    expect(fetcher.mock.calls[0]![1].method).toBe("GET");
    expect(wrapper.text()).toContain("0.4.0");
    expect(wrapper.text()).toContain("1.0.0");
    expect(wrapper.text()).toContain("运行状态未检查");
    await wrapper.get('[data-action="check"]').trigger("click");
    await flushPromises();
    expect(fetcher.mock.calls[1]![0]).toBe("/api/v1/admin/updates/check");
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({});
    await wrapper.get('[data-action="select"]').trigger("click");
    await wrapper.get("form").trigger("submit");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[type="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[name="acknowledge_manual_handoff"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const [path, request] = fetcher.mock.calls[2]!;
    expect(path).toBe("/api/v1/admin/updates/handoff");
    expect(request.method).toBe("POST");
    expect(request.headers["X-CSRF-Token"]).toBe("update-csrf");
    expect(JSON.parse(request.body)).toEqual({
      component: "core",
      tag: "v0.4.1",
      source_sha: "a".repeat(40),
      release_id: 101,
      catalog_sha256: "b".repeat(64),
      acknowledge_manual_handoff: true,
    });
    expect(wrapper.text()).toContain("等待主机运维");
    expect(wrapper.text()).toContain("尚未开始安装");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(
      wrapper.get('[data-action="select"]').attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });
  it("exports only the verified pending JSON proposal without executing any action", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(snapshot()))
      .mockResolvedValueOnce(reply(checked()))
      .mockResolvedValueOnce(
        reply({ ...handoff(), unexpected_secret: "do-not-export" }),
      );
    const wrapper = await mountPage(fetcher);
    await choose(wrapper);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const create = vi.fn().mockReturnValue("blob:handoff");
    const NativeURL = URL;
    vi.stubGlobal(
      "URL",
      class extends NativeURL {
        static createObjectURL = create;
        static revokeObjectURL = vi.fn();
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    await wrapper.get('[data-action="download"]').trigger("click");
    expect(create.mock.calls[0]![0].type).toBe("application/json");
    const exported = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(create.mock.calls[0]![0]);
    });
    expect(JSON.parse(exported)).toEqual(handoff());
    expect(exported).not.toContain("do-not-export");
    expect(click.mock.instances[0]!.download).toBe(
      `aster-update-core-0.4.1-${"c".repeat(32)}.json`,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });
  it.each([
    { preview: true, administrator: true },
    { preview: false, administrator: false },
  ])(
    "performs no requests in offline or nonadministrator mode: %o",
    async (props) => {
      const fetcher = vi.fn();
      const wrapper = await mountPage(fetcher, props);
      expect(fetcher).not.toHaveBeenCalled();
      expect(wrapper.find("form").exists()).toBe(false);
      wrapper.unmount();
    },
  );
  it("does not treat cached metadata as a fresh administrator check", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(checked()));
    const wrapper = await mountPage(fetcher);
    expect(
      wrapper.get('[data-action="select"]').attributes("disabled"),
    ).toBeDefined();
    await wrapper.get('[data-action="select"]').trigger("click");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it("renders release notes as inert text and blocks an incompatible candidate", async () => {
    const notes =
      '<img src=x onerror="alert(1)"><script>window.evil=1</script> [link](javascript:alert(1))';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(snapshot()))
      .mockResolvedValueOnce(
        reply(checked([candidate({ compatible: false, notes })])),
      );
    const wrapper = await mountPage(fetcher);
    await wrapper.get('[data-action="check"]').trigger("click");
    await flushPromises();
    expect(wrapper.get("pre").text()).toBe(notes);
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("script").exists()).toBe(false);
    expect(
      wrapper.get('[data-action="select"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.text()).toContain("不兼容");
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it("shows source failure as unknown availability and does not leak diagnostics", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(snapshot()))
      .mockResolvedValueOnce(failure("UPDATE_UNAVAILABLE"));
    const wrapper = await mountPage(fetcher);
    await wrapper.get('[data-action="check"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "未确认是否有新版本",
    );
    expect(wrapper.text()).not.toContain("private-backend-diagnostic");
    expect(wrapper.find("form").exists()).toBe(false);
    wrapper.unmount();
  });
  it("requires a new official check when the release or compatibility changes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(snapshot()))
      .mockResolvedValueOnce(reply(checked()))
      .mockResolvedValueOnce(failure("UPDATE_STALE"));
    const wrapper = await mountPage(fetcher);
    await choose(wrapper);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("本次未生成交接单");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(
      wrapper.get('[data-action="select"]').attributes("disabled"),
    ).toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });
  it("blocks automatic retry after an uncertain handoff response and keeps safe diagnostics", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(snapshot()))
      .mockResolvedValueOnce(reply(checked()))
      .mockRejectedValueOnce(new Error("private-transport-secret"));
    const wrapper = await mountPage(fetcher);
    await choose(wrapper);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("勿重复提交");
    expect(wrapper.text()).not.toContain("private-transport-secret");
    expect(wrapper.get('[type="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.get("form").trigger("submit");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wrapper.find(".updates-handoff").exists()).toBe(false);
    wrapper.unmount();
  });
  it("discards an in-flight check when access changes to preview", async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(snapshot()))
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    const wrapper = await mountPage(fetcher);
    await wrapper.get('[data-action="check"]').trigger("click");
    await wrapper.setProps({ preview: true });
    resolve(reply(checked()));
    await flushPromises();
    expect(wrapper.find('[data-action="select"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("离线预览");
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it.each(["admin", "customer"])(
    "integrates the updates route for the %s role",
    async (role) => {
      const requests: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string) => {
          const endpoint = path.replace("/api/v1", "");
          requests.push(endpoint);
          if (endpoint === "/session")
            return reply({
              user: { ...fixture.previewUser, role },
              csrf_token: "update-csrf",
              demo_mode: false,
            });
          if (endpoint === "/site-settings") return reply(defaultSiteSettings);
          if (endpoint === "/admin/updates") return reply(snapshot());
          if (endpoint.startsWith("/admin/overview"))
            return reply({
              customers: 1,
              total_services: 0,
              unpaid_invoices: 0,
              unpaid_total_minor: 0,
              revenue_minor: 0,
              currency: "CNY",
            });
          if (endpoint.startsWith("/overview"))
            return reply({
              active_services: 0,
              pending_invoices: 0,
              unpaid_total_minor: 0,
              monthly_total_minor: 0,
              currency: "CNY",
              recent_orders: [],
            });
          return reply([]);
        }),
      );
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/:pathMatch(.*)*", component: { template: "<div />" } },
        ],
      });
      await router.push("/updates");
      const wrapper = mount(App, { global: { plugins: [router] } });
      await flushPromises();
      expect(wrapper.findComponent(UpdatesPage).exists()).toBe(
        role === "admin",
      );
      expect(requests.includes("/admin/updates")).toBe(role === "admin");
      expect(wrapper.find('nav a[href="/updates"]').exists()).toBe(
        role === "admin",
      );
      expect(requests.includes("/admin/updates/check")).toBe(false);
      wrapper.unmount();
    },
  );
});
