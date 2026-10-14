// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import FinancialSettingsPage from "../src/components/FinancialSettingsPage.vue";
import { setCsrf } from "../src/lib/api";
import { locale } from "../src/lib/i18n";
import type {
  CurrencyDefinition,
  CurrencyRegistry,
  PlanPriceList,
} from "../src/lib/currencies";

const usage = {
  plan_prices: 2,
  orders: 1,
  invoices: 1,
  services: 1,
  pending_orders: 0,
  unpaid_invoices: 0,
  ongoing_services: 0,
};
const cny = (
  changes: Partial<CurrencyDefinition> = {},
): CurrencyDefinition => ({
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
  enabled: true,
  sort_order: 0,
  precision_locked: true,
  usage: { ...usage },
  ...changes,
});
const usd = (changes: Partial<CurrencyDefinition> = {}): CurrencyDefinition =>
  cny({
    code: "USD",
    name: "US Dollar",
    prefix: "$",
    sort_order: 1,
    ...changes,
  });
const registry = (
  changes: Partial<CurrencyRegistry> = {},
): CurrencyRegistry => ({
  revision: 4,
  default_currency: "CNY",
  currencies: [cny()],
  ...changes,
});
const prices = (
  format = cny(),
  changes: Partial<PlanPriceList> = {},
): PlanPriceList => ({
  revision: 8,
  currency: format.code,
  currency_format: format,
  plans: [
    {
      plan_id: "basic",
      plan_name: "Aster Basic",
      plan_available: true,
      amount: format.decimal_places
        ? `39.${"0".repeat(format.decimal_places)}`
        : "39",
      amount_minor: 39 * 10 ** format.decimal_places,
      available: true,
    },
    {
      plan_id: "large",
      plan_name: "Aster Large",
      plan_available: true,
      amount: "",
      amount_minor: 0,
      available: false,
    },
  ],
  ...changes,
});
const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const failure = (code: string) => ({
  ok: false,
  json: async () => ({
    error: { code, message: "private-financial-diagnostic" },
  }),
});
const wrappers: VueWrapper[] = [];
function open(preview = false) {
  const wrapper = mount(FinancialSettingsPage, {
    props: { preview },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
const fetchInitial = (r = registry(), p = prices()) =>
  vi.fn().mockResolvedValueOnce(reply(r)).mockResolvedValueOnce(reply(p));
const submit = async (w: VueWrapper, form = "currency") => {
  await w.get(`[data-testid="${form}-form"]`).trigger("submit");
  await flushPromises();
};
const isDisabled = (w: VueWrapper, selector: string) =>
  (w.get(selector).element as HTMLInputElement).matches(":disabled");
beforeEach(() => {
  locale.value = "zh-CN";
  setCsrf("financial-csrf");
});
afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers.length = 0;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("financial administration", () => {
  it("loads persisted CNY-only data and protects existing codes, precision and the default", async () => {
    const fetcher = fetchInitial();
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/admin/currencies",
      "/api/v1/admin/plan-prices?currency=CNY",
    ]);
    expect(w.findAll('[name="pricing_currency"] option')).toHaveLength(1);
    for (const field of ["code", "decimal_places", "enabled"])
      expect(isDisabled(w, `[name="currency-0-${field}"]`)).toBe(true);
    expect(w.text()).toContain("已有金额记录，精度已锁定");
    expect(w.text()).toContain("历史订单和账单保留原币种与金额");
    expect(w.text()).toContain("套餐总开关");
    expect(w.get('[data-plan="large"]').text()).toContain("未设置价格");
    expect(isDisabled(w, '[name="price-1-available"]')).toBe(true);
  });

  it("saves the whole revisioned currency registry with CSRF and excludes usage metadata", async () => {
    const updated = registry({
      revision: 5,
      currencies: [cny({ name: "Chinese Yuan", suffix: " 元" })],
    });
    const fetcher = fetchInitial()
      .mockResolvedValueOnce(reply(updated))
      .mockResolvedValueOnce(reply(prices(updated.currencies[0])));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="currency-0-name"]').setValue("Chinese Yuan");
    await w.get('[name="currency-0-suffix"]').setValue(" 元");
    await submit(w);
    const request = fetcher.mock.calls[2]![1];
    expect(request.method).toBe("POST");
    expect(request.headers["X-CSRF-Token"]).toBe("financial-csrf");
    expect(JSON.parse(request.body)).toEqual({
      revision: 4,
      default_currency: "CNY",
      currencies: [
        {
          code: "CNY",
          name: "Chinese Yuan",
          prefix: "¥",
          suffix: " 元",
          decimal_places: 2,
          enabled: true,
          sort_order: 0,
        },
      ],
    });
    expect(w.emitted("saved")?.[0]?.[0]).toEqual(updated);
    expect(w.text()).toContain("币种配置已保存");
    expect(isDisabled(w, '[data-testid="currency-form"] [type="submit"]')).toBe(
      true,
    );
  });

  it("refreshes the precision lock and revision after recording a currency's first price", async () => {
    const unlocked = cny({
      precision_locked: false,
      usage: { ...usage, plan_prices: 0 },
    });
    const initial = prices(unlocked, {
      plans: [
        {
          ...prices().plans[0]!,
          amount: "",
          amount_minor: 0,
          available: false,
        },
      ],
    });
    const saved = prices(cny(), {
      revision: 9,
      plans: [
        {
          ...prices().plans[0]!,
          amount: "1.20",
          amount_minor: 120,
          available: false,
        },
      ],
    });
    const locked = registry({ revision: 5 });
    const fetcher = fetchInitial(registry({ currencies: [unlocked] }), initial)
      .mockResolvedValueOnce(reply(saved))
      .mockResolvedValueOnce(reply(locked))
      .mockResolvedValueOnce(
        reply(
          registry({ revision: 6, currencies: [cny({ name: "Renminbi" })] }),
        ),
      )
      .mockResolvedValueOnce(reply(saved));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    expect(isDisabled(w, '[name="currency-0-decimal_places"]')).toBe(false);
    await w.get('[name="price-0-amount"]').setValue("1.20");
    await submit(w, "price");
    expect(w.emitted("pricesSaved")).toHaveLength(1);
    expect(isDisabled(w, '[name="currency-0-decimal_places"]')).toBe(true);
    await w.get('[name="currency-0-name"]').setValue("Renminbi");
    await submit(w);
    expect(JSON.parse(fetcher.mock.calls[4]![1].body).revision).toBe(5);
    expect(w.emitted("saved")?.at(-1)).toEqual([
      expect.objectContaining({ revision: 6 }),
    ]);
  });

  it("keeps a confirmed price save but blocks stale registry edits when lock refresh fails", async () => {
    const unlocked = cny({ precision_locked: false });
    const fetcher = fetchInitial(
      registry({ currencies: [unlocked] }),
      prices(unlocked),
    )
      .mockResolvedValueOnce(reply(prices(cny(), { revision: 9 })))
      .mockResolvedValueOnce(failure("SERVER_ERROR"));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="price-0-amount"]').setValue("40");
    await submit(w, "price");
    expect(w.emitted("pricesSaved")).toHaveLength(1);
    expect(w.get('[data-testid="currency-error"]').text()).toContain(
      "无法读取财务配置",
    );
    expect(
      isDisabled(w, '[data-testid="currency-form"] button[type="submit"]'),
    ).toBe(true);
    expect(
      fetcher.mock.calls.filter((call) => call[1].method === "POST"),
    ).toHaveLength(1);
  });

  it("adds a currency without an implicit exchange price and allows removing only unsaved entries", async () => {
    const jpy = cny({
      code: "JPY",
      name: "Japanese Yen",
      prefix: "¥",
      decimal_places: 0,
      sort_order: 1,
      precision_locked: false,
      usage: undefined,
    });
    const fetcher = fetchInitial()
      .mockResolvedValueOnce(
        reply(registry({ revision: 5, currencies: [cny(), jpy] })),
      )
      .mockResolvedValueOnce(reply(prices()));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[data-testid="add-currency"]').trigger("click");
    expect(w.findAll(".currency-card")).toHaveLength(2);
    expect(isDisabled(w, '[name="currency-1-code"]')).toBe(false);
    expect(isDisabled(w, '[name="currency-1-decimal_places"]')).toBe(false);
    await w.get('[name="currency-1-code"]').setValue("JPY");
    await w.get('[name="currency-1-name"]').setValue("Japanese Yen");
    await w.get('[name="currency-1-prefix"]').setValue("¥");
    await w.get('[name="currency-1-decimal_places"]').setValue(0);
    await w.get('[name="currency-1-enabled"]').setValue(true);
    await submit(w);
    const body = JSON.parse(fetcher.mock.calls[2]![1].body);
    expect(body.currencies[1]).toMatchObject({
      code: "JPY",
      decimal_places: 0,
      enabled: true,
    });
    expect(body).not.toHaveProperty("prices");
    expect(w.findAll(".currency-title button")).toHaveLength(0);
    await w.get('[data-testid="add-currency"]').trigger("click");
    await w.get(".currency-title button").trigger("click");
    expect(w.findAll(".currency-card")).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("requires an enabled default and explains active obligations independently of historical usage", async () => {
    const dollar = usd({
      usage: {
        ...usage,
        pending_orders: 2,
        unpaid_invoices: 3,
        ongoing_services: 1,
      },
    });
    const fetcher = fetchInitial(registry({ currencies: [cny(), dollar] }));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    expect(isDisabled(w, '[name="currency-1-enabled"]')).toBe(true);
    expect(w.get('[data-currency="USD"]').text()).toContain("不能停用");
    await w.get('[name="default_currency"]').setValue("USD");
    expect(isDisabled(w, '[name="currency-0-enabled"]')).toBe(false);
    await w.get('[name="currency-0-enabled"]').setValue(false);
    expect(
      w
        .findAll('[name="default_currency"] option')
        .map((item) => item.attributes("value")),
    ).toEqual(["USD"]);
  });

  it.each([
    ["currency-0-name", "中".repeat(27)],
    ["currency-0-prefix", "中".repeat(9)],
    ["currency-0-suffix", "<img>"],
    ["currency-0-name", "name\u202e"],
    ["currency-0-sort_order", "10001"],
  ])(
    "rejects invalid currency field %s before any write and focuses the field",
    async (field, value) => {
      const fetcher = fetchInitial();
      vi.stubGlobal("fetch", fetcher);
      const w = open();
      await flushPromises();
      await w.get(`[name="${field}"]`).setValue(value);
      await submit(w);
      expect(w.get(`[name="${field}"]`).attributes("aria-invalid")).toBe(
        "true",
      );
      expect(document.activeElement?.getAttribute("name")).toBe(field);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(w.emitted("saved")).toBeUndefined();
    },
  );

  it("rejects duplicate or lowercase new codes without crashing the draft editor", async () => {
    const fetcher = fetchInitial();
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[data-testid="add-currency"]').trigger("click");
    await w.get('[name="currency-1-name"]').setValue("Duplicate");
    for (const code of ["cny", "CNY"]) {
      await w.get('[name="currency-1-code"]').setValue(code);
      await submit(w);
      expect(w.get('[name="currency-1-code"]').attributes("aria-invalid")).toBe(
        "true",
      );
    }
    await w.get(".currency-title button").trigger("click");
    expect(w.findAll(".currency-card")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("saves an exact six-decimal price at the safe minor-unit limit and only posts changed rows", async () => {
    const token = cny({
      code: "TOK",
      name: "Token",
      prefix: "",
      suffix: " tk",
      decimal_places: 6,
    });
    const r = registry({ default_currency: "TOK", currencies: [token] });
    const p = prices(token);
    const saved = prices(token, {
      revision: 9,
      plans: [
        {
          ...p.plans[0]!,
          amount: "9007199254.740991",
          amount_minor: Number.MAX_SAFE_INTEGER,
        },
        p.plans[1]!,
      ],
    });
    const fetcher = fetchInitial(r, p).mockResolvedValueOnce(reply(saved));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    expect(w.get('[name="price-0-amount"]').attributes("type")).toBe("text");
    await w.get('[name="price-0-amount"]').setValue("9007199254.740991");
    expect(isDisabled(w, '[name="pricing_currency"]')).toBe(true);
    expect(
      isDisabled(w, '[data-testid="currency-form"] button[type="submit"]'),
    ).toBe(true);
    await submit(w, "price");
    expect(fetcher.mock.calls[2]![0]).toBe("/api/v1/admin/plan-prices");
    expect(JSON.parse(fetcher.mock.calls[2]![1].body)).toEqual({
      revision: 8,
      currency: "TOK",
      prices: [
        {
          plan_id: "basic",
          amount: "9007199254.740991",
          available: true,
          plan_available: true,
        },
      ],
    });
    expect(w.emitted("pricesSaved")).toHaveLength(1);
    expect(w.text()).toContain("套餐价格已保存");
  });

  it.each(["", "0", "-1", "1e3", "1,000", "1.001", "90071992547409.92"])(
    "rejects invalid price %j without a write",
    async (value) => {
      const fetcher = fetchInitial();
      vi.stubGlobal("fetch", fetcher);
      const w = open();
      await flushPromises();
      await w.get('[name="price-0-amount"]').setValue(value);
      await submit(w, "price");
      expect(w.get('[name="price-0-amount"]').attributes("aria-invalid")).toBe(
        "true",
      );
      expect(document.activeElement?.getAttribute("name")).toBe(
        "price-0-amount",
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(w.emitted("pricesSaved")).toBeUndefined();
    },
  );

  it("focuses an invalid price after a currency validation error has been corrected", async () => {
    const fetcher = fetchInitial();
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="currency-0-name"]').setValue("");
    await submit(w);
    expect(w.get('[name="currency-0-name"]').attributes("aria-invalid")).toBe(
      "true",
    );
    await w.get('[name="currency-0-name"]').setValue("人民币");
    expect(
      w.get('[name="currency-0-name"]').attributes("aria-invalid"),
    ).toBeUndefined();
    expect(w.find('[data-testid="currency-error"]').exists()).toBe(false);
    await w.get('[name="price-0-amount"]').setValue("1.001");
    await submit(w, "price");
    expect(document.activeElement?.getAttribute("name")).toBe("price-0-amount");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("requires explicitly enabling a newly entered independent price and preserves the global plan flag", async () => {
    const p = prices();
    const saved = prices(cny(), {
      revision: 9,
      plans: [
        p.plans[0]!,
        {
          ...p.plans[1]!,
          amount: "79.00",
          amount_minor: 7900,
          available: true,
          plan_available: false,
        },
      ],
    });
    const fetcher = fetchInitial().mockResolvedValueOnce(reply(saved));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="price-1-amount"]').setValue("79");
    expect(
      (w.get('[name="price-1-available"]').element as HTMLInputElement).checked,
    ).toBe(false);
    await w.get('[name="price-1-available"]').setValue(true);
    await w.get('[name="price-1-plan-available"]').setValue(false);
    await submit(w, "price");
    expect(JSON.parse(fetcher.mock.calls[2]![1].body).prices).toEqual([
      {
        plan_id: "large",
        amount: "79.00",
        available: true,
        plan_available: false,
      },
    ]);
    expect(w.get('[data-plan="large"]').text()).toContain("不可购买");
  });

  it("allows staging prices for a disabled currency while explaining that purchases remain unavailable", async () => {
    const dollar = usd({ enabled: false });
    const p = prices(dollar);
    const fetcher = fetchInitial(
      registry({ currencies: [cny(), dollar] }),
    ).mockResolvedValueOnce(reply(p));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="pricing_currency"]').setValue("USD");
    await flushPromises();
    expect(w.get('[data-testid="disabled-currency-notice"]').text()).toContain(
      "保存价格不会启用币种",
    );
    expect(isDisabled(w, '[name="price-0-amount"]')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("loads a selected currency's independent prices and clears stale prices when the read fails", async () => {
    const fetcher = fetchInitial(registry({ currencies: [cny(), usd()] }))
      .mockResolvedValueOnce(failure("FORBIDDEN"))
      .mockResolvedValueOnce(reply(prices(usd())));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="pricing_currency"]').setValue("USD");
    await flushPromises();
    expect(fetcher.mock.calls[2]![0]).toBe(
      "/api/v1/admin/plan-prices?currency=USD",
    );
    expect(w.find('[name="price-0-amount"]').exists()).toBe(false);
    expect(w.text()).not.toContain("private-financial-diagnostic");
    await w.get('[data-testid="price-error"] button').trigger("click");
    await flushPromises();
    expect(w.get(".price-input").text()).toContain("USD");
  });

  it.each([
    ["currency", "CURRENCY_CONFLICT", "其他管理员"],
    ["currency", "CURRENCY_IN_USE", "不能停用"],
    ["currency", "CURRENCY_PRECISION_LOCKED", "不能更改小数位数"],
    ["price", "PRICE_CONFLICT", "其他管理员"],
    ["price", "CURRENCY_DISABLED", "状态已变化"],
    ["price", "PLAN_UNAVAILABLE", "状态已变化"],
    ["price", "CSRF_INVALID", "重新登录"],
  ])(
    "blocks %s writes after %s and preserves the draft for explicit reload",
    async (form, code, message) => {
      const fetcher = fetchInitial().mockResolvedValueOnce(failure(code));
      vi.stubGlobal("fetch", fetcher);
      const w = open();
      await flushPromises();
      const selector =
        form === "currency"
          ? '[name="currency-0-name"]'
          : '[name="price-0-amount"]';
      const value = form === "currency" ? "My draft" : "42.00";
      await w.get(selector).setValue(value);
      await submit(w, form);
      expect(w.get(`[data-testid="${form}-error"]`).text()).toContain(message);
      expect((w.get(selector).element as HTMLInputElement).value).toBe(value);
      expect(w.text()).not.toContain("private-financial-diagnostic");
      await submit(w, form);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(
        w.emitted(form === "currency" ? "saved" : "pricesSaved"),
      ).toBeUndefined();
    },
  );

  it("shows validated authoritative blocker counts instead of provider diagnostics", async () => {
    const fetcher = fetchInitial(
      registry({ currencies: [cny(), usd()] }),
    ).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: {
          code: "CURRENCY_IN_USE",
          message: "private-financial-diagnostic",
          details: {
            currency: "USD",
            usage: {
              ...usage,
              pending_orders: 7,
              unpaid_invoices: 9,
              ongoing_services: 2,
            },
            secret: "do-not-render",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="currency-1-enabled"]').setValue(false);
    await submit(w);
    const notice = w.get('[data-testid="currency-blocker-counts"]').text();
    expect(notice).toContain("USD");
    expect(notice).toContain("待付款订单 7");
    expect(notice).toContain("未付账单 9");
    expect(notice).toContain("运行中服务 2");
    expect(w.text()).not.toContain("do-not-render");
    expect(w.text()).not.toContain("private-financial-diagnostic");
  });

  it("uses a safe blocker explanation when error details are malformed", async () => {
    const fetcher = fetchInitial(
      registry({ currencies: [cny(), usd()] }),
    ).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: {
          code: "CURRENCY_IN_USE",
          details: {
            currency: "<script>",
            usage: { ...usage, ongoing_services: -1 },
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="currency-1-enabled"]').setValue(false);
    await submit(w);
    expect(w.get('[data-testid="currency-error"]').text()).toContain(
      "不能停用",
    );
    expect(w.find('[data-testid="currency-blocker-counts"]').exists()).toBe(
      false,
    );
    expect(w.find("script").exists()).toBe(false);
  });

  it("reloads after a currency conflict and discards only the explicitly reloaded draft", async () => {
    const fetcher = fetchInitial()
      .mockResolvedValueOnce(failure("CURRENCY_CONFLICT"))
      .mockResolvedValueOnce(
        reply(
          registry({ revision: 5, currencies: [cny({ name: "Other admin" })] }),
        ),
      )
      .mockResolvedValueOnce(reply(prices()));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="currency-0-name"]').setValue("My draft");
    await submit(w);
    await w.get('[data-testid="reload-currencies"]').trigger("click");
    await flushPromises();
    expect(
      (w.get('[name="currency-0-name"]').element as HTMLInputElement).value,
    ).toBe("Other admin");
    expect(w.find('[data-testid="currency-error"]').exists()).toBe(false);
    expect(w.text()).not.toContain("币种配置已保存");
  });

  it.each(["currency", "price"])(
    "does not claim success or retry an unknown %s save outcome",
    async (form) => {
      const fetcher = fetchInitial().mockRejectedValueOnce(
        new Error("private-network-detail"),
      );
      vi.stubGlobal("fetch", fetcher);
      const w = open();
      await flushPromises();
      await w
        .get(
          form === "currency"
            ? '[name="currency-0-name"]'
            : '[name="price-0-amount"]',
        )
        .setValue(form === "currency" ? "Draft" : "40");
      await submit(w, form);
      expect(w.get(`[data-testid="${form}-error"]`).text()).toContain(
        "无法确认保存结果",
      );
      await submit(w, form);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(w.text()).not.toContain("private-network-detail");
      expect(
        w.emitted(form === "currency" ? "saved" : "pricesSaved"),
      ).toBeUndefined();
    },
  );

  it("rejects a success-shaped stale save response", async () => {
    const fetcher = fetchInitial().mockResolvedValueOnce(reply(registry()));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    await w.get('[name="currency-0-name"]').setValue("Draft");
    await submit(w);
    expect(w.get('[data-testid="currency-error"]').text()).toContain(
      "无法确认保存结果",
    );
    expect(w.emitted("saved")).toBeUndefined();
  });

  it("retries a failed registry read without rendering a stale editor", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(failure("FORBIDDEN"))
      .mockResolvedValueOnce(reply(registry()))
      .mockResolvedValueOnce(reply(prices()));
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    expect(w.find("form").exists()).toBe(false);
    expect(w.text()).not.toContain("private-financial-diagnostic");
    await w.get('[data-testid="currency-error"] button').trigger("click");
    await flushPromises();
    expect(w.find('[data-testid="price-form"]').exists()).toBe(true);
  });

  it("keeps preview read-only even for programmatic submissions and reloads", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const w = open(true);
    await flushPromises();
    expect(w.text()).toContain("只读预览");
    expect(
      isDisabled(w, '[data-testid="currency-form"] button[type="submit"]'),
    ).toBe(true);
    expect(isDisabled(w, '[name="price-0-amount"]')).toBe(true);
    await submit(w);
    await submit(w, "price");
    await w.get('[data-testid="reload-currencies"]').trigger("click");
    await flushPromises();
    expect(fetcher).not.toHaveBeenCalled();
    expect(w.emitted("saved")).toBeUndefined();
    expect(w.emitted("pricesSaved")).toBeUndefined();
  });

  it("ignores a late live read after switching into preview", async () => {
    let finish!: (value: unknown) => void;
    const fetcher = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await w.setProps({ preview: true });
    await flushPromises();
    finish(reply(registry({ currencies: [cny({ name: "Late response" })] })));
    await flushPromises();
    expect(
      (w.get('[name="currency-0-name"]').element as HTMLInputElement).value,
    ).toBe("人民币");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["currency", "price"])(
    "ignores a late %s save response after switching into preview",
    async (form) => {
      let finish!: (value: unknown) => void;
      const fetcher = fetchInitial().mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetcher);
      const w = open();
      await flushPromises();
      await w
        .get(
          form === "currency"
            ? '[name="currency-0-name"]'
            : '[name="price-0-amount"]',
        )
        .setValue(form === "currency" ? "Draft" : "40");
      await w.get(`[data-testid="${form}-form"]`).trigger("submit");
      await w.setProps({ preview: true });
      await flushPromises();
      finish(
        reply(
          form === "currency"
            ? registry({ revision: 5 })
            : prices(cny(), { revision: 9 }),
        ),
      );
      await flushPromises();
      expect(
        w.emitted(form === "currency" ? "saved" : "pricesSaved"),
      ).toBeUndefined();
      expect(w.text()).toContain("只读预览");
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it("provides English labels and errors without changing currency or interpreting a comma decimal", async () => {
    locale.value = "en";
    const fetcher = fetchInitial();
    vi.stubGlobal("fetch", fetcher);
    const w = open();
    await flushPromises();
    expect(w.text()).toContain("Currencies and plan pricing");
    expect(w.text()).toContain("Plan enabled globally");
    expect(
      (w.get('[name="pricing_currency"]').element as HTMLSelectElement).value,
    ).toBe("CNY");
    await w.get('[name="price-0-amount"]').setValue("39,50");
    await submit(w, "price");
    expect(w.get('[data-testid="price-error"]').text()).toContain(
      "Check the highlighted fields",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
