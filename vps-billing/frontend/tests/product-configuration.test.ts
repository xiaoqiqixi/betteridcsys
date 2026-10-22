// @vitest-environment jsdom
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, type Ref } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import ProductConfigurationPanel from "../src/components/ProductConfigurationPanel.vue";
import OverlayPanel from "../src/components/OverlayPanel.vue";
import AdminCatalogPage from "../src/pages/AdminCatalogPage.vue";
import {
  type ProductConfiguration,
  type ProductSpec,
  disabledProductSpec,
  productConfigurationSHA256,
} from "../src/services/product-configuration";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  generation: null as unknown as Ref<number>,
}));
vi.mock("../src/composables/useWorkspace", async () => {
  const { ref } = await import("vue");
  mocks.generation = ref(0);
  return { useWorkspace: () => mocks };
});
const panel = defineComponent({
  props: ["open", "title", "busy"],
  emits: ["close"],
  template:
    '<section v-if="open" role="dialog"><h2>{{title}}</h2><slot/><footer><slot name="footer"/></footer></section>',
});
const id = "hkg-essential",
  route = `/admin/catalog/${id}/product-configuration`;
const preset = (): ProductSpec => ({
  mode: "preset",
  controller_id: "aster-hkg",
  remote_product_id: "product:2",
  resources: null,
});
let stored: ProductConfiguration,
  wrappers: VueWrapper[] = [];
