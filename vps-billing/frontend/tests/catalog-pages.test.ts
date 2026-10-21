// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import CatalogPage from "../src/pages/CatalogPage.vue";
import AdminCatalogPage from "../src/pages/AdminCatalogPage.vue";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  generation: null as unknown as Ref<number>,
  session: null as unknown as Ref<{ user: { id: string } | null }>,
}));
vi.mock("../src/composables/useWorkspace", async () => {
  const { ref } = await import("vue");
  mocks.generation = ref(0);
  mocks.session = ref({ user: { id: "unit-account" } });
  return { useWorkspace: () => ({ ...mocks }) };
});
const panel = defineComponent({
  props: ["open", "title"],
  template:
    '<section v-if="open" role="dialog"><h2>{{title}}</h2><slot/><footer><slot name="footer"/></footer></section>',
});
const cny = {
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
  enabled: true,
};
const usd = {
  code: "USD",
  name: "US Dollar",
  prefix: "$",
  suffix: "",
  decimal_places: 2,
  enabled: true,
};
const taxonomy = {
  revision: 4,
  types: [{ id: "cloud", name: "云服务器", sort_order: 0, enabled: true }],
  regions: [
    {
      id: "cloud-hkg",
      type_id: "cloud",
      name: "HKG",
      sort_order: 0,
      enabled: true,
    },
    {
      id: "cloud-tyo",
      type_id: "cloud",
      name: "TYO",
      sort_order: 1,
      enabled: true,
    },
  ],
};
const plans = Array.from({ length: 4 }, (_, i) => ({
  id: `plan-${i}`,
  type_id: "cloud",
  region_id: i < 2 ? "cloud-hkg" : "cloud-tyo",
  taxonomy_revision: taxonomy.revision,
  name: `Plan ${i}`,
  description: "Synthetic",
  region: i < 2 ? "HKG" : "TYO",
  cpu: 2,
  memory_gb: 4,
  disk_gb: 40,
  transfer_tb: 1,
  price_minor: 3900 + i * 1000,
  currency: "CNY",
  price_revision: 7,
  currency_format: cny,
  available: true,
}));
const catalog = {
  revision: 7,
  currency_revision: 3,
  taxonomy_revision: taxonomy.revision,
  items: plans.map(
    ({
      price_minor,
      price_revision: _,
      taxonomy_revision: _t,
      currency: _c,
      currency_format: _f,
      ...p
    }) => ({
      ...p,
      prices: [{ currency: "CNY", amount_minor: price_minor, available: true }],
    }),
  ),
};
let wrappers: VueWrapper[] = [];
function render(component: typeof CatalogPage | typeof AdminCatalogPage) {
  const wrapper = mount(component, {
    props: { locale: "zh-CN", currency: "CNY", mode: "demo" },
    global: { stubs: { OverlayPanel: panel } },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
const button = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll("button").find((b) => b.text() === label)!;
function nextPlanRead(value: unknown) {
  const previous = mocks.read.getMockImplementation()!;
  let pending = true;
  mocks.read.mockImplementation((path: string, query?: unknown) => {
    if (path === "/plans" && pending) {
      pending = false;
      return Promise.resolve(structuredClone(value));
    }
    return previous(path, query);
  });
}
async function selectUi(wrapper: VueWrapper, label: string, option: string) {
  const field = wrapper
    .findAll(".editor-section label.form-group")
    .find((entry) => entry.find(".form-label").text().includes(label))!;
  await field.get('[role="combobox"]').trigger("click");
  await flushPromises();
  const target = [...document.querySelectorAll('[role="option"]')].find(
    (entry) => entry.textContent?.trim() === option,
  )!;
  expect(target).toBeDefined();
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushPromises();
}
let identity = 0;
beforeEach(() => {
  mocks.generation.value = 0;
  mocks.session.value = { user: { id: `unit-account-${++identity}` } };
  mocks.read.mockReset();
  mocks.write.mockReset();
  mocks.read.mockImplementation(async (path: string) =>
    structuredClone(
      path === "/session"
        ? {
            user: mocks.session.value.user
              ? { ...mocks.session.value.user }
              : null,
          }
        : path === "/catalog-taxonomy" || path === "/admin/catalog-taxonomy"
          ? taxonomy
          : path === "/plans"
            ? plans
            : path === "/admin/catalog"
              ? catalog
              : {
                  revision: 3,
                  default_currency: "CNY",
                  currencies: [cny, usd],
                },
    ),
  );
});
afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers = [];
  document.body.innerHTML = "";
});

describe("independent catalog pages", () => {
  it("keeps the full maximum-safe six-decimal quote and 24-byte affixes in the actual editor DOM", async () => {
    const currency = {
      ...cny,
      decimal_places: 6,
      prefix: "P".repeat(24),
      suffix: "S".repeat(24),
    };
    mocks.read.mockImplementation(async (path: string) =>
      structuredClone(
        path === "/admin/catalog"
          ? {
              ...catalog,
              items: [
                {
                  ...catalog.items[0]!,
                  prices: [
                    {
                      currency: "CNY",
                      amount_minor: Number.MAX_SAFE_INTEGER,
                      available: true,
                    },
                  ],
                },
              ],
            }
          : path === "/admin/catalog-taxonomy"
            ? taxonomy
            : { revision: 3, default_currency: "CNY", currencies: [currency] },
      ),
    );
    const wrapper = render(AdminCatalogPage);
    await flushPromises();
    await button(wrapper, "编辑商品").trigger("click");
    await flushPromises();
    const row = wrapper.find(".price-row");
    expect(
      (row.find(".price-amount input").element as HTMLInputElement).value,
    ).toBe("9007199254.740991");
    expect(row.findAll(".price-affix").map((node) => node.text())).toEqual([
      "P".repeat(24),
      "S".repeat(24),
    ]);
    expect(row.find(".price-currency strong").text()).toBe("CNY");
    expect(row.find(".price-amount input").attributes("inputmode")).toBe(
      "decimal",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("starts in the first real region, switches regions and has no comparison or all-regions control", async () => {
    const wrapper = render(CatalogPage);
    await flushPromises();
    expect(wrapper.findAll(".gpc-card")).toHaveLength(2);
    expect(wrapper.findAll(".gpc-title").map((node) => node.text())).toEqual([
      "Plan 0",
      "Plan 1",
    ]);
    expect(
      wrapper.get('.catalog-region button[aria-pressed="true"]').text(),
    ).toBe("HKG");
    expect(
      wrapper.findAll(".catalog-region button").map((node) => node.text()),
    ).toEqual(["HKG", "TYO"]);
    expect(wrapper.text()).not.toContain("全部地区");
    expect(wrapper.text()).not.toContain("对比");
    expect(wrapper.find(".catalog-compare-dock").exists()).toBe(false);
    expect(wrapper.find(".gpc-btn-compare").exists()).toBe(false);
    await button(wrapper, "TYO").trigger("click");
    expect(wrapper.findAll(".gpc-title").map((node) => node.text())).toEqual([
      "Plan 2",
      "Plan 3",
    ]);
    expect(wrapper.find(".catalog-search").exists()).toBe(false);
    expect(wrapper.find(".catalog-sort").exists()).toBe(false);
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.get("h1").text()).toBe("购买云服务器");
    expect(
      wrapper.findAll(".selection-section h2").map((node) => node.text()),
    ).toEqual(["选择类型", "选择地区", "选择套餐", "主机名称"]);
    expect(wrapper.get(".order-summary > h2").text()).toBe("订单详情");
  });
  it("hides redundant navigation for one region without hiding its plans or inventing an all-regions option", async () => {
    nextPlanRead(plans.slice(0, 2));
    const wrapper = render(CatalogPage);
    await flushPromises();
    expect(wrapper.find(".catalog-region").exists()).toBe(false);
    expect(wrapper.findAll(".gpc-card")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("全部地区");
  });
  it("shows an honest empty state when no valid region exists", async () => {
    nextPlanRead([]);
    const wrapper = render(CatalogPage);
    await flushPromises();
    expect(wrapper.text()).toContain("暂无可选地区");
    expect(wrapper.find(".catalog-region").exists()).toBe(false);
    expect(wrapper.findAll(".gpc-card")).toHaveLength(0);
    expect(button(wrapper, "选择此套餐")).toBeUndefined();
  });
  it("preserves a real selected region on refresh but selects the first valid replacement when that region disappears", async () => {
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "TYO").trigger("click");
    await wrapper.get('[aria-label="刷新套餐"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.get('.catalog-region button[aria-pressed="true"]').text(),
    ).toBe("TYO");
    nextPlanRead(plans.slice(0, 2));
    await wrapper.get('[aria-label="刷新套餐"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".gpc-title").map((node) => node.text())).toEqual([
      "Plan 0",
      "Plan 1",
    ]);
    expect(wrapper.find(".catalog-region").exists()).toBe(false);
  });
  it("does not keep a missing region or a cross-currency quote after a currency refresh", async () => {
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "TYO").trigger("click");
    nextPlanRead(
      plans
        .slice(0, 2)
        .map((plan) => ({ ...plan, currency: "USD", currency_format: usd })),
    );
    await wrapper.setProps({ currency: "USD" });
    await flushPromises();
    expect(wrapper.findAll(".gpc-title").map((node) => node.text())).toEqual([
      "Plan 0",
      "Plan 1",
    ]);
    expect(
      wrapper.findAll(".gpc-currency-tag").map((node) => node.text()),
    ).toEqual(["USD", "USD"]);
  });
  it("submits full quote and one idempotency key, without paying or provisioning", async () => {
    mocks.write.mockResolvedValue({
      id: "order-1",
      number: "DEMO-1",
      status: "pending_payment",
      currency: "CNY",
      total_minor: 3900,
      hostname: "my-cloud-01",
      currency_format: cny,
    });
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "选择此套餐").trigger("click");
    await wrapper.find(".hostname-field input").setValue("my-cloud-01");
    await button(wrapper, "确认订单").trigger("click");
    await wrapper.find(".purchase-consent input").setValue(true);
    await button(wrapper, "创建演示订单").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    const [path, body, headers] = mocks.write.mock.calls[0]!;
    expect(path).toBe("/orders");
    expect(body).toEqual({
      plan_id: "plan-0",
      hostname: "my-cloud-01",
      currency: "CNY",
      quote: { price_minor: 3900, decimal_places: 2, price_revision: 7 },
    });
    expect(headers["Idempotency-Key"]).toMatch(/^ui-[a-f0-9-]+$/);
    expect(wrapper.text()).toContain("订单已创建，请前往账单完成付款。");
    expect(wrapper.find(".order-created").text()).not.toContain("已开通");
  });

  it("keeps selection and hostname on the page, requires an explicit review, and clears both when the region changes", async () => {
    const wrapper = render(CatalogPage);
    await flushPromises();
    expect(
      wrapper.get(".hostname-field input").attributes("disabled"),
    ).toBeDefined();
    await button(wrapper, "选择此套餐").trigger("click");
    expect(wrapper.get(".gpc-card.is-selected .gpc-title").text()).toBe(
      "Plan 0",
    );
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
      "¥39.00",
    );
    await wrapper.get(".hostname-field input").setValue("my-cloud-01");
    await button(wrapper, "确认订单").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
    await button(wrapper, "返回修改").trigger("click");
    expect(wrapper.get(".hostname-field input").element.value).toBe(
      "my-cloud-01",
    );
    await button(wrapper, "TYO").trigger("click");
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(false);
    expect(wrapper.get(".hostname-field input").element.value).toBe("");
    expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
      "—",
    );
    expect(button(wrapper, "确认订单").attributes("disabled")).toBeDefined();
  });
  it("does not carry the previous account’s private hostname or selection into a new identity", async () => {
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "选择此套餐").trigger("click");
    await wrapper
      .get(".hostname-field input")
      .setValue("private-original-host");
    mocks.session.value = { user: { id: "new-account" } };
    mocks.generation.value++;
    await flushPromises();
    expect(wrapper.get(".hostname-field input").element.value).toBe("");
    expect(wrapper.text()).not.toContain("private-original-host");
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("invalidates a selected quote on refresh rather than silently replacing its price", async () => {
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "选择此套餐").trigger("click");
    await wrapper.get(".hostname-field input").setValue("my-cloud-01");
    nextPlanRead(
      plans.map((plan) => ({ ...plan, price_minor: 99999, price_revision: 8 })),
    );
    await wrapper.get('[aria-label="刷新套餐"]').trigger("click");
    await flushPromises();
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(false);
    expect(wrapper.get(".order-summary .summary-total strong").text()).toBe(
      "—",
    );
    expect(button(wrapper, "确认订单").attributes("disabled")).toBeDefined();
    expect(wrapper.findAll(".gpc-price-amount")[0]!.text()).toBe("¥999.99");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("locks a conflicting quote until the user explicitly refreshes and selects again", async () => {
    mocks.write.mockRejectedValue({ status: 409, code: "PRICE_CHANGED" });
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "选择此套餐").trigger("click");
    await wrapper.get(".hostname-field input").setValue("my-cloud-01");
    await button(wrapper, "确认订单").trigger("click");
    await wrapper.get(".purchase-consent input").setValue(true);
    await button(wrapper, "创建演示订单").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("报价已变化");
    expect(
      button(wrapper, "创建演示订单").attributes("disabled"),
    ).toBeDefined();
    await button(wrapper, "创建演示订单").trigger("click");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    await button(wrapper, "重新读取报价").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find(".gpc-card.is-selected").exists()).toBe(false);
    expect(button(wrapper, "确认订单").attributes("disabled")).toBeDefined();
  });
  it("saves independent exact minor-unit prices with captured catalog/currency versions and reason", async () => {
    mocks.write.mockImplementation(
      async (
        _path: string,
        { revision, currency_revision, taxonomy_revision, reason: _, ...plan },
      ) => ({
        revision: revision + 1,
        currency_revision,
        taxonomy_revision,
        plan: { ...plan, id: "created-product" },
      }),
    );
    const wrapper = render(AdminCatalogPage);
    await flushPromises();
    await button(wrapper, "新增商品").trigger("click");
    await flushPromises();
    const textFields = wrapper.findAll(
      ".editor-section > label.form-group input",
    );
    await textFields[0]!.setValue("独立测试商品");
    await selectUi(wrapper, "地区", "TYO");
    await wrapper.findAll(".price-amount input")[0]!.setValue("123456789.01");
    await wrapper.findAll(".price-amount input")[1]!.setValue("9.99");
    await wrapper.find(".reason-section textarea").setValue("合成测试新增商品");
    await button(wrapper, "保存商品").trigger("click");
    await flushPromises();
    const [path, body] = mocks.write.mock.calls[0]!;
    expect(path).toBe("/admin/catalog");
    expect(body.revision).toBe(7);
    expect(body.currency_revision).toBe(3);
    expect(body.taxonomy_revision).toBe(taxonomy.revision);
    expect(body.type_id).toBe("cloud");
    expect(body.region_id).toBe("cloud-tyo");
    expect(body.region).toBe("TYO");
    expect(body.reason).toBe("合成测试新增商品");
    expect(body.prices).toEqual([
      { currency: "CNY", amount_minor: 12345678901, available: true },
      { currency: "USD", amount_minor: 999, available: true },
    ]);
    expect(body.available).toBe(false);
    expect(wrapper.text()).toContain("演示更改已保存");
  });
  it("locks another save after version conflicts instead of silently updating the draft revision", async () => {
    mocks.write.mockRejectedValue({ code: "CATALOG_CONFLICT", status: 409 });
    const wrapper = render(AdminCatalogPage);
    await flushPromises();
    await button(wrapper, "编辑商品").trigger("click");
    await flushPromises();
    await wrapper.find(".reason-section textarea").setValue("合成修改原因");
    await button(wrapper, "保存商品").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("草稿没有保存");
    expect(button(wrapper, "保存商品").attributes("disabled")).toBeDefined();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("duplicates through the dedicated revision-checked draft endpoint", async () => {
    mocks.write.mockResolvedValue({
      revision: 8,
      currency_revision: 3,
      taxonomy_revision: taxonomy.revision,
      plan: { ...catalog.items[0], id: "copied-draft", available: false },
    });
    const wrapper = render(AdminCatalogPage);
    await flushPromises();
    await button(wrapper, "复制").trigger("click");
    await flushPromises();
    await wrapper.find(".reason-section textarea").setValue("复制合成草稿");
    await button(wrapper, "复制为草稿").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledWith(
      "/admin/catalog/plan-0/duplicate",
      {
        revision: 7,
        currency_revision: 3,
        taxonomy_revision: taxonomy.revision,
        reason: "复制合成草稿",
      },
    );
  });
  it("treats a malformed successful order as uncertain and keeps the lock across route remount", async () => {
    mocks.write.mockResolvedValue({
      id: "wrong-order",
      number: "BAD",
      status: "paid",
      currency: "USD",
      total_minor: 1,
      hostname: "other-host",
    });
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "选择此套餐").trigger("click");
    await wrapper.find(".hostname-field input").setValue("my-cloud-02");
    await button(wrapper, "确认订单").trigger("click");
    await wrapper.find(".purchase-consent input").setValue(true);
    await button(wrapper, "创建演示订单").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("订单结果尚未确认");
    expect(wrapper.find(".order-created").exists()).toBe(false);
    wrapper.unmount();
    wrappers = wrappers.filter((w) => w !== wrapper);
    const remounted = render(CatalogPage);
    await flushPromises();
    expect(remounted.find(".uncertain-banner").exists()).toBe(true);
    expect(
      button(remounted, "选择此套餐").attributes("disabled"),
    ).toBeDefined();
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("does not strand a restored lock when an earlier mounted request confirms after remount", async () => {
    let finish!: (order: unknown) => void;
    mocks.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const original = render(CatalogPage);
    await flushPromises();
    await button(original, "选择此套餐").trigger("click");
    await original.get(".hostname-field input").setValue("my-cloud-inflight");
    await button(original, "确认订单").trigger("click");
    await original.get(".purchase-consent input").setValue(true);
    await button(original, "创建演示订单").trigger("click");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    original.unmount();
    wrappers = wrappers.filter((w) => w !== original);
    const remounted = render(CatalogPage);
    await flushPromises();
    expect(remounted.find(".uncertain-banner").exists()).toBe(true);
    finish({
      id: "confirmed-after-remount",
      number: "CONFIRMED",
      status: "pending_payment",
      currency: "CNY",
      total_minor: 3900,
      hostname: "my-cloud-inflight",
      currency_format: cny,
    });
    await flushPromises();
    await remounted.get(".order-reconciliation input").setValue(true);
    await button(remounted, "核对这笔订单").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(remounted.emitted("order-created")?.at(-1)).toEqual([""]);
    expect(remounted.find(".uncertain-banner").exists()).toBe(false);
  });
  it("asks an anonymous visitor to sign in without sending an order", async () => {
    mocks.session.value = { user: null };
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "选择此套餐").trigger("click");
    expect(wrapper.emitted("request-sign-in")).toHaveLength(1);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find(".hostname-field input").exists()).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not offer an old-currency quote while its replacement is loading", async () => {
    const wrapper = render(CatalogPage);
    await flushPromises();
    let finish!: (value: unknown) => void;
    const previous = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation((path: string, query?: unknown) =>
      path === "/plans"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : previous(path, query),
    );
    await wrapper.setProps({ currency: "USD" });
    expect(button(wrapper, "选择此套餐").attributes("disabled")).toBeDefined();
    await button(wrapper, "选择此套餐").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    finish(plans.map((p) => ({ ...p, currency: "USD", currency_format: usd })));
    await flushPromises();
    expect(
      button(wrapper, "选择此套餐").attributes("disabled"),
    ).toBeUndefined();
  });
  it("reconciles an uncertain order only after explicit consent and an exact original-account check, reusing body and key", async () => {
    mocks.write
      .mockRejectedValueOnce({ status: 0, uncertain: true })
      .mockResolvedValueOnce({
        id: "original-order",
        number: "ORIGINAL",
        status: "paid",
        currency: "CNY",
        total_minor: 3900,
        hostname: "my-cloud-03",
        currency_format: cny,
      });
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "选择此套餐").trigger("click");
    await wrapper.find(".hostname-field input").setValue("my-cloud-03");
    await button(wrapper, "确认订单").trigger("click");
    await wrapper.find(".purchase-consent input").setValue(true);
    await button(wrapper, "创建演示订单").trigger("click");
    await flushPromises();
    const original = mocks.write.mock.calls[0]!;
    await button(wrapper, "返回修改").trigger("click");
    expect(
      button(wrapper, "核对这笔订单").attributes("disabled"),
    ).toBeDefined();
    await wrapper.find(".order-reconciliation input").setValue(true);
    await button(wrapper, "核对这笔订单").trigger("click");
    await flushPromises();
    expect(mocks.read).toHaveBeenLastCalledWith("/session");
    expect(mocks.write.mock.calls[1]).toEqual(original);
    expect(wrapper.emitted("order-created")?.at(-1)).toEqual([
      "original-order",
    ]);
    expect(wrapper.find(".uncertain-banner").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("已生成待支付订单");
  });
  it("does not replay an uncertain order after the cookie belongs to a different account", async () => {
    mocks.write.mockRejectedValueOnce({ status: 0, uncertain: true });
    const wrapper = render(CatalogPage);
    await flushPromises();
    await button(wrapper, "选择此套餐").trigger("click");
    await wrapper.find(".hostname-field input").setValue("my-cloud-04");
    await button(wrapper, "确认订单").trigger("click");
    await wrapper.find(".purchase-consent input").setValue(true);
    await button(wrapper, "创建演示订单").trigger("click");
    await flushPromises();
    await button(wrapper, "返回修改").trigger("click");
    mocks.read.mockResolvedValueOnce({ user: { id: "different-account" } });
    await wrapper.find(".order-reconciliation input").setValue(true);
    await button(wrapper, "核对这笔订单").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".uncertain-banner").exists()).toBe(true);
    expect(wrapper.text()).toContain(
      "这笔订单仍未确认，请用原账户查看订单，勿重复下单。",
    );
  });
  it("does not announce a catalog save when a valid-looking result belongs to a different product", async () => {
    mocks.write.mockResolvedValue({
      revision: 8,
      currency_revision: 3,
      taxonomy_revision: taxonomy.revision,
      plan: { ...catalog.items[0], id: "other-product" },
    });
    const wrapper = render(AdminCatalogPage);
    await flushPromises();
    await button(wrapper, "编辑商品").trigger("click");
    await flushPromises();
    await wrapper.find(".reason-section textarea").setValue("合成编辑原因");
    await button(wrapper, "保存商品").trigger("click");
    await flushPromises();
    expect(wrapper.find(".saved-message").exists()).toBe(false);
    expect(wrapper.text()).toContain("保存结果尚未确认");
    expect(button(wrapper, "保存商品").attributes("disabled")).toBeDefined();
  });
});
