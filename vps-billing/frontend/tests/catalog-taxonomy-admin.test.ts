// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import CatalogTaxonomyManager from "../src/components/CatalogTaxonomyManager.vue";
import AdminCatalogPage from "../src/pages/AdminCatalogPage.vue";
import type { CatalogTaxonomy } from "../src/services/catalog-taxonomy";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  generation: null as unknown as Ref<number>,
}));
vi.mock("../src/composables/useWorkspace", async () => {
  const { ref } = await import("vue");
  mocks.generation = ref(0);
  return { useWorkspace: () => ({ ...mocks }) };
});
const panel = defineComponent({
  props: ["open", "title", "busy"],
  template:
    '<section v-if="open" role="dialog"><h2>{{title}}</h2><slot/><footer><slot name="footer"/></footer></section>',
});
const baseTaxonomy: CatalogTaxonomy = {
  revision: 4,
  types: [
    { id: "compute", name: "计算型", sort_order: 10, enabled: true },
    { id: "general", name: "通用型", sort_order: 20, enabled: true },
  ],
  regions: [
    {
      id: "compute-hk",
      type_id: "compute",
      name: "香港",
      sort_order: 10,
      enabled: true,
    },
    {
      id: "general-hk",
      type_id: "general",
      name: "香港",
      sort_order: 10,
      enabled: true,
    },
  ],
};
const currency = {
  code: "CNY",
  name: "人民币",
  prefix: "¥",
  suffix: "",
  decimal_places: 2,
  enabled: true,
};
const baseCatalog = {
  revision: 7,
  currency_revision: 3,
  taxonomy_revision: 4,
  items: [
    {
      id: "compute-small",
      type_id: "compute",
      region_id: "compute-hk",
      name: "Compute Plan",
      region: "香港",
    },
    {
      id: "general-small",
      type_id: "general",
      region_id: "general-hk",
      name: "General Plan",
      region: "香港",
    },
  ].map((row) => ({
    ...row,
    description: "Synthetic catalog fixture",
    cpu: 2,
    memory_gb: 4,
    disk_gb: 40,
    transfer_tb: 1,
    available: true,
    prices: [{ currency: "CNY", amount_minor: 3900, available: true }],
  })),
};
let taxonomy: CatalogTaxonomy;
let catalog: typeof baseCatalog;
let wrappers: VueWrapper[] = [];
function manager(open = true) {
  const wrapper = mount(CatalogTaxonomyManager, {
    props: { open, locale: "zh-CN" },
    global: { stubs: { OverlayPanel: panel } },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
function products() {
  const wrapper = mount(AdminCatalogPage, {
    props: { locale: "zh-CN", currency: "CNY", mode: "api" },
    global: { stubs: { OverlayPanel: panel } },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}
const button = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll("button").find((row) => row.text() === text)!;
async function tab(wrapper: VueWrapper, name: "types" | "regions") {
  await wrapper
    .findAll(".taxonomy-tabs button")
    [name === "types" ? 0 : 1]!.trigger("click");
}
async function select(trigger: ReturnType<VueWrapper["get"]>, text: string) {
  await trigger.trigger("click");
  await flushPromises();
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (row) => row.textContent?.trim() === text,
  )!;
  expect(option).toBeDefined();
  option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushPromises();
}
async function editName(wrapper: VueWrapper, value = "新的计算型") {
  await wrapper.get('[aria-label="类型 1 名称"]').setValue(value);
  await wrapper.get(".taxonomy-reason textarea").setValue("合成分类调整原因");
}
function successfulWrite(_path: string, body: CatalogTaxonomy) {
  return Promise.resolve({
    revision: body.revision + 1,
    types: structuredClone(body.types),
    regions: structuredClone(body.regions),
  });
}
beforeEach(() => {
  taxonomy = structuredClone(baseTaxonomy);
  catalog = structuredClone(baseCatalog);
  mocks.generation.value = 0;
  mocks.read.mockReset();
  mocks.write.mockReset();
  mocks.read.mockImplementation(async (path: string) => {
    if (path === "/admin/catalog-taxonomy") return structuredClone(taxonomy);
    if (path === "/admin/catalog") return structuredClone(catalog);
    if (path === "/admin/currencies")
      return { revision: 3, default_currency: "CNY", currencies: [currency] };
    throw new Error("Unexpected taxonomy test read");
  });
  mocks.write.mockImplementation(successfulWrite);
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
  document.body.innerHTML = "";
});

describe("actual taxonomy manager editor", () => {
  it("adds, renames, reorders and disables a type through the actual controls before explicit save", async () => {
    const wrapper = manager();
    await flushPromises();
    expect(mocks.read).toHaveBeenCalledWith("/admin/catalog-taxonomy");
    expect(button(wrapper, "保存分类").attributes("disabled")).toBeDefined();
    await button(wrapper, "新增类型").trigger("click");
    await wrapper.get('[aria-label="类型 3 名称"]').setValue("  新增类型  ");
    await wrapper.get('[aria-label="类型 3 排序"]').setValue("5");
    await wrapper.findAll(".taxonomy-enabled input")[2]!.setValue(false);
    await wrapper.get(".taxonomy-reason textarea").setValue("  合成新增类型  ");
    expect(mocks.write).not.toHaveBeenCalled();
    await button(wrapper, "保存分类").trigger("click");
    await flushPromises();
    const [path, body] = mocks.write.mock.calls[0]!;
    expect(path).toBe("/admin/catalog-taxonomy");
    expect(body.revision).toBe(4);
    expect(body.reason).toBe("合成新增类型");
    expect(body.types[2]).toMatchObject({
      name: "新增类型",
      sort_order: 5,
      enabled: false,
    });
    expect(body.types[2].id).toMatch(/^type-[a-f0-9-]+$/);
    expect(body.regions).toEqual(baseTaxonomy.regions);
    expect(wrapper.emitted("changed")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("adds a real child region, changes its parent using UiSelect, preserves its authoritative name and disables it", async () => {
    const wrapper = manager();
    await flushPromises();
    await tab(wrapper, "regions");
    await button(wrapper, "新增地区").trigger("click");
    await wrapper.get('[aria-label="地区 3 名称"]').setValue("新增香港");
    await select(wrapper.get('[aria-label="地区 3 所属类型"]'), "通用型");
    await wrapper.get('[aria-label="地区 3 排序"]').setValue("0");
    await wrapper.findAll(".taxonomy-enabled input")[2]!.setValue(false);
    await wrapper.get(".taxonomy-reason textarea").setValue("合成新增地区");
    expect(wrapper.find("select").exists()).toBe(false);
    await button(wrapper, "保存分类").trigger("click");
    await flushPromises();
    const body = mocks.write.mock.calls[0]![1];
    expect(body.regions[2]).toMatchObject({
      type_id: "general",
      name: "新增香港",
      sort_order: 0,
      enabled: false,
    });
    expect(body.regions[2].id).toMatch(/^region-[a-f0-9-]+$/);
  });

  it("re-enables a disabled type without rewriting its immutable ID", async () => {
    taxonomy.types[0]!.enabled = false;
    const wrapper = manager();
    await flushPromises();
    await wrapper.findAll(".taxonomy-enabled input")[0]!.setValue(true);
    await wrapper.get(".taxonomy-reason textarea").setValue("启用合成类型");
    await button(wrapper, "保存分类").trigger("click");
    await flushPromises();
    expect(mocks.write.mock.calls[0]![1].types[0]).toEqual({
      ...baseTaxonomy.types[0],
      enabled: true,
    });
  });

  it("removes only draft rows locally and requires children to be removed or reassigned before their parent", async () => {
    const wrapper = manager();
    await flushPromises();
    await wrapper.get('[aria-label="移除类型 计算型"]').trigger("click");
    expect(wrapper.text()).toContain("该类型下还有地区");
    expect(wrapper.findAll(".taxonomy-row")).toHaveLength(2);
    await tab(wrapper, "regions");
    await wrapper.findAll(".taxonomy-remove")[0]!.trigger("click");
    expect(wrapper.findAll(".taxonomy-row")).toHaveLength(1);
    await tab(wrapper, "types");
    await wrapper.get('[aria-label="移除类型 计算型"]').trigger("click");
    expect(wrapper.findAll(".taxonomy-row")).toHaveLength(1);
    expect(mocks.write).not.toHaveBeenCalled();
    await wrapper.get(".taxonomy-reason textarea").setValue("移除合成草稿分类");
    await button(wrapper, "保存分类").trigger("click");
    await flushPromises();
    expect(
      mocks.write.mock.calls[0]![1].types.map((row: { id: string }) => row.id),
    ).toEqual(["general"]);
    expect(
      mocks.write.mock.calls[0]![1].regions.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual(["general-hk"]);
  });

  it.each(["", "x".repeat(501)])(
    "requires a bounded nonempty reason without dispatching a save",
    async (reason) => {
      const wrapper = manager();
      await flushPromises();
      await editName(wrapper);
      await wrapper.get(".taxonomy-reason textarea").setValue(reason);
      await button(wrapper, "保存分类").trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("操作原因");
      expect(mocks.write).not.toHaveBeenCalled();
      expect(wrapper.emitted("changed")).toBeUndefined();
    },
  );

  it.each(["", "x".repeat(121), "bad\u0000name"])(
    "rejects an invalid type name before saving",
    async (name) => {
      const wrapper = manager();
      await flushPromises();
      await editName(wrapper, name);
      await button(wrapper, "保存分类").trigger("click");
      await flushPromises();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it.each(["-1", "1000001", "1.5"])(
    "rejects invalid sort order %s before saving",
    async (order) => {
      const wrapper = manager();
      await flushPromises();
      await editName(wrapper);
      await wrapper.get('[aria-label="类型 1 排序"]').setValue(order);
      await button(wrapper, "保存分类").trigger("click");
      await flushPromises();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("caps type drafts at 128 rows and does not add a 129th", async () => {
    taxonomy = {
      revision: 4,
      types: Array.from({ length: 128 }, (_, index) => ({
        id: `type-${index}`,
        name: `Type ${index}`,
        sort_order: index,
        enabled: true,
      })),
      regions: [],
    };
    const wrapper = manager();
    await flushPromises();
    expect(wrapper.findAll(".taxonomy-row")).toHaveLength(128);
    expect(button(wrapper, "新增类型").attributes("disabled")).toBeDefined();
    await button(wrapper, "新增类型").trigger("click");
    expect(wrapper.findAll(".taxonomy-row")).toHaveLength(128);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("caps region drafts at 512 rows and does not add a 513th", async () => {
    taxonomy.regions = Array.from({ length: 512 }, (_, index) => ({
      id: `region-${index}`,
      type_id: "compute",
      name: `Region ${index}`,
      sort_order: index,
      enabled: true,
    }));
    const wrapper = manager();
    await flushPromises();
    await tab(wrapper, "regions");
    expect(wrapper.findAll(".taxonomy-row")).toHaveLength(512);
    expect(button(wrapper, "新增地区").attributes("disabled")).toBeDefined();
    await button(wrapper, "新增地区").trigger("click");
    expect(wrapper.findAll(".taxonomy-row")).toHaveLength(512);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("retains the draft after in-use 409, shows the reason, and permits a subsequent deliberate corrected save", async () => {
    mocks.write.mockRejectedValueOnce({ code: "TAXONOMY_IN_USE", status: 409 });
    const wrapper = manager();
    await flushPromises();
    await editName(wrapper);
    await button(wrapper, "保存分类").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("分类仍被商品引用");
    expect(
      (wrapper.get('[aria-label="类型 1 名称"]').element as HTMLInputElement)
        .value,
    ).toBe("新的计算型");
    expect(wrapper.get(".taxonomy-row").attributes("disabled")).toBeUndefined();
    expect(wrapper.emitted("changed")).toBeUndefined();
    await wrapper
      .get('[aria-label="类型 1 名称"]')
      .setValue("明确修正后的类型");
    await button(wrapper, "保存分类").trigger("click");
    await flushPromises();
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("blocks resubmission after a taxonomy conflict until the draft is explicitly discarded and re-read", async () => {
    mocks.write.mockRejectedValueOnce({
      code: "TAXONOMY_CONFLICT",
      status: 409,
    });
    const wrapper = manager();
    await flushPromises();
    await editName(wrapper);
    await button(wrapper, "保存分类").trigger("click");
    await flushPromises();
    expect(button(wrapper, "保存分类").attributes("disabled")).toBeDefined();
    await button(wrapper, "保存分类").trigger("click");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    taxonomy.revision = 5;
    taxonomy.types[0]!.name = "实际后端名称";
    await button(wrapper, "丢弃草稿并读取最新分类").trigger("click");
    await flushPromises();
    expect(
      (wrapper.get('[aria-label="类型 1 名称"]').element as HTMLInputElement)
        .value,
    ).toBe("实际后端名称");
    expect(
      (wrapper.get(".taxonomy-reason textarea").element as HTMLTextAreaElement)
        .value,
    ).toBe("");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it.each([{ status: 500 }, { status: 0, uncertain: true }])(
    "locks repeat submission after an uncertain write without pretending it failed safely",
    async (error) => {
      mocks.write.mockRejectedValueOnce(error);
      const wrapper = manager();
      await flushPromises();
      await editName(wrapper);
      await button(wrapper, "保存分类").trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("保存结果尚未确认");
      expect(wrapper.emitted("changed")).toBeUndefined();
      expect(button(wrapper, "保存分类").attributes("disabled")).toBeDefined();
      await button(wrapper, "保存分类").trigger("click");
      expect(mocks.write).toHaveBeenCalledTimes(1);
      await button(wrapper, "取消").trigger("click");
      expect(wrapper.emitted("close")).toHaveLength(1);
      expect(wrapper.find(".taxonomy-alert").exists()).toBe(false);
    },
  );

  it("treats a valid-looking but changed success response as uncertain rather than announcing a save", async () => {
    mocks.write.mockImplementationOnce(async (_path, body) => ({
      revision: body.revision + 1,
      types: body.types.map((row: unknown, index: number) =>
        index ? row : { ...(row as object), name: "Unexpected server name" },
      ),
      regions: body.regions,
    }));
    const wrapper = manager();
    await flushPromises();
    await editName(wrapper);
    await button(wrapper, "保存分类").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("保存结果尚未确认");
    expect(wrapper.emitted("changed")).toBeUndefined();
    expect(button(wrapper, "保存分类").attributes("disabled")).toBeDefined();
  });

  it("confirms dirty closing and keeps edits when the operator chooses to continue", async () => {
    const wrapper = manager();
    await flushPromises();
    await editName(wrapper);
    await button(wrapper, "取消").trigger("click");
    expect(wrapper.find(".taxonomy-alert").exists()).toBe(true);
    expect(wrapper.emitted("close")).toBeUndefined();
    await button(wrapper, "继续编辑").trigger("click");
    expect(wrapper.find(".taxonomy-alert").exists()).toBe(false);
    expect(
      (wrapper.get('[aria-label="类型 1 名称"]').element as HTMLInputElement)
        .value,
    ).toBe("新的计算型");
    await button(wrapper, "取消").trigger("click");
    await button(wrapper, "放弃更改").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("removes a pending discard prompt when saving and guards its retained actions until taxonomy acknowledgement", async () => {
    let acknowledge!: (value: unknown) => void;
    mocks.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const wrapper = manager();
    await flushPromises();
    await editName(wrapper);
    await button(wrapper, "取消").trigger("click");
    expect(wrapper.find(".taxonomy-alert").exists()).toBe(true);
    const discard = button(wrapper, "放弃更改").element;
    const keep = button(wrapper, "继续编辑").element;
    await button(wrapper, "保存分类").trigger("click");
    expect(wrapper.find(".taxonomy-alert").exists()).toBe(false);
    expect(button(wrapper, "取消").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "保存中…").attributes("disabled")).toBeDefined();
    // A previously queued click must not bypass the handler's busy guard.
    discard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    keep.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("close")).toBeUndefined();
    expect(wrapper.emitted("changed")).toBeUndefined();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    const sent = mocks.write.mock.calls[0]![1];
    acknowledge({
      revision: sent.revision + 1,
      types: sent.types,
      regions: sent.regions,
    });
    await flushPromises();
    expect(wrapper.emitted("changed")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("rejects a late prior-identity read while showing only the new identity's registry", async () => {
    let finishOld!: (value: unknown) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const wrapper = manager();
    await flushPromises();
    taxonomy.types[0]!.name = "New identity category";
    mocks.generation.value++;
    await flushPromises();
    finishOld(baseTaxonomy);
    await flushPromises();
    expect(
      (wrapper.get('[aria-label="类型 1 名称"]').element as HTMLInputElement)
        .value,
    ).toBe("New identity category");
    expect(wrapper.emitted("changed")).toBeUndefined();
  });

  it("ignores a late prior-identity save and never closes or overwrites the new editor", async () => {
    let finishOld!: (value: unknown) => void;
    mocks.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const wrapper = manager();
    await flushPromises();
    await editName(wrapper);
    await button(wrapper, "保存分类").trigger("click");
    expect(button(wrapper, "取消").attributes("disabled")).toBeDefined();
    const originalBody = mocks.write.mock.calls[0]![1];
    taxonomy.types[0]!.name = "New identity authoritative category";
    mocks.generation.value++;
    await flushPromises();
    finishOld({
      revision: 5,
      types: originalBody.types,
      regions: originalBody.regions,
    });
    await flushPromises();
    expect(
      (wrapper.get('[aria-label="类型 1 名称"]').element as HTMLInputElement)
        .value,
    ).toBe("New identity authoritative category");
    expect(wrapper.emitted("changed")).toBeUndefined();
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("does not expose editable defaults after a missing taxonomy read and supports read-only recovery", async () => {
    mocks.read.mockRejectedValueOnce({ status: 503 });
    const wrapper = manager();
    await flushPromises();
    expect(wrapper.find(".taxonomy-row").exists()).toBe(false);
    expect(button(wrapper, "保存分类").attributes("disabled")).toBeDefined();
    await button(wrapper, "重新读取").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".taxonomy-row")).toHaveLength(2);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe("admin products consume the same actual taxonomy", () => {
  it("loads three real reads and filters same-name regions by parent IDs", async () => {
    const wrapper = products();
    await flushPromises();
    for (const path of [
      "/admin/catalog",
      "/admin/currencies",
      "/admin/catalog-taxonomy",
    ])
      expect(mocks.read).toHaveBeenCalledWith(path);
    const filters = wrapper.findAll(
      '.classification-filters [role="combobox"]',
    );
    await select(filters[0]!, "通用型");
    await filters[1]!.trigger("click");
    await flushPromises();
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    (document.querySelectorAll('[role="option"]')[1] as HTMLElement).click();
    await flushPromises();
    expect(
      wrapper.findAll(".product-name h2").map((row) => row.text()),
    ).toEqual(["General Plan"]);
    expect(wrapper.find("select").exists()).toBe(false);
  });

  it("uses actual type and region selects and clears an old child when its parent changes", async () => {
    const wrapper = products();
    await flushPromises();
    await button(wrapper, "编辑商品").trigger("click");
    await flushPromises();
    const selects = wrapper.findAll('.editor-section [role="combobox"]');
    expect(selects[1]!.attributes("value")).toBe("compute-hk");
    await select(selects[0]!, "通用型");
    expect(selects[1]!.attributes("value")).toBe("");
    expect(selects[1]!.text()).toContain("选择地区");
    await wrapper
      .get(".reason-section textarea")
      .setValue("必须明确重新选地区");
    await button(wrapper, "保存商品").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("请选择商品所属的类型和地区");
    expect(mocks.write).not.toHaveBeenCalled();
    await select(selects[1]!, "香港");
    expect(selects[1]!.attributes("value")).toBe("general-hk");
  });

  it("defaults a new draft to a real enabled type and requires an explicit region choice", async () => {
    const wrapper = products();
    await flushPromises();
    await button(wrapper, "新增商品").trigger("click");
    await flushPromises();
    const selects = wrapper.findAll('.editor-section [role="combobox"]');
    expect(selects[0]!.attributes("value")).toBe("compute");
    expect(selects[1]!.attributes("value")).toBe("");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not let an existing product discard prompt close an in-flight save before its exact acknowledgement", async () => {
    let acknowledge!: (value: unknown) => void;
    mocks.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const wrapper = products();
    await flushPromises();
    await button(wrapper, "编辑商品").trigger("click");
    await flushPromises();
    await wrapper
      .get(".editor-section > label.form-group input")
      .setValue("Confirmed new product name");
    await wrapper
      .get(".reason-section textarea")
      .setValue("合成保存与放弃交错回归");
    await button(wrapper, "取消").trigger("click");
    expect(wrapper.find(".discard-confirmation").exists()).toBe(true);
    const discard = button(wrapper, "放弃草稿").element;
    const keep = button(wrapper, "继续编辑").element;
    await button(wrapper, "保存商品").trigger("click");
    expect(wrapper.find(".discard-confirmation").exists()).toBe(false);
    expect(button(wrapper, "取消").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "保存中…").attributes("disabled")).toBeDefined();
    discard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    keep.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(wrapper.find(".price-editor").exists()).toBe(true);
    expect(wrapper.find(".saved-message").exists()).toBe(false);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    const {
      revision,
      currency_revision,
      taxonomy_revision,
      reason: _reason,
      ...plan
    } = mocks.write.mock.calls[0]![1];
    const confirmed = { ...plan, id: catalog.items[0]!.id };
    catalog = {
      ...catalog,
      revision: revision + 1,
      items: [confirmed, catalog.items[1]!],
    };
    acknowledge({
      revision: revision + 1,
      currency_revision,
      taxonomy_revision,
      plan: confirmed,
    });
    await flushPromises();
    expect(wrapper.find(".price-editor").exists()).toBe(false);
    expect(wrapper.get(".saved-message").text()).toContain("商品已保存");
  });

  it("does not offer any enabled create action when no enabled parent/region combination exists", async () => {
    catalog.items = [];
    taxonomy.types.forEach((row) => {
      row.enabled = false;
    });
    const wrapper = products();
    await flushPromises();
    expect(wrapper.text()).toContain("先添加并启用服务器类型和地区");
    const create = wrapper
      .findAll("button")
      .filter((row) => row.text() === "新增商品");
    expect(create.length).toBeGreaterThan(0);
    expect(
      create.every((row) => row.attributes("disabled") !== undefined),
    ).toBe(true);
    for (const action of create) await action.trigger("click");
    await flushPromises();
    expect(wrapper.find(".price-editor").exists()).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([
    "taxonomy revision",
    "currency revision",
    "unknown region",
    "wrong parent",
    "wrong display name",
  ])(
    "fails closed on %s instead of exposing a product editor",
    async (fault) => {
      if (fault === "taxonomy revision") catalog.taxonomy_revision = 3;
      if (fault === "currency revision") catalog.currency_revision = 2;
      if (fault === "unknown region") catalog.items[0]!.region_id = "invented";
      if (fault === "wrong parent") catalog.items[0]!.type_id = "general";
      if (fault === "wrong display name")
        catalog.items[0]!.region = "Not authoritative";
      const wrapper = products();
      await flushPromises();
      expect(wrapper.text()).toContain("无法读取商品");
      expect(wrapper.findAll(".product-row")).toHaveLength(0);
      expect(button(wrapper, "新增商品").attributes("disabled")).toBeDefined();
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the third taxonomy read is absent rather than inferring type/region from product strings", async () => {
    const previous = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation((path: string) =>
      path === "/admin/catalog-taxonomy"
        ? Promise.reject({ status: 404 })
        : previous(path),
    );
    const wrapper = products();
    await flushPromises();
    expect(wrapper.text()).toContain("无法读取商品");
    expect(wrapper.findAll(".product-row")).toHaveLength(0);
    expect(wrapper.find(".price-editor").exists()).toBe(false);
  });
});
