// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import UpdateManager from "../src/components/UpdateManager.vue";
import { handoff, receipt, updates } from "./settings-fixtures";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  generation: null as unknown as Ref<number>,
  session: null as unknown as Ref<any>,
}));
vi.mock("../src/composables/useWorkspace", async () => {
  const { ref } = await import("vue");
  mocks.generation = ref(0);
  mocks.session = ref({ user: { id: "e".repeat(32) } });
  return { useWorkspace: () => ({ ...mocks }) };
});
const panel = defineComponent({
  props: ["open", "title"],
  template:
    '<section v-if="open" role="dialog"><h2>{{title}}</h2><slot/><footer><slot name="footer"/></footer></section>',
});
let wrappers: VueWrapper[] = [];
const NativeURL = globalThis.URL;
class BrowserURL extends NativeURL {
  static createObjectURL = vi.fn(() => "blob:synthetic-handoff");
  static revokeObjectURL = vi.fn();
}
function screen() {
  const w = mount(UpdateManager, {
    props: { locale: "zh-CN", mode: "api" },
    global: { stubs: { OverlayPanel: panel } },
  });
  wrappers.push(w);
  return w;
}
const button = (w: VueWrapper, s: string) =>
  w.findAll("button").find((b) => b.text() === s)!;
async function generate(w: VueWrapper) {
  await button(w, "准备主机交接").trigger("click");
  await w.find(".ack input").setValue(true);
  await button(w, "生成交接").trigger("click");
  await flushPromises();
}
beforeEach(() => {
  mocks.read.mockReset();
  mocks.write.mockReset();
  mocks.generation.value = 0;
  mocks.read.mockImplementation(async (path: string) =>
    path === "/admin/updates" ? updates() : { state: "absent" },
  );
  BrowserURL.createObjectURL.mockClear();
  BrowserURL.revokeObjectURL.mockClear();
  vi.stubGlobal("URL", BrowserURL);
});
afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("manual update UI confirmation and failure handling", () => {
  it("does not turn an inconsistent host success receipt into a success display", async () => {
    mocks.read.mockImplementation(async (path: string) =>
      path === "/admin/updates"
        ? updates()
        : {
            ...receipt(),
            operation: {
              ...receipt().operation,
              program_rollback: "verified_old_schema",
            },
          },
    );
    const w = screen();
    await flushPromises();
    expect(w.find(".update-facts").exists()).toBe(false);
    expect(w.text()).not.toContain("操作完成");
    expect(w.find('[role="alert"]').exists()).toBe(true);
  });
  it("requires explicit acknowledgement and downloads only an unsigned matching handoff, not an installation result", async () => {
    mocks.write.mockResolvedValue(handoff());
    const w = screen();
    await flushPromises();
    await button(w, "准备主机交接").trigger("click");
    expect(button(w, "生成交接").attributes("disabled")).toBeDefined();
    await w.find(".ack input").setValue(true);
    await button(w, "生成交接").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledWith("/admin/updates/handoff", {
      component: "core",
      tag: "v0.5.7",
      source_sha: "a".repeat(40),
      catalog_sha256: "b".repeat(64),
      release_id: 7,
      acknowledge_manual_handoff: true,
    });
    expect(BrowserURL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(w.find("a[download]").attributes("href")).toBe(
      "blob:synthetic-handoff",
    );
    expect(w.text()).toContain("系统尚未更新");
    expect(w.text()).toContain("未签名");
  });
  it("keeps an invalid successful handoff locked even after re-reading public update status", async () => {
    const invalid = handoff();
    invalid.intent.actor_id = "a".repeat(32);
    mocks.write.mockResolvedValue(invalid);
    const w = screen();
    await flushPromises();
    await generate(w);
    expect(BrowserURL.createObjectURL).not.toHaveBeenCalled();
    expect(w.find("a[download]").exists()).toBe(false);
    expect(w.emitted("uncertain")?.at(-1)).toEqual([true]);
    await button(w, "重新读取").trigger("click");
    await flushPromises();
    expect(button(w, "检查官方更新").attributes("disabled")).toBeDefined();
    expect(w.text()).toContain("上次交接结果未确认");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("drops an old download link on reload and revokes its object URL", async () => {
    mocks.write.mockResolvedValue(handoff());
    const w = screen();
    await flushPromises();
    await generate(w);
    await button(w, "重新读取").trigger("click");
    await flushPromises();
    expect(w.find("a[download]").exists()).toBe(false);
    expect(BrowserURL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:synthetic-handoff",
    );
  });
  it("expires a valid handoff link rather than keeping a stale download enabled", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    mocks.write.mockResolvedValue(handoff());
    const w = screen();
    await flushPromises();
    await generate(w);
    expect(w.find("a[download]").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1800001);
    await flushPromises();
    expect(w.find("a[download]").exists()).toBe(false);
    expect(w.text()).toContain("交接已到期");
    expect(BrowserURL.revokeObjectURL).toHaveBeenCalled();
  });
});