async function receipt(
  spec = disabledProductSpec(),
  planId = id,
  revision = 1,
  price = 7,
): Promise<ProductConfiguration> {
  return {
    plan_id: planId,
    revision,
    price_revision: price,
    spec,
    configuration_sha256: await productConfigurationSHA256(spec),
  };
}
function button(w: VueWrapper, name: string) {
  return w.findAll("button").find((x) => x.text() === name)!;
}
function field(w: VueWrapper, name: string) {
  const label = w.findAll("label").find(
    (x) =>
      x.find(".form-label").exists() &&
      x
        .find(".form-label")
        .text()
        .replace(/\s*\*$/, "")
        .trim() === name,
  );
  expect(label, name).toBeDefined();
  return label!.get("input,textarea,[role=combobox]");
}
function mountPanel(real = false, props = {}) {
  const w = mount(ProductConfigurationPanel, {
    props: {
      open: true,
      planId: id,
      planName: "用于展示的 99 核套餐",
      category: "标准型 · 香港 · 商品分类节点",
      locale: "zh-CN",
      mode: "api",
      ...props,
    },
    global: { stubs: real ? { Teleport: true } : { OverlayPanel: panel } },
    attachTo: document.body,
  });
  wrappers.push(w);
  return w;
}
async function setPreset(w: VueWrapper) {
  await w.findAll(".configuration-modes button")[1]!.trigger("click");
  await field(w, "目标主控标识").setValue("aster-hkg");
  await field(w, "主控产品标识").setValue("product:2");
  await field(w, "操作原因").setValue("  管理员审核固定产品参数  ");
}
async function setCustom(w: VueWrapper) {
  await w.findAll(".configuration-modes button")[2]!.trigger("click");
  await field(w, "目标主控标识").setValue("aster-hkg");
  await field(w, "数据中心 ID").setValue("dc-1");
  await field(w, "系统镜像 ID").setValue("debian12");
  await field(w, "操作原因").setValue("设置本系统标准资源参数");
}
beforeEach(async () => {
  vi.stubGlobal("crypto", {
    randomUUID,
    subtle: {
      digest: async (_algorithm: string, value: Uint8Array) =>
        new Uint8Array(createHash("sha256").update(value).digest()).buffer,
    },
  });
  mocks.generation.value = 0;
  mocks.read.mockReset();
  mocks.write.mockReset();
  stored = await receipt();
  mocks.read.mockImplementation(async () => structuredClone(stored));
  mocks.write.mockImplementation(async (_path, body) => {
    stored = await receipt(
      body.spec,
      id,
      body.revision + 1,
      stored.price_revision + 3,
    );
    return structuredClone(stored);
  });
});
afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers = [];
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
it("loads the independent configuration, frames every mode and never fills resource IDs from catalog categories", async () => {
  const w = mountPanel();
  await flushPromises();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(route);
  expect(w.findAll(".configuration-modes button")).toHaveLength(3);
  expect(w.find(".configuration-modes button").attributes("aria-pressed")).toBe(
    "true",
  );
  expect(w.text()).toContain("原有商品销售不受影响");
  expect(JSON.parse(w.get("pre").text())).toEqual(disabledProductSpec());
  await setCustom(w);
  expect(field(w, "计算节点 ID").element).toHaveProperty("value", "");
  expect(field(w, "CPU 核数").element).toHaveProperty("value", "2");
  expect(mocks.write).not.toHaveBeenCalled();
});
it("saves exact preset with captured revision and null resources, not display specifications or money", async () => {
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith(route, {
    revision: 1,
    spec: preset(),
    reason: "管理员审核固定产品参数",
  });
  expect(w.emitted("saved")).toHaveLength(1);
  expect(w.text()).toContain("仅用于后续新订单，保存不会立即开通");
  expect(w.text()).toContain("r2");
  expect(w.text()).not.toContain("连接成功");
});
it("sends all 17 custom fields, named units, own defaults and actual keyboard-operated UiSelect", async () => {
  const w = mountPanel();
  await flushPromises();
  await setCustom(w);
  expect(w.findAll("select")).toHaveLength(0);
  expect(w.findAll('[role="combobox"]')).toHaveLength(2);
  const network = field(w, "网络类型");
  await network.trigger("keydown", { key: "ArrowDown" });
  await network.trigger("keydown", { key: "ArrowDown" });
  await network.trigger("keydown", { key: "Enter" });
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  const spec = mocks.write.mock.calls[0]![1].spec;
  expect(Object.keys(spec.resources)).toHaveLength(17);
  expect(spec).toMatchObject({
    mode: "custom",
    remote_product_id: "",
    resources: {
      datacenter_id: "dc-1",
      compute_node_id: "",
      node_group_id: "",
      image_id: "debian12",
      cpu_cores: 2,
      memory_mib: 4096,
      system_disk_gib: 40,
      data_disk_gib: 0,
      data_storage_id: "",
      network_type: "vpc",
      bandwidth_mbps: 0,
      inbound_bandwidth_mbps: 0,
      transfer_gib: 0,
      traffic_direction: "out",
      ipv4_count: 1,
      ipv6_count: 0,
    },
  });
  expect(w.text()).toContain("不代表不限量");
});
it.each([
  ["目标主控标识", "https://host.invalid/key"],
  ["主控产品标识", "../secret"],
  ["操作原因", ""],
])(
  "rejects invalid preset %s and focuses its marked input",
  async (label, value) => {
    const w = mountPanel();
    await flushPromises();
    await setPreset(w);
    await field(w, label).setValue(value);
    await button(w, "保存配置").trigger("click");
    await flushPromises();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(field(w, label).attributes("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field(w, label).element);
  },
);
it.each([
  ["内存 · MiB", "129"],
  ["CPU 核数", "1e2"],
  ["CPU 核数", "01"],
  ["系统盘 · GiB", "0"],
  ["出站带宽 · Mbps", "10000001"],
  ["数据盘存储 ID（可选）", "store-1"],
  ["IPv4 数量", "0"],
])("rejects custom boundary %s=%s before writing", async (label, value) => {
  const w = mountPanel();
  await flushPromises();
  await setCustom(w);
  await field(w, label).setValue(value);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(field(w, label).attributes("aria-invalid")).toBe("true");
});
it("requires placement and image, permits compute node without datacenter", async () => {
  const w = mountPanel();
  await flushPromises();
  await setCustom(w);
  await field(w, "数据中心 ID").setValue("");
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(mocks.write).not.toHaveBeenCalled();
  await field(w, "计算节点 ID").setValue("compute:1");
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(mocks.write).toHaveBeenCalledOnce();
});
it("disabled mode clears incompatible parameters without saving or changing sale status automatically", async () => {
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await w.findAll(".configuration-modes button")[0]!.trigger("click");
  expect(JSON.parse(w.get("pre").text())).toEqual(disabledProductSpec());
  expect(mocks.write).not.toHaveBeenCalled();
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(mocks.write.mock.calls[0]![1].spec).toEqual(disabledProductSpec());
});
it.each(["plan", "revision", "price", "spec", "hash"])(
  "rejects a valid-looking wrong %s ACK and locks repeats",
  async (fault) => {
    mocks.write.mockImplementation(async (_path, body) => {
      const value = await receipt(body.spec, id, 2, 8);
      if (fault === "plan") value.plan_id = "another-plan";
      if (fault === "revision") value.revision = 3;
      if (fault === "price") value.price_revision = 7;
      if (fault === "spec") {
        value.spec.controller_id = "another";
        value.configuration_sha256 = await productConfigurationSHA256(
          value.spec,
        );
      }
      if (fault === "hash") value.configuration_sha256 = "a".repeat(64);
      return value;
    });
    const w = mountPanel();
    await flushPromises();
    await setPreset(w);
    await button(w, "保存配置").trigger("click");
    await flushPromises();
    expect(w.emitted("saved")).toBeUndefined();
    expect(w.text()).toContain("保存结果尚未确认");
    expect(button(w, "保存配置").attributes("disabled")).toBeDefined();
    await button(w, "保存配置").trigger("click");
    expect(mocks.write).toHaveBeenCalledOnce();
  },
);
it.each([
  { code: "PRODUCT_CONFIGURATION_CONFLICT", status: 409 },
  { status: 500 },
  { status: 0, uncertain: true },
])(
  "locks conflict/unknown results until manual read, never retries",
  async (failure) => {
    mocks.write.mockRejectedValue(failure);
    const w = mountPanel();
    await flushPromises();
    await setPreset(w);
    await button(w, "保存配置").trigger("click");
    await flushPromises();
    expect(button(w, "保存配置").attributes("disabled")).toBeDefined();
    expect(field(w, "目标主控标识").element).toHaveProperty(
      "value",
      "aster-hkg",
    );
    stored = await receipt(preset(), id, 2, 8);
    await button(w, "重新读取并核对配置").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("已重新读取服务器中的配置");
    expect(w.text()).toContain("r2");
    expect(mocks.write).toHaveBeenCalledOnce();
  },
);
it("a definite 400 stays editable without rendering server diagnostics", async () => {
  mocks.write.mockRejectedValue({
    status: 400,
    code: "INVALID_PRODUCT_CONFIGURATION",
    message: "SECRET_HTML",
  });
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(w.text()).not.toContain("SECRET_HTML");
  expect(button(w, "保存配置").attributes("disabled")).toBeUndefined();
});
it("dirty close confirms and retained discard cannot bypass busy before exact ACK", async () => {
  let finish!: (value: ProductConfiguration) => void;
  mocks.write.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await button(w, "关闭").trigger("click");
  expect(w.find(".configuration-discard").exists()).toBe(true);
  const oldDiscard = button(w, "放弃草稿").element;
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(w.find(".configuration-discard").exists()).toBe(false);
  oldDiscard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await button(w, "关闭").trigger("click");
  expect(w.emitted("close")).toBeUndefined();
  expect(w.getComponent(OverlayPanel).props("busy")).toBe(true);
  expect(
    w
      .findAll("input,textarea")
      .every((x) => x.attributes("disabled") !== undefined),
  ).toBe(true);
  finish(await receipt(preset(), id, 2, 8));
  await flushPromises();
  expect(w.emitted("saved")).toHaveLength(1);
});
it.each(["plan", "hash", "missing", "secret"])(
  "fails closed on wrong %s GET instead of editable disabled fallback",
  async (fault) => {
    const value: any = await receipt();
    if (fault === "plan") value.plan_id = "other";
    if (fault === "hash") value.configuration_sha256 = "a".repeat(64);
    if (fault === "missing") delete value.spec.resources;
    if (fault === "secret") value.spec.api_key = "secret";
    mocks.read.mockResolvedValue(value);
    const w = mountPanel();
    await flushPromises();
    expect(w.findAll(".configuration-modes button")).toHaveLength(0);
    expect(button(w, "保存配置").attributes("disabled")).toBeDefined();
    expect(w.text()).not.toContain("api_key");
    expect(mocks.write).not.toHaveBeenCalled();
  },
);
it("discards a late prior-identity read", async () => {
  let finish!: (value: ProductConfiguration) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const w = mountPanel();
  await flushPromises();
  stored = await receipt(preset(), id, 3, 9);
  mocks.generation.value++;
  await flushPromises();
  finish(await receipt());
  await flushPromises();
  expect(w.text()).toContain("r3");
  expect(field(w, "目标主控标识").element).toHaveProperty("value", "aster-hkg");
});
it("ignores prior-identity save without closing or replacing new configuration", async () => {
  let finish!: (value: ProductConfiguration) => void;
  mocks.write.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  stored = await receipt(
    { ...preset(), controller_id: "new-owner" },
    id,
    5,
    14,
  );
  mocks.generation.value++;
  await flushPromises();
  finish(await receipt(preset(), id, 2, 8));
  await flushPromises();
  expect(w.text()).toContain("r5");
  expect(field(w, "目标主控标识").element).toHaveProperty("value", "new-owner");
  expect(w.emitted("saved")).toBeUndefined();
  expect(w.emitted("close")).toBeUndefined();
});
it("actual OverlayPanel focuses the dialog and Escape respects dirty editing", async () => {
  const w = mountPanel(true);
  await flushPromises();
  expect(document.activeElement?.getAttribute("role")).toBe("dialog");
  await setPreset(w);
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await flushPromises();
  await vi.waitFor(() =>
    expect(w.find(".configuration-discard").exists()).toBe(true),
  );
  expect(w.emitted("close")).toBeUndefined();
  await button(w, "放弃草稿").trigger("click");
  expect(w.emitted("close")).toHaveLength(1);
});
it("English demo scope never claims a real integration or open resource", async () => {
  const w = mountPanel(false, { locale: "en", mode: "demo" });
  await flushPromises();
  await w.findAll(".configuration-modes button")[1]!.trigger("click");
  await field(w, "Target controller identifier").setValue("aster-hkg");
  await field(w, "Controller product identifier").setValue("plan-1");
  await field(w, "Change reason").setValue("Synthetic preview");
  await button(w, "Save configuration").trigger("click");
  await flushPromises();
  expect(w.text()).toContain("Demo configuration saved in memory only");
  expect(w.findAll("select")).toHaveLength(0);
});
it("a retained recovery click cannot reset busy or close a subsequent pending save", async () => {
  mocks.write.mockRejectedValueOnce({ status: 500 });
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  const recovery = button(w, "重新读取并核对配置").element;
  recovery.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushPromises();
  await setPreset(w);
  let finish!: (value: ProductConfiguration) => void;
  mocks.write.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  const reads = mocks.read.mock.calls.length;
  recovery.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushPromises();
  await button(w, "关闭").trigger("click");
  expect(mocks.read).toHaveBeenCalledTimes(reads);
  expect(w.getComponent(OverlayPanel).props("busy")).toBe(true);
  expect(w.emitted("close")).toBeUndefined();
  finish(await receipt(preset(), id, 2, 8));
  await flushPromises();
  expect(w.emitted("saved")).toHaveLength(1);
});
it("enforces the UTF-8 reason boundary without changing or truncating its text", async () => {
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await field(w, "操作原因").setValue("中".repeat(167));
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(mocks.write).not.toHaveBeenCalled();
  await field(w, "操作原因").setValue("中".repeat(166) + "ab");
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(mocks.write.mock.calls[0]![1].reason).toBe("中".repeat(166) + "ab");
});
async function mountCatalog(real = false, ids = [id]) {
  const products = ids.map((planId) => ({
    id: planId,
    type_id: "type",
    region_id: "region",
    node_id: "classification-node",
    name: "真实商品入口",
    description: "",
    region: "香港",
    cpu: 99,
    memory_gb: 88,
    disk_gb: 77,
    transfer_tb: 66,
    available: true,
    prices: [{ currency: "CNY", amount_minor: 3900, available: true }],
  }));
  mocks.read.mockImplementation(async (path) => {
    if (/^\/admin\/catalog\/[^/]+\/product-configuration$/.test(path))
      return { ...structuredClone(stored), plan_id: path.split("/").at(-2) };
    if (path === "/admin/catalog")
      return {
        revision: 7,
        currency_revision: 1,
        taxonomy_revision: 1,
        items: products,
      };
    if (path === "/admin/currencies")
      return {
        revision: 1,
        default_currency: "CNY",
        currencies: [
          {
            code: "CNY",
            name: "人民币",
            prefix: "¥",
            suffix: "",
            decimal_places: 2,
            enabled: true,
          },
        ],
      };
    if (path === "/admin/catalog-taxonomy")
      return {
        revision: 1,
        types: [{ id: "type", name: "标准云", enabled: true, sort_order: 0 }],
        regions: [
          {
            id: "region",
            type_id: "type",
            name: "香港",
            enabled: true,
            sort_order: 0,
          },
        ],
        nodes: [
          {
            id: "classification-node",
            region_id: "region",
            name: "商品分类节点",
            enabled: true,
            sort_order: 0,
          },
        ],
      };
    throw new Error("unexpected read");
  });
  const w = mount(AdminCatalogPage, {
    props: { locale: "zh-CN", mode: "api", currency: "CNY" },
    global: { stubs: real ? { Teleport: true } : { OverlayPanel: panel } },
    attachTo: document.body,
  });
  wrappers.push(w);
  await flushPromises();
  return w;
}
it("the actual catalog entry opens independent product configuration without touching the price editor or catalog write", async () => {
  const w = await mountCatalog();
  await button(w, "产品配置").trigger("click");
  await flushPromises();
  expect(w.findComponent(ProductConfigurationPanel).exists()).toBe(true);
  expect(w.find(".price-editor").exists()).toBe(false);
  await setPreset(w);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.write.mock.calls[0]![0]).toBe(route);
  expect(w.get(".product-spec-line").text()).toContain("99");
});
it("an unavailable configuration never falls back to demo defaults; only explicit reload retries the read", async () => {
  mocks.read.mockRejectedValueOnce({
    status: 503,
    message: "PRIVATE_BACKEND_DIAGNOSTIC",
  });
  const w = mountPanel();
  await flushPromises();
  expect(w.text()).not.toContain("PRIVATE_BACKEND_DIAGNOSTIC");
  expect(w.find(".configuration-modes").exists()).toBe(false);
  expect(button(w, "保存配置").attributes("disabled")).toBeDefined();
  expect(mocks.read).toHaveBeenCalledOnce();
  await button(w, "重新读取并核对配置").trigger("click");
  await flushPromises();
  expect(w.findAll(".configuration-modes button")).toHaveLength(3);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.write).not.toHaveBeenCalled();
});
it("retranslates a definite 400 and request ID without losing its editable draft or making requests", async () => {
  const requestId = "a".repeat(32);
  mocks.write.mockRejectedValue({
    status: 400,
    code: "INVALID_PRODUCT_CONFIGURATION",
    requestId,
    message: "PRIVATE_DIAGNOSTIC",
  });
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(w.get(".configuration-error").text()).toContain("产品配置未通过校验");
  expect(w.get(".configuration-error").text()).toContain(
    `请求编号 ${requestId}`,
  );
  await w.setProps({ locale: "en" });
  expect(w.get(".configuration-error").text()).toBe(
    `Check the identifiers and resource parameters. · Request ID ${requestId}`,
  );
  expect(w.text()).not.toContain("PRIVATE_DIAGNOSTIC");
  expect(field(w, "Target controller identifier").element).toHaveProperty(
    "value",
    "aster-hkg",
  );
  expect(field(w, "Change reason").element).toHaveProperty(
    "value",
    "  管理员审核固定产品参数  ",
  );
  expect(
    button(w, "Save configuration").attributes("disabled"),
  ).toBeUndefined();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(w.emitted("saved")).toBeUndefined();
});
it("retranslates an uncertain save while preserving draft and the no-repeat lock", async () => {
  mocks.write.mockRejectedValue({ status: 503, uncertain: true });
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(w.get(".configuration-error").text()).toContain("保存结果尚未确认");
  await w.setProps({ locale: "en" });
  expect(w.get(".configuration-error").text()).toBe(
    "The save outcome is uncertain. Repeat submissions are blocked. Reload and check before another save.",
  );
  expect(field(w, "Target controller identifier").element).toHaveProperty(
    "value",
    "aster-hkg",
  );
  expect(field(w, "Change reason").element).toHaveProperty(
    "value",
    "  管理员审核固定产品参数  ",
  );
  expect(button(w, "Save configuration").attributes("disabled")).toBeDefined();
  expect(
    field(w, "Target controller identifier").attributes("disabled"),
  ).toBeDefined();
  await button(w, "Save configuration").trigger("click");
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(w.emitted("saved")).toBeUndefined();
});
it.each(["api", "demo"] as const)(
  "retranslates an acknowledged %s save without reading or writing again",
  async (mode) => {
    const w = mountPanel(false, { mode });
    await flushPromises();
    await setPreset(w);
    await button(w, "保存配置").trigger("click");
    await flushPromises();
    expect(w.get(".configuration-notice").text()).toContain(
      mode === "api" ? "产品配置已保存" : "演示配置已保存",
    );
    await w.setProps({ locale: "en" });
    expect(w.get(".configuration-notice").text()).toBe(
      mode === "api"
        ? "Product configuration saved. It applies only to future orders; saving does not provision a service."
        : "Demo configuration saved in memory only. No controller was contacted and no resource was created.",
    );
    expect(w.text()).toContain("r2");
    expect(field(w, "Target controller identifier").element).toHaveProperty(
      "value",
      "aster-hkg",
    );
    expect(
      button(w, "Save configuration").attributes("disabled"),
    ).toBeDefined();
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(w.emitted("saved")).toHaveLength(1);
  },
);
it("changing locale during a pending save preserves busy and the captured request", async () => {
  let finish!: (value: ProductConfiguration) => void;
  mocks.write.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const w = mountPanel();
  await flushPromises();
  await setPreset(w);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  await w.setProps({ locale: "en" });
  expect(w.getComponent(OverlayPanel).props("busy")).toBe(true);
  expect(button(w, "Saving…").attributes("disabled")).toBeDefined();
  await button(w, "Close").trigger("click");
  expect(w.emitted("close")).toBeUndefined();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.write).toHaveBeenCalledOnce();
  finish(await receipt(preset(), id, 2, 8));
  await flushPromises();
  expect(w.get(".configuration-notice").text()).toContain(
    "Product configuration saved.",
  );
  expect(w.emitted("saved")).toHaveLength(1);
});
async function savedCatalog() {
  const w = await mountCatalog(true, ["another-plan", id]);
  const original = w.get<HTMLButtonElement>(
    `[data-product-configuration-id="${id}"]`,
  );
  original.element.focus();
  await original.trigger("click");
  await flushPromises();
  await setPreset(w);
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  return { w, original };
}
it("save refresh replaces the trigger and close restores the same plan's new button, not another product", async () => {
  const { w, original } = await savedCatalog();
  const replacement = w.get(`[data-product-configuration-id="${id}"]`);
  expect(original.element.isConnected).toBe(false);
  expect(replacement.element).not.toBe(original.element);
  expect(w.find('[role="dialog"]').exists()).toBe(true);
  button(w, "关闭").element.focus();
  await button(w, "关闭").trigger("click");
  await flushPromises();
  expect(w.findComponent(ProductConfigurationPanel).exists()).toBe(false);
  expect(document.activeElement).toBe(replacement.element);
  expect(document.activeElement).not.toBe(
    w.get('[data-product-configuration-id="another-plan"]').element,
  );
  expect(
    mocks.read.mock.calls.filter(([path]) => path === "/admin/catalog"),
  ).toHaveLength(2);
  expect(mocks.write).toHaveBeenCalledOnce();
});
it("close during a pending catalog refresh restores focus only after the replacement trigger exists", async () => {
  const w = await mountCatalog(true);
  const original = w.get<HTMLButtonElement>(
    `[data-product-configuration-id="${id}"]`,
  );
  original.element.focus();
  await original.trigger("click");
  await flushPromises();
  await setPreset(w);
  const read = mocks.read.getMockImplementation()!;
  const refreshed = await read("/admin/catalog");
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementation((path) =>
    path === "/admin/catalog"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : read(path),
  );
  await button(w, "保存配置").trigger("click");
  await flushPromises();
  expect(original.element.isConnected).toBe(false);
  await button(w, "关闭").trigger("click");
  await flushPromises();
  expect(w.findComponent(ProductConfigurationPanel).exists()).toBe(false);
  expect(w.find(`[data-product-configuration-id="${id}"]`).exists()).toBe(
    false,
  );
  finish(refreshed);
  await flushPromises();
  expect(document.activeElement).toBe(
    w.get(`[data-product-configuration-id="${id}"]`).element,
  );
  expect(mocks.write).toHaveBeenCalledOnce();
});
it.each(["identity", "mode", "unmount"] as const)(
  "a queued close focus cannot cross the %s boundary",
  async (boundary) => {
    const { w } = await savedCatalog();
    const replacement = w.get<HTMLButtonElement>(
      `[data-product-configuration-id="${id}"]`,
    ).element;
    const focus = vi.spyOn(replacement, "focus");
    const sentinel = document.createElement("button");
    document.body.append(sentinel);
    w.getComponent(ProductConfigurationPanel).vm.$emit("close");
    if (boundary === "identity") mocks.generation.value++;
    else if (boundary === "mode") void w.setProps({ mode: "demo" });
    else {
      w.unmount();
      wrappers = wrappers.filter((item) => item !== w);
    }
    sentinel.focus();
    await flushPromises();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(sentinel);
    expect(mocks.write).toHaveBeenCalledOnce();
  },
);
it("opening a different product cancels the previous close's queued focus", async () => {
  const { w } = await savedCatalog();
  const previous = w.get<HTMLButtonElement>(
    `[data-product-configuration-id="${id}"]`,
  ).element;
  const focus = vi.spyOn(previous, "focus");
  w.getComponent(ProductConfigurationPanel).vm.$emit("close");
  await w
    .get('[data-product-configuration-id="another-plan"]')
    .trigger("click");
  await flushPromises();
  expect(w.getComponent(ProductConfigurationPanel).props("planId")).toBe(
    "another-plan",
  );
  expect(focus).not.toHaveBeenCalled();
  expect(mocks.write).toHaveBeenCalledOnce();
});
