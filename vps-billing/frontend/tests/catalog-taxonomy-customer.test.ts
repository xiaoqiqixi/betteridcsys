// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import CatalogPage from "../src/pages/CatalogPage.vue";
import type { CatalogTaxonomy } from "../src/services/catalog-taxonomy";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  generation: null as unknown as Ref<number>,
  session: null as unknown as Ref<{ user: { id: string } | null }>,
}));
vi.mock("../src/composables/useWorkspace", async () => {
  const { ref } = await import("vue");
  mocks.generation = ref(0);
  mocks.session = ref({ user: { id: "taxonomy-customer" } });
  return { useWorkspace: () => ({ ...mocks }) };
});
const panel = defineComponent({
  props: ["open", "title", "busy"],
  template:
    '<section v-if="open" role="dialog"><h2>{{title}}</h2><slot/><footer><slot name="footer"/></footer></section>',
});
const cny = {
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
};
const usd = { ...cny, code: "USD", name: "US Dollar", prefix: "$" };
const baseTaxonomy: CatalogTaxonomy = {
  revision: 3,
  types: [
    { id: "shared", name: "通用型", sort_order: 20, enabled: true },
    { id: "empty", name: "空类型不应显示", sort_order: 0, enabled: true },
    { id: "compute", name: "计算型", sort_order: 10, enabled: true },
  ],
  regions: [
    {
      id: "shared-hk",
      type_id: "shared",
      name: "香港",
      sort_order: 1,
      enabled: true,
    },
    {
      id: "compute-tyo",
      type_id: "compute",
      name: "东京",
      sort_order: 20,
      enabled: true,
    },
    {
      id: "compute-hk",
      type_id: "compute",
      name: "香港",
      sort_order: 10,
      enabled: true,
    },
    {
      id: "compute-empty",
      type_id: "compute",
      name: "空地区不应显示",
      sort_order: 0,
      enabled: true,
    },
  ],
  nodes: [
    {
      id: "shared-hk-node",
      region_id: "shared-hk",
      name: "通用香港节点",
      sort_order: 1,
      enabled: true,
    },
    {
      id: "compute-hk-node",
      region_id: "compute-hk",
      name: "香港计算节点",
      sort_order: 10,
      enabled: true,
    },
    {
      id: "compute-tyo-node",
      region_id: "compute-tyo",
      name: "东京计算节点",
      sort_order: 20,
      enabled: true,
    },
    {
      id: "empty-node",
      region_id: "compute-hk",
      name: "空节点不应显示",
      sort_order: 0,
      enabled: true,
    },
  ],
};
const basePlans = [
  {
    id: "compute-hk-small",
    type_id: "compute",
    region_id: "compute-hk",
    name: "Hong Kong Compute",
    region: "香港",
  },
  {
    id: "compute-tyo-small",
    type_id: "compute",
    region_id: "compute-tyo",
    name: "Tokyo Compute",
    region: "东京",
  },
  {
    id: "shared-hk-small",
    type_id: "shared",
    region_id: "shared-hk",
    name: "Hong Kong General",
    region: "香港",
  },
].map((plan) => ({
  ...plan,
  node_id: plan.region_id + "-node",
  taxonomy_revision: 3,
  description: "Synthetic read-only catalog fixture",
  cpu: 2,
  memory_gb: 4,
  disk_gb: 40,
  transfer_tb: 1,
  price_minor: 3900,
  price_revision: 7,
  currency: "CNY",
  currency_format: cny,
  available: true,
}));
let registry: CatalogTaxonomy;
let plans: typeof basePlans;
let wrappers: VueWrapper[] = [];
let identity = 0;
function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(CatalogPage, {
    props: { locale: "zh-CN", currency: "CNY", mode: "api", ...props },
    global: { stubs: { OverlayPanel: panel } },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll("button").find((entry) => entry.text() === text)!;
}
function titles(wrapper: VueWrapper) {
  return wrapper.findAll(".gpc-title").map((entry) => entry.text());
}
async function selectAndReview(wrapper: VueWrapper) {
  await wrapper.get(".hostname-field input").setValue("precise-original-host");
  await button(wrapper, "确认订单").trigger("click");
}
beforeEach(() => {
  registry = structuredClone(baseTaxonomy);
  plans = structuredClone(basePlans);
  mocks.generation.value = 0;
  mocks.session.value = { user: { id: `taxonomy-customer-${++identity}` } };
  mocks.read.mockReset();
  mocks.write.mockReset();
  mocks.read.mockImplementation(async (path: string) => {
    if (path === "/catalog-taxonomy") return structuredClone(registry);
    if (path === "/plans") return structuredClone(plans);
    if (path === "/session") return structuredClone(mocks.session.value);
    throw new Error("Unexpected read-only fixture path");
  });
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
});

describe("customer type → region → node → plan contract", () => {
  it("reads real taxonomy and plans, sorts IDs, and hides combinations without a published plan", async () => {
    const wrapper = render();
    await flushPromises();
    expect(mocks.read).toHaveBeenCalledWith("/catalog-taxonomy");
    expect(mocks.read).toHaveBeenCalledWith("/plans", { currency: "CNY" });
    expect(
      wrapper.findAll(".selection-section h2").map((entry) => entry.text()),
    ).toEqual(["选择类型", "选择地区", "选择节点", "选择套餐", "主机名称"]);
    expect(
      wrapper.findAll(".catalog-type button").map((entry) => entry.text()),
    ).toEqual(["计算型", "通用型"]);
    expect(
      wrapper.findAll(".catalog-region button").map((entry) => entry.text()),
    ).toEqual(["香港", "东京"]);
    expect(titles(wrapper)).toEqual(["Hong Kong Compute"]);
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("空类型不应显示");
    expect(wrapper.text()).not.toContain("空地区不应显示");
    expect(wrapper.find("select").exists()).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("uses parent and region IDs, never a shared display name or plan-name guess", async () => {
    plans[2]!.name = "Hong Kong Compute misleading name";
    const wrapper = render();
    await flushPromises();
    expect(titles(wrapper)).toEqual(["Hong Kong Compute"]);
    await button(wrapper, "通用型").trigger("click");
    expect(titles(wrapper)).toEqual(["Hong Kong Compute misleading name"]);
    expect(
      wrapper.get('.catalog-region button[aria-pressed="true"]').text(),
    ).toBe("香港");
    expect(wrapper.get('.catalog-type [aria-pressed="true"]').text()).toBe(
      "通用型",
    );
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("breaks equal sort_order ties by ID rather than source-array order", async () => {
    registry.types.find((entry) => entry.id === "shared")!.sort_order = 10;
    registry.regions.find((entry) => entry.id === "compute-tyo")!.sort_order =
      10;
    const wrapper = render();
    await flushPromises();
    expect(
      wrapper.findAll(".catalog-type button").map((entry) => entry.text()),
    ).toEqual(["计算型", "通用型"]);
    expect(
      wrapper.findAll(".catalog-region button").map((entry) => entry.text()),
    ).toEqual(["香港", "东京"]);
  });

  it("clears the selected quote, private hostname and consent when the upstream type changes", async () => {
    const wrapper = render();
    await flushPromises();
    await selectAndReview(wrapper);
    await wrapper.get(".purchase-consent input").setValue(true);
    await button(wrapper, "返回修改").trigger("click");
    const target = button(wrapper, "通用型");
    (target.element as HTMLButtonElement).focus();
    await target.trigger("click");
    expect(document.activeElement).toBe(target.element);
    expect(target.attributes("aria-pressed")).toBe("true");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(true);
    expect(
      (wrapper.get(".hostname-field input").element as HTMLInputElement).value,
    ).toBe("");
    expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
      "¥39.00",
    );
    expect(button(wrapper, "确认订单").attributes("disabled")).toBeDefined();
    await selectAndReview(wrapper);
    expect(
      (wrapper.get(".purchase-consent input").element as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      button(wrapper, "创建待付款订单").attributes("disabled"),
    ).toBeDefined();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("clears the old quote and hostname when a region changes and defaults to its first real plan", async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.get(".hostname-field input").setValue("old-region-host");
    await button(wrapper, "东京").trigger("click");
    expect(titles(wrapper)).toEqual(["Tokyo Compute"]);
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(true);
    expect(
      (wrapper.get(".hostname-field input").element as HTMLInputElement).value,
    ).toBe("");
    expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
      "¥39.00",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([
    ["taxonomy revision", { taxonomy_revision: 2 }],
    ["missing type", { type_id: "invented-type" }],
    ["missing region", { region_id: "invented-region" }],
    ["wrong region parent", { region_id: "shared-hk" }],
    ["missing node", { node_id: "invented-node" }],
    ["wrong node region", { node_id: "compute-tyo-node" }],
    ["cross-type node", { node_id: "shared-hk-node" }],
    ["display name mismatch", { region: "Not the authoritative region" }],
    ["wrong currency", { currency: "USD", currency_format: usd }],
  ])(
    "fails closed on %s instead of synthesizing a fallback combination",
    async (_reason, invalid) => {
      plans[0] = { ...plans[0]!, ...invalid };
      const wrapper = render();
      await flushPromises();
      expect(wrapper.text()).toContain("暂时无法读取套餐");
      expect(wrapper.findAll(".gpc-card")).toHaveLength(0);
      expect(wrapper.findAll(".catalog-type button")).toHaveLength(0);
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("does not expose disabled parents or children returned by an inconsistent public response", async () => {
    registry.types.find((entry) => entry.id === "compute")!.enabled = false;
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("暂时无法读取套餐");
    expect(wrapper.findAll(".gpc-card")).toHaveLength(0);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("rejects a malformed registry before rendering its IDs as selectable choices", async () => {
    registry.types.push({ ...registry.types[0]! });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("暂时无法读取套餐");
    expect(wrapper.findAll(".gpc-card")).toHaveLength(0);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("accepts an empty plan array as an honest empty catalog with no made-up default type", async () => {
    plans = [];
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("暂无可选类型");
    expect(wrapper.text()).toContain("暂无可选地区");
    expect(wrapper.text()).toContain("暂无可选套餐");
    expect(wrapper.text()).not.toContain("暂时无法读取套餐");
    expect(wrapper.findAll(".gpc-card")).toHaveLength(0);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps an actual type and region visible when their plan has no purchasable quote in this currency", async () => {
    plans = [{ ...plans[0]!, available: false, price_minor: 0 }];
    const wrapper = render();
    await flushPromises();
    expect(
      wrapper.get('.catalog-type button[aria-pressed="true"]').text(),
    ).toBe("计算型");
    expect(
      wrapper.get('.catalog-region button[aria-pressed="true"]').text(),
    ).toBe("香港");
    expect(wrapper.get(".gpc-btn-choose").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("当前币种暂无可购报价");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not publish the plans until taxonomy has also loaded and never falls back after its failure", async () => {
    let rejectTaxonomy!: (reason: unknown) => void;
    mocks.read.mockImplementation((path: string) =>
      path === "/catalog-taxonomy"
        ? new Promise((_resolve, reject) => {
            rejectTaxonomy = reject;
          })
        : Promise.resolve(structuredClone(plans)),
    );
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("正在读取类型");
    expect(wrapper.findAll(".gpc-card")).toHaveLength(0);
    rejectTaxonomy({ status: 503 });
    await flushPromises();
    expect(wrapper.text()).toContain("暂时无法读取套餐");
    expect(wrapper.findAll(".catalog-type button")).toHaveLength(0);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("ignores a late old-currency read pair after a newer complete pair is displayed", async () => {
    const taxonomyResolvers: Array<(value: unknown) => void> = [];
    const planResolvers = new Map<string, (value: unknown) => void>();
    mocks.read.mockImplementation(
      (path: string, query?: { currency: string }) =>
        new Promise((resolve) => {
          if (path === "/catalog-taxonomy") taxonomyResolvers.push(resolve);
          else planResolvers.set(query!.currency, resolve);
        }),
    );
    const wrapper = render();
    await wrapper.setProps({ currency: "USD" });
    taxonomyResolvers[1]!(structuredClone(registry));
    planResolvers.get("USD")!(
      plans.map((plan) => ({ ...plan, currency: "USD", currency_format: usd })),
    );
    await flushPromises();
    expect(wrapper.get(".gpc-currency-tag").text()).toBe("USD");
    taxonomyResolvers[0]!(structuredClone(registry));
    planResolvers.get("CNY")!(structuredClone(plans));
    await flushPromises();
    expect(wrapper.get(".gpc-currency-tag").text()).toBe("USD");
    expect(wrapper.get(".gpc-price-amount").text()).toBe("$39.00");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("retains valid selected IDs on refresh but defaults a fresh unaccepted quote", async () => {
    const wrapper = render();
    await flushPromises();
    await button(wrapper, "通用型").trigger("click");
    registry.revision++;
    registry.types.find((entry) => entry.id === "shared")!.name =
      "通用型新名称";
    plans = plans.map((plan) => ({
      ...plan,
      taxonomy_revision: registry.revision,
      price_revision: 8,
      price_minor: 4900,
    }));
    await wrapper.get('[aria-label="刷新套餐"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('.catalog-type [aria-pressed="true"]').text()).toBe(
      "通用型新名称",
    );
    expect(titles(wrapper)).toEqual(["Hong Kong General"]);
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(true);
    expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
      "¥49.00",
    );
    expect(wrapper.get(".gpc-price-amount").text()).toBe("¥49.00");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("falls back only to a remaining real combination when the previous type is disabled", async () => {
    const wrapper = render();
    await flushPromises();
    registry = {
      revision: 4,
      types: [baseTaxonomy.types[0]!],
      regions: [baseTaxonomy.regions[0]!],
      nodes: [baseTaxonomy.nodes[0]!],
    };
    plans = [{ ...basePlans[2]!, taxonomy_revision: 4 }];
    await wrapper.get('[aria-label="刷新套餐"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.get('.catalog-type button[aria-pressed="true"]').text(),
    ).toBe("通用型");
    expect(
      wrapper.get('.catalog-region button[aria-pressed="true"]').text(),
    ).toBe("香港");
    expect(titles(wrapper)).toEqual(["Hong Kong General"]);
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("renders full long names, English step labels and the selected CNY quote without inventing an English currency default", async () => {
    const longType = "UnbrokenType".repeat(10);
    const longRegion = "香港地区".repeat(30);
    registry.types.find((entry) => entry.id === "compute")!.name = longType;
    registry.regions.find((entry) => entry.id === "compute-hk")!.name =
      longRegion;
    plans[0]!.region = longRegion;
    const wrapper = render({ locale: "en" });
    await flushPromises();
    expect(
      wrapper.findAll(".selection-section h2").map((entry) => entry.text()),
    ).toEqual([
      "Choose a type",
      "Choose a region",
      "Choose a node",
      "Choose a plan",
      "Hostname",
    ]);
    expect(wrapper.get('.catalog-type [aria-pressed="true"]').text()).toBe(
      longType,
    );
    expect(wrapper.get('.catalog-region [aria-pressed="true"]').text()).toBe(
      longRegion,
    );
    expect(wrapper.get(".gpc-currency-tag").text()).toBe("CNY");
    expect(wrapper.get(".gpc-price-amount").text()).toBe("¥39.00");
  });

  it("keeps anonymous taxonomy selection public but requires actual sign-in before ordering", async () => {
    mocks.session.value = { user: null };
    const wrapper = render();
    await flushPromises();
    await button(wrapper, "通用型").trigger("click");
    expect(wrapper.emitted("request-sign-in")).toBeUndefined();
    expect(titles(wrapper)).toEqual(["Hong Kong General"]);
    await wrapper.get(".gpc-btn-choose").trigger("click");
    expect(wrapper.emitted("request-sign-in")).toHaveLength(1);
    expect(wrapper.find(".hostname-field input").exists()).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("preserves the exact order quote/body and locks all upstream selectors after an uncertain write", async () => {
    mocks.write.mockRejectedValueOnce({ status: 0, uncertain: true });
    const wrapper = render();
    await flushPromises();
    await selectAndReview(wrapper);
    await wrapper.get(".purchase-consent input").setValue(true);
    await button(wrapper, "创建待付款订单").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0]![0]).toBe("/orders");
    expect(mocks.write.mock.calls[0]![1]).toEqual({
      plan_id: "compute-hk-small",
      hostname: "precise-original-host",
      currency: "CNY",
      quote: { price_minor: 3900, decimal_places: 2, price_revision: 7 },
    });
    expect(mocks.write.mock.calls[0]![2]["Idempotency-Key"]).toMatch(
      /^ui-[a-f0-9-]+$/,
    );
    expect(
      wrapper
        .findAll(
          ".catalog-type button, .catalog-region button, .catalog-node button",
        )
        .every((entry) => entry.attributes("disabled") !== undefined),
    ).toBe(true);
    await button(wrapper, "通用型").trigger("click");
    expect(titles(wrapper)).toEqual(["Hong Kong Compute"]);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("defaults the first real parent chain and first published plan, not a cheaper global or sibling plan", async () => {
    plans = [
      { ...basePlans[2]!, price_minor: 100 },
      { ...basePlans[0]!, id: "first-published", price_minor: 9900 },
      { ...basePlans[0]!, id: "cheaper-sibling", price_minor: 200 },
      basePlans[1]!,
    ];
    const wrapper = render();
    await flushPromises();
    expect(
      wrapper
        .get('.catalog-type button[aria-pressed="true"]')
        .attributes("data-type-id"),
    ).toBe("compute");
    expect(
      wrapper
        .get('.catalog-region button[aria-pressed="true"]')
        .attributes("data-region-id"),
    ).toBe("compute-hk");
    expect(
      wrapper
        .get('.catalog-node button[aria-pressed="true"]')
        .attributes("data-node-id"),
    ).toBe("compute-hk-node");
    expect(
      wrapper.get(".gpc-card.is-selected").attributes("data-plan-id"),
    ).toBe("first-published");
    expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
      "¥99.00",
    );
    expect(wrapper.get(".mobile-purchase-bar strong").text()).toBe("¥99.00CNY");
    expect(
      wrapper.get(".hostname-field input").attributes("disabled"),
    ).toBeUndefined();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(button(wrapper, "确认订单").attributes("disabled")).toBeDefined();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("uses an identical active button frame and check for single type, region and node", async () => {
    plans = [basePlans[0]!];
    registry.types.find((item) => item.id === "compute")!.name = "标准云服务器";
    const wrapper = render();
    await flushPromises();
    for (const selector of [
      ".catalog-type",
      ".catalog-region",
      ".catalog-node",
    ]) {
      const controls = wrapper.findAll(selector + " button");
      expect(controls).toHaveLength(1);
      expect(controls[0]!.classes()).toContain("active");
      expect(controls[0]!.attributes("aria-pressed")).toBe("true");
      expect(controls[0]!.find("svg.region-check").exists()).toBe(true);
      expect(controls[0]!.attributes("disabled")).toBeUndefined();
    }
    expect(wrapper.get(".catalog-type button span").text()).toBe(
      "标准云服务器",
    );
    expect(
      wrapper.find(".single-type,.single-region,.single-node").exists(),
    ).toBe(false);
    expect(wrapper.get(".order-summary").text()).toContain("香港计算节点");
  });

  it.each([3900, 0])(
    "keeps an unavailable first plan selected with minor=%s, shows no current quote and never jumps to the second plan",
    async (minor) => {
      plans = [
        { ...basePlans[0]!, available: false, price_minor: minor },
        { ...basePlans[0]!, id: "available-second", price_minor: 4900 },
        basePlans[1]!,
        basePlans[2]!,
      ];
      const wrapper = render();
      await flushPromises();
      expect(
        wrapper.get(".gpc-card.is-selected").attributes("data-plan-id"),
      ).toBe("compute-hk-small");
      expect(
        wrapper.get(".gpc-card.is-selected .gpc-unavailable-text").text(),
      ).toBe("当前币种暂无可购报价");
      expect(
        wrapper.find(".gpc-card.is-selected .gpc-price-amount").exists(),
      ).toBe(false);
      expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
        "—",
      );
      expect(wrapper.get(".mobile-purchase-bar strong").text()).toBe("—CNY");
      await wrapper
        .get(".hostname-field input")
        .setValue("not-a-buyable-quote");
      expect(button(wrapper, "确认订单").attributes("disabled")).toBeDefined();
      await button(wrapper, "确认订单").trigger("click");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      expect(mocks.write).not.toHaveBeenCalled();
      await wrapper
        .get('.gpc-card[data-plan-id="available-second"] .gpc-btn-choose')
        .trigger("click");
      expect(
        wrapper.get(".gpc-card.is-selected").attributes("data-plan-id"),
      ).toBe("available-second");
      expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
        "¥49.00",
      );
      expect(
        (wrapper.get(".hostname-field input").element as HTMLInputElement)
          .value,
      ).toBe("");
    },
  );

  it("does not skip an unavailable first node or region to find a quote in another parent", async () => {
    plans[0] = { ...plans[0]!, available: false, price_minor: 0 };
    registry.nodes.push({
      id: "later-hk-node",
      region_id: "compute-hk",
      name: "后续香港节点",
      sort_order: 20,
      enabled: true,
    });
    plans.push({
      ...basePlans[0]!,
      id: "later-node-plan",
      node_id: "later-hk-node",
      price_minor: 100,
    });
    const wrapper = render();
    await flushPromises();
    expect(
      wrapper
        .get('.catalog-node [aria-pressed="true"]')
        .attributes("data-node-id"),
    ).toBe("compute-hk-node");
    expect(
      wrapper.get(".gpc-card.is-selected").attributes("data-plan-id"),
    ).toBe("compute-hk-small");
    expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
      "—",
    );
    expect(titles(wrapper)).toEqual(["Hong Kong Compute"]);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("sorts nodes by sort order and ID, clears the old draft and consent on an explicit node change", async () => {
    registry.nodes.push(
      {
        id: "compute-hk-z",
        region_id: "compute-hk",
        name: "节点 Z",
        sort_order: 10,
        enabled: true,
      },
      {
        id: "compute-hk-a",
        region_id: "compute-hk",
        name: "节点 A",
        sort_order: 10,
        enabled: true,
      },
    );
    plans.push(
      {
        ...basePlans[0]!,
        id: "z-plan",
        node_id: "compute-hk-z",
        price_minor: 5900,
      },
      {
        ...basePlans[0]!,
        id: "a-plan",
        node_id: "compute-hk-a",
        price_minor: 4900,
      },
    );
    const wrapper = render();
    await flushPromises();
    expect(
      wrapper.findAll(".catalog-node button").map((entry) => entry.text()),
    ).toEqual(["节点 A", "香港计算节点", "节点 Z"]);
    expect(
      wrapper.get(".gpc-card.is-selected").attributes("data-plan-id"),
    ).toBe("a-plan");
    await selectAndReview(wrapper);
    await wrapper.get(".purchase-consent input").setValue(true);
    await button(wrapper, "返回修改").trigger("click");
    const target = button(wrapper, "节点 Z");
    (target.element as HTMLButtonElement).focus();
    await target.trigger("click");
    expect(document.activeElement).toBe(target.element);
    expect(
      wrapper.get(".gpc-card.is-selected").attributes("data-plan-id"),
    ).toBe("z-plan");
    expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
      "¥59.00",
    );
    expect(wrapper.get(".mobile-purchase-bar strong").text()).toBe("¥59.00CNY");
    expect(
      (wrapper.get(".hostname-field input").element as HTMLInputElement).value,
    ).toBe("");
    await selectAndReview(wrapper);
    expect(
      (wrapper.get(".purchase-consent input").element as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      button(wrapper, "创建待付款订单").attributes("disabled"),
    ).toBeDefined();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("discards a known-rejected local attempt on node change without reusing its body or idempotency key", async () => {
    registry.nodes.push({
      id: "second-node",
      region_id: "compute-hk",
      name: "第二节点",
      sort_order: 20,
      enabled: true,
    });
    plans.push({
      ...basePlans[0]!,
      id: "second-plan",
      node_id: "second-node",
      price_minor: 4900,
    });
    mocks.write.mockRejectedValue({ status: 400, code: "VALIDATION_ERROR" });
    const wrapper = render();
    await flushPromises();
    await selectAndReview(wrapper);
    await wrapper.get(".purchase-consent input").setValue(true);
    await button(wrapper, "创建待付款订单").trigger("click");
    await flushPromises();
    const original = mocks.write.mock.calls[0]!;
    await button(wrapper, "返回修改").trigger("click");
    await button(wrapper, "第二节点").trigger("click");
    expect(
      wrapper.get(".hostname-field input").attributes("disabled"),
    ).toBeUndefined();
    await selectAndReview(wrapper);
    await wrapper.get(".purchase-consent input").setValue(true);
    await button(wrapper, "创建待付款订单").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledTimes(2);
    const replacement = mocks.write.mock.calls[1]!;
    expect(replacement[1]).toEqual({
      plan_id: "second-plan",
      hostname: "precise-original-host",
      currency: "CNY",
      quote: { price_minor: 4900, decimal_places: 2, price_revision: 7 },
    });
    expect(replacement[2]["Idempotency-Key"]).not.toBe(
      original[2]["Idempotency-Key"],
    );
  });

  it.each(["type", "region", "node"])(
    "fails closed when the plan's %s is disabled",
    async (level) => {
      if (level === "type")
        registry.types.find((item) => item.id === "compute")!.enabled = false;
      else if (level === "region")
        registry.regions.find((item) => item.id === "compute-hk")!.enabled =
          false;
      else
        registry.nodes.find((item) => item.id === "compute-hk-node")!.enabled =
          false;
      const wrapper = render();
      await flushPromises();
      expect(wrapper.text()).toContain("暂时无法读取套餐");
      expect(wrapper.findAll(".gpc-card")).toHaveLength(0);
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
});
