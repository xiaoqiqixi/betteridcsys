<script setup lang="ts">
import UiLoading from "../components/UiLoading.vue";
import UiSpinner from "../components/UiSpinner.vue";
import UiSelect from "../components/UiSelect.vue";
import CatalogTaxonomyManager from "../components/CatalogTaxonomyManager.vue";
import ProductConfigurationPanel from "../components/ProductConfigurationPanel.vue";
import {
  type CatalogTaxonomy,
  sortCatalogEntries,
  validCatalogTaxonomy,
} from "../services/catalog-taxonomy";

import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  ArrowUpRight,
  Check,
  Copy,
  FilePenLine,
  Layers,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X,
} from "@lucide/vue";
import OverlayPanel from "../components/OverlayPanel.vue";
import ProductSpecs from "../components/ProductSpecs.vue";
import { useWorkspace } from "../composables/useWorkspace";
import { formatMoney, formatMinor, parseMinor } from "../types/idc";

const props = defineProps<{
  locale: "zh-CN" | "en";
  currency: string;
  mode: "demo" | "api";
}>();
interface CurrencyDefinition {
  code: string;
  name: string;
  prefix: string;
  suffix: string;
  decimal_places: number;
  enabled: boolean;
}
interface Registry {
  revision: number;
  default_currency: string;
  currencies: CurrencyDefinition[];
}
interface CatalogPrice {
  currency: string;
  amount_minor: number;
  available: boolean;
}
interface CatalogItem {
  id: string;
  type_id: string;
  region_id: string;
  node_id: string;
  name: string;
  description: string;
  region: string;
  cpu: number;
  memory_gb: number;
  disk_gb: number;
  transfer_tb: number;
  available: boolean;
  prices: CatalogPrice[];
}
interface Catalog {
  taxonomy_revision: number;
  revision: number;
  currency_revision: number;
  items: CatalogItem[];
}
interface CatalogResult {
  taxonomy_revision: number;
  revision: number;
  currency_revision: number;
  plan: CatalogItem;
}
const { read, write, generation: identityGeneration } = useWorkspace();
const en = computed(() => props.locale === "en");
const t = (zh: string, english: string) => (en.value ? english : zh);
const catalog = ref<Catalog | null>(null);
const registry = ref<Registry | null>(null);
const taxonomy = ref<CatalogTaxonomy | null>(null);
const taxonomyOpen = ref(false);
const configuringProduct = ref<CatalogItem | null>(null);
const catalogElement = ref<HTMLElement | null>(null);
const productFocus = ref<{
  planId: string;
  identity: number;
  mode: "demo" | "api";
} | null>(null);
let mounted = true;
const filterType = ref("");
const filterRegion = ref("");
const filterNode = ref("");
const loading = ref(true);
const loadError = ref("");
const query = ref("");
const filter = ref("all");
const editorOpen = ref(false);
const editorMode = ref<"create" | "edit" | "duplicate">("create");
const editingId = ref("");
const saving = ref(false);
const saveError = ref("");
const conflict = ref(false);
const uncertain = ref(false);
const success = ref("");
const discardConfirmation = ref(false);
const originalDraft = ref("");
const draftState = () =>
  JSON.stringify({
    ...form,
    prices: priceFields.value.map((row) => [
      row.currency.code,
      row.amount,
      row.available,
    ]),
  });
const form = reactive({
  name: "",
  description: "",
  region: "",
  type_id: "",
  region_id: "",
  node_id: "",
  cpu: "2",
  memory_gb: "4",
  disk_gb: "40",
  transfer_tb: "1",
  available: false,
  reason: "",
});
const priceFields = ref<
  { currency: CurrencyDefinition; amount: string; available: boolean }[]
>([]);
const draftRevision = ref(0);
const draftCurrencyRevision = ref(0);
const draftTaxonomyRevision = ref(0);
const typeOptions = computed(() =>
  sortCatalogEntries(taxonomy.value?.types || [])
    .filter((row) => row.enabled || row.id === form.type_id)
    .map((row) => ({
      value: row.id,
      label: row.name + (row.enabled ? "" : t("（已停用）", " (disabled)")),
    })),
);
const regionOptions = computed(() =>
  sortCatalogEntries(taxonomy.value?.regions || [])
    .filter(
      (row) =>
        row.type_id === form.type_id &&
        (row.enabled || row.id === form.region_id),
    )
    .map((row) => ({
      value: row.id,
      label: row.name + (row.enabled ? "" : t("（已停用）", " (disabled)")),
    })),
);
const nodeOptions = computed(() =>
  sortCatalogEntries(taxonomy.value?.nodes || [])
    .filter(
      (row) =>
        row.region_id === form.region_id &&
        (row.enabled || row.id === form.node_id),
    )
    .map((row) => ({
      value: row.id,
      label: row.name + (row.enabled ? "" : t("（已停用）", " (disabled)")),
    })),
);
const filterNodes = computed(() => [
  { value: "", label: t("不限节点", "Any node") },
  ...sortCatalogEntries(taxonomy.value?.nodes || [])
    .filter(
      (row) =>
        (!filterRegion.value || row.region_id === filterRegion.value) &&
        (!filterType.value ||
          taxonomy.value?.regions.some(
            (region) =>
              region.id === row.region_id &&
              region.type_id === filterType.value,
          )),
    )
    .map((row) => ({ value: row.id, label: row.name })),
]);
const filterTypes = computed(() => [
  { value: "", label: t("所有类型", "All types") },
  ...sortCatalogEntries(taxonomy.value?.types || []).map((row) => ({
    value: row.id,
    label: row.name,
  })),
]);
const filterRegions = computed(() => [
  { value: "", label: t("不限地区", "Any region") },
  ...sortCatalogEntries(taxonomy.value?.regions || [])
    .filter((row) => !filterType.value || row.type_id === filterType.value)
    .map((row) => ({ value: row.id, label: row.name })),
]);
const canCreate = computed(
  () =>
    taxonomy.value?.nodes.some(
      (node) =>
        node.enabled &&
        taxonomy.value?.regions.some(
          (region) =>
            region.id === node.region_id &&
            region.enabled &&
            taxonomy.value?.types.some(
              (type) => type.id === region.type_id && type.enabled,
            ),
        ),
    ) ?? false,
);
const nodeName = (id: string) =>
  taxonomy.value?.nodes.find((row) => row.id === id)?.name || "—";
const typeName = (id: string) =>
  taxonomy.value?.types.find((row) => row.id === id)?.name || "—";
watch(
  () => form.type_id,
  () => {
    if (
      !taxonomy.value?.regions.some(
        (row) => row.id === form.region_id && row.type_id === form.type_id,
      )
    ) {
      form.region_id = "";
      form.region = "";
    }
  },
);
watch(
  () => form.region_id,
  () => {
    if (
      !taxonomy.value?.nodes.some(
        (node) => node.id === form.node_id && node.region_id === form.region_id,
      )
    ) {
      const available =
        taxonomy.value?.nodes.filter(
          (node) => node.region_id === form.region_id && node.enabled,
        ) || [];
      form.node_id = available.length === 1 ? available[0]!.id : "";
    }
    form.region =
      taxonomy.value?.regions.find(
        (row) => row.id === form.region_id && row.type_id === form.type_id,
      )?.name || "";
  },
);
watch(filterType, () => {
  filterRegion.value = "";
  filterNode.value = "";
});
watch(filterRegion, () => {
  filterNode.value = "";
});
let generation = 0;
const visibleItems = computed(() =>
  (catalog.value?.items || []).filter(
    (item) =>
      (!filterType.value || item.type_id === filterType.value) &&
      (!filterRegion.value || item.region_id === filterRegion.value) &&
      (!filterNode.value || item.node_id === filterNode.value) &&
      (filter.value === "all" ||
        item.available === (filter.value === "published")) &&
      `${item.name} ${item.description} ${typeName(item.type_id)} ${item.region} ${nodeName(item.node_id)} ${item.id}`
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
);
const publishedCount = computed(
  () => catalog.value?.items.filter((item) => item.available).length || 0,
);
const draftCount = computed(
  () => (catalog.value?.items.length || 0) - publishedCount.value,
);
const editorTitle = computed(() =>
  editorMode.value === "create"
    ? t("新增商品", "Create product")
    : editorMode.value === "duplicate"
      ? t("复制为新草稿", "Duplicate as a draft")
      : t("编辑商品", "Edit product"),
);
const byteLength = (value: string) => new TextEncoder().encode(value).length;
function money(price: CatalogPrice) {
  return formatMoney(
    price.amount_minor,
    registry.value?.currencies.find((c) => c.code === price.currency),
    props.locale,
  );
}
function priceFor(item: CatalogItem) {
  return item.prices.find((p) => p.currency === props.currency);
}
function safeError(e: unknown) {
  const err = e as { code?: string; requestId?: string };
  const messages: Record<string, string> = {
    FORBIDDEN: t(
      "当前账户没有商品管理权限。",
      "This account cannot manage products.",
    ),
    CATALOG_CONFLICT: t(
      "商品目录已被其他操作更新。草稿没有保存，请丢弃草稿并读取最新目录后重新编辑。",
      "The catalog has changed. This draft was not saved. Discard it and reload before editing again.",
    ),
    CURRENCY_CONFLICT: t(
      "币种精度或元数据已变化。不能用新版本替旧金额背书，请重新读取并核对定价。",
      "Currency metadata changed. Reload and review prices using the current precision.",
    ),
    TAXONOMY_CONFLICT: t(
      "类型、地区或节点已更新，请重新读取分类并核对商品归属。",
      "Types, regions or nodes changed. Reload and check the product category.",
    ),
    INVALID_CATALOG: t(
      "商品信息未通过校验，请检查规格、价格和修改原因。",
      "Check the specifications, prices and change reason.",
    ),
    CSRF_INVALID: t(
      "会话已变化，请刷新并重新登录。",
      "Your session changed. Refresh and sign in again.",
    ),
  };
  return (
    (messages[err.code || ""] ||
      t(
        "请求未完成，请稍后再试。",
        "The request could not be completed. Try again later.",
      )) +
    (err.requestId && /^[a-f0-9]{32}$/.test(err.requestId)
      ? ` · ${t("请求编号", "Request ID")} ${err.requestId}`
      : "")
  );
}
async function load() {
  const id = ++generation;
  loading.value = true;
  loadError.value = "";
  try {
    const [nextCatalog, nextRegistry, nextTaxonomy] = await Promise.all([
      read<Catalog>("/admin/catalog"),
      read<Registry>("/admin/currencies"),
      read<unknown>("/admin/catalog-taxonomy"),
    ]);
    if (id !== generation) return;
    if (nextCatalog.currency_revision !== nextRegistry.revision) {
      loadError.value = t(
        "读取期间币种版本发生变化，请重新读取，避免使用错误精度。",
        "Currency metadata changed while loading. Reload to use the correct precision.",
      );
      return;
    }
    if (
      !validCatalogTaxonomy(nextTaxonomy) ||
      nextCatalog.taxonomy_revision !== nextTaxonomy.revision ||
      nextCatalog.items.some(
        (item) =>
          !nextTaxonomy.regions.some(
            (row) =>
              row.id === item.region_id &&
              row.type_id === item.type_id &&
              row.name === item.region,
          ) ||
          !nextTaxonomy.nodes.some(
            (node) =>
              node.id === item.node_id && node.region_id === item.region_id,
          ),
      )
    ) {
      loadError.value = t(
        "类型、地区与节点在读取期间发生变化，请重新读取后核对商品归属。",
        "Categories changed while loading. Reload to check product categories.",
      );
      return;
    }
    catalog.value = nextCatalog;
    registry.value = nextRegistry;
    taxonomy.value = nextTaxonomy;
  } catch (e) {
    if (id === generation) loadError.value = safeError(e);
  } finally {
    if (id === generation) loading.value = false;
  }
}
function openProductConfiguration(item: CatalogItem) {
  productFocus.value = null;
  configuringProduct.value = item;
}
function closeProductConfiguration() {
  if (!configuringProduct.value) return;
  productFocus.value = {
    planId: configuringProduct.value.id,
    identity: identityGeneration.value,
    mode: props.mode,
  };
  configuringProduct.value = null;
}
watch(
  [loading, configuringProduct, productFocus],
  async ([pending, product, request]) => {
    if (pending || product || !request) return;
    await nextTick();
    if (
      !mounted ||
      productFocus.value !== request ||
      loading.value ||
      configuringProduct.value ||
      identityGeneration.value !== request.identity ||
      props.mode !== request.mode
    )
      return;
    productFocus.value = null;
    const trigger = [
      ...(catalogElement.value?.querySelectorAll<HTMLButtonElement>(
        "[data-product-configuration-id]",
      ) || []),
    ].find(
      (button) => button.dataset.productConfigurationId === request.planId,
    );
    if (
      trigger?.isConnected &&
      !trigger.disabled &&
      !trigger.closest("[inert]")
    )
      trigger.focus();
  },
  { flush: "post" },
);
async function openEditor(
  mode: "create" | "edit" | "duplicate",
  item?: CatalogItem,
) {
  // Fetch latest global revisions before starting a draft, never while submitting it.
  const identity = identityGeneration.value;
  await load();
  if (
    identity !== identityGeneration.value ||
    loading.value ||
    loadError.value ||
    !catalog.value ||
    !registry.value ||
    !taxonomy.value ||
    (mode === "create" && !canCreate.value)
  )
    return;
  const freshItem = item
    ? catalog.value.items.find((p) => p.id === item.id)
    : undefined;
  if (item && !freshItem) {
    loadError.value = t(
      "商品已不存在，请重新选择。",
      "This product no longer exists. Choose another product.",
    );
    return;
  }
  editorMode.value = mode;
  editingId.value = freshItem?.id || "";
  form.name = freshItem?.name || "";
  form.description = freshItem?.description || "";
  form.type_id =
    freshItem?.type_id ||
    filterType.value ||
    sortCatalogEntries(taxonomy.value.types).find((row) => row.enabled)?.id ||
    "";
  const defaultRegion = taxonomy.value.regions.find(
    (row) =>
      row.id === filterRegion.value &&
      row.type_id === form.type_id &&
      row.enabled,
  );
  form.region_id = freshItem?.region_id || defaultRegion?.id || "";
  form.node_id =
    freshItem?.node_id ||
    taxonomy.value.nodes.find(
      (node) =>
        node.id === filterNode.value &&
        node.region_id === form.region_id &&
        node.enabled,
    )?.id ||
    "";
  form.region =
    taxonomy.value.regions.find((row) => row.id === form.region_id)?.name || "";
  form.cpu = String(freshItem?.cpu || 2);
  form.memory_gb = String(freshItem?.memory_gb || 4);
  form.disk_gb = String(freshItem?.disk_gb || 40);
  form.transfer_tb = String(freshItem?.transfer_tb || 1);
  form.available = freshItem?.available || false;
  form.reason = "";
  priceFields.value = registry.value.currencies.map((currency) => {
    const price = freshItem?.prices.find((p) => p.currency === currency.code);
    return {
      currency: { ...currency },
      amount: price
        ? formatMinor(price.amount_minor, currency.decimal_places)
        : "",
      available: price?.available ?? true,
    };
  });
  draftRevision.value = catalog.value.revision;
  draftCurrencyRevision.value = registry.value.revision;
  draftTaxonomyRevision.value = taxonomy.value.revision;
  saveError.value = "";
  conflict.value = false;
  uncertain.value = false;
  success.value = "";
  originalDraft.value = draftState();
  discardConfirmation.value = false;
  editorOpen.value = true;
}
function closeEditor() {
  if (saving.value) return;
  if (!uncertain.value && draftState() !== originalDraft.value) {
    discardConfirmation.value = true;
    return;
  }
  editorOpen.value = false;
}
function keepEditing() {
  if (!saving.value) discardConfirmation.value = false;
}
function discardDraft() {
  if (saving.value) return;
  editorOpen.value = false;
  discardConfirmation.value = false;
}
const preview = computed(() => ({
  cpu: Number(form.cpu) || 0,
  memory_gb: Number(form.memory_gb) || 0,
  disk_gb: Number(form.disk_gb) || 0,
  transfer_tb: Number(form.transfer_tb) || 0,
}));
function validate() {
  if (!form.reason.trim() || byteLength(form.reason.trim()) > 500)
    return t(
      "请填写 1–500 字节的操作原因。",
      "Enter a change reason between 1 and 500 UTF-8 bytes.",
    );
  if (editorMode.value === "duplicate") return "";
  if (!form.name.trim() || byteLength(form.name.trim()) > 120)
    return t(
      "商品名称必填，最多 120 字节。",
      "A product name is required (up to 120 UTF-8 bytes).",
    );
  const category = taxonomy.value?.types.find((row) => row.id === form.type_id);
  const location = taxonomy.value?.regions.find(
    (row) => row.id === form.region_id && row.type_id === form.type_id,
  );
  const node = taxonomy.value?.nodes.find(
    (row) => row.id === form.node_id && row.region_id === form.region_id,
  );
  if (!category || !location || !node || location.name !== form.region)
    return t(
      "请选择商品所属的类型、地区和节点。",
      "Select the product's type, region and node.",
    );
  if (
    form.available &&
    (!category.enabled || !location.enabled || !node.enabled)
  )
    return t(
      "上架前请先启用所属类型、地区和节点。",
      "Enable this type, region and node before publishing.",
    );
  if (byteLength(form.description.trim()) > 500)
    return t(
      "商品描述最多 500 字节。",
      "Description is limited to 500 UTF-8 bytes.",
    );
  for (const [field, max] of [
    ["cpu", 4096],
    ["memory_gb", 1048576],
    ["disk_gb", 16777216],
    ["transfer_tb", 1048576],
  ] as const)
    if (!/^[1-9]\d*$/.test(form[field]) || Number(form[field]) > max)
      return t(
        "规格必须为允许范围内的正整数。",
        "Specifications must be positive integers within the allowed limits.",
      );
  try {
    for (const row of priceFields.value)
      if (row.amount.trim())
        parseMinor(row.amount.trim(), row.currency.decimal_places);
  } catch {
    return t(
      "价格必须为正十进制金额，不接受零价、指数或超出币种精度。",
      "Prices must be positive decimals without exponent notation or excess decimal places.",
    );
  }
  if (
    form.available &&
    !priceFields.value.some(
      (row) => row.currency.enabled && row.available && row.amount.trim(),
    )
  )
    return t(
      "上架至少需要一种启用币种的有效可售报价。",
      "Publishing requires an available quote in at least one enabled currency.",
    );
  return "";
}
async function save() {
  if (!editorOpen.value || saving.value || conflict.value || uncertain.value)
    return;
  saveError.value = validate();
  if (saveError.value) return;
  discardConfirmation.value = false;
  saving.value = true;
  const identity = identityGeneration.value;
  try {
    let result: CatalogResult;
    const common = {
      revision: draftRevision.value,
      currency_revision: draftCurrencyRevision.value,
      taxonomy_revision: draftTaxonomyRevision.value,
      reason: form.reason.trim(),
    };
    const expected = {
      name: form.name.trim(),
      description:
        editorMode.value === "duplicate"
          ? form.description
          : form.description.trim(),
      type_id: form.type_id,
      region_id: form.region_id,
      node_id: form.node_id,
      region: form.region,
      cpu: Number(form.cpu),
      memory_gb: Number(form.memory_gb),
      disk_gb: Number(form.disk_gb),
      transfer_tb: Number(form.transfer_tb),
      available: editorMode.value === "duplicate" ? false : form.available,
      prices: priceFields.value
        .filter((row) => row.amount.trim())
        .map((row) => ({
          currency: row.currency.code,
          amount_minor: parseMinor(
            row.amount.trim(),
            row.currency.decimal_places,
          ),
          available: row.available,
        })),
    };
    if (editorMode.value === "duplicate")
      result = await write<CatalogResult>(
        `/admin/catalog/${encodeURIComponent(editingId.value)}/duplicate`,
        common,
      );
    else {
      const body = { ...common, ...expected };
      result = await write<CatalogResult>(
        editorMode.value === "create"
          ? "/admin/catalog"
          : `/admin/catalog/${encodeURIComponent(editingId.value)}`,
        body,
      );
    }
    if (identity !== identityGeneration.value) return;
    const returned = result?.plan;
    const canonicalPrices = (prices: CatalogPrice[]) =>
      JSON.stringify(
        [...prices].sort((a, b) => a.currency.localeCompare(b.currency)),
      );
    if (
      !returned ||
      result.revision !== draftRevision.value + 1 ||
      result.currency_revision < draftCurrencyRevision.value ||
      result.taxonomy_revision !== draftTaxonomyRevision.value ||
      (editorMode.value === "edit"
        ? returned.id !== editingId.value
        : !returned.id ||
          catalog.value?.items.some((p) => p.id === returned.id)) ||
      (Object.keys(expected) as (keyof typeof expected)[]).some(
        (key) => key !== "prices" && returned[key] !== expected[key],
      ) ||
      !Array.isArray(returned.prices) ||
      canonicalPrices(returned.prices) !== canonicalPrices(expected.prices)
    )
      throw { uncertain: true };
    editorOpen.value = false;
    success.value =
      props.mode === "demo"
        ? t(
            "演示更改已保存，仅存在于此浏览器预览中。",
            "Demo changes saved in this browser preview only.",
          )
        : editorMode.value === "duplicate"
          ? t(
              "已复制为新草稿，请编辑并核对价格后上架。",
              "A new draft was created. Review its specifications and prices before publishing.",
            )
          : t(
              "商品已保存，仅对新订单生效。",
              "Product saved. Changes apply to new orders.",
            );
    await load();
    if (editorMode.value === "duplicate") {
      const copied = catalog.value?.items.find((p) => p.id === result.plan.id);
      if (copied) await openEditor("edit", copied);
    }
  } catch (e) {
    if (identity !== identityGeneration.value) return;
    const err = e as { status?: number; code?: string; uncertain?: boolean };
    conflict.value =
      err.code === "CATALOG_CONFLICT" ||
      err.code === "CURRENCY_CONFLICT" ||
      err.code === "TAXONOMY_CONFLICT";
    uncertain.value = !!err.uncertain || !err.status || err.status >= 500;
    saveError.value = uncertain.value
      ? t(
          "保存结果尚未确认，已停止重复提交。请先关闭编辑器并刷新目录核对，不能把网络错误视为保存失败。",
          "The save outcome is uncertain. Repeat submissions are blocked. Close the editor and reload the catalog to check before trying again.",
        )
      : safeError(e);
  } finally {
    saving.value = false;
  }
}
watch(
  () => [props.mode, identityGeneration.value],
  () => {
    editorOpen.value = false;
    catalog.value = null;
    registry.value = null;
    taxonomy.value = null;
    taxonomyOpen.value = false;
    configuringProduct.value = null;
    productFocus.value = null;
    filterType.value = filterRegion.value = filterNode.value = "";
    success.value = "";
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  mounted = false;
  productFocus.value = null;
  generation++;
});
</script>

<template>
  <section ref="catalogElement" class="admin-catalog">
    <header class="page-heading">
      <div>
        <h1>{{ t("商品管理", "Products") }}</h1>
        <p>
          {{
            t(
              "从规格到报价，一处管理。新版本只影响之后的订单。",
              "Specifications and quotes, in one place. Changes apply to future orders only.",
            )
          }}
        </p>
      </div>
      <div class="catalog-heading-actions">
        <button
          class="btn btn-secondary"
          :disabled="loading"
          @click="taxonomyOpen = true"
        >
          <Layers :size="16" />{{
            t("类型、地区与节点", "Types, regions and nodes")
          }}
        </button>
        <button
          class="btn btn-admin create-button"
          :disabled="loading || !!loadError || !canCreate"
          @click="openEditor('create')"
        >
          <Plus :size="16" />{{ t("新增商品", "New product") }}
        </button>
      </div>
    </header>
    <div v-if="!loading && !loadError" class="classification-filters">
      <label class="form-group"
        ><span class="form-label">{{ t("服务器类型", "Server type") }}</span
        ><UiSelect v-model="filterType" :options="filterTypes"
      /></label>
      <label class="form-group"
        ><span class="form-label">{{ t("地区", "Region") }}</span
        ><UiSelect v-model="filterRegion" :options="filterRegions"
      /></label>
      <label class="form-group"
        ><span class="form-label">{{ t("节点", "Node") }}</span
        ><UiSelect v-model="filterNode" :options="filterNodes"
      /></label>
    </div>
    <div
      v-if="!loading && !loadError && !canCreate"
      class="taxonomy-setup-note"
    >
      <p>
        {{
          t(
            "先添加并启用类型、地区和节点，再创建商品。",
            "Add and enable a type, region and node before creating products.",
          )
        }}
      </p>
      <button class="btn btn-secondary" @click="taxonomyOpen = true">
        {{ t("管理类型、地区与节点", "Manage types, regions and nodes") }}
      </button>
    </div>
    <div class="catalog-toolbar">
      <div
        class="status-tabs"
        :aria-label="t('商品状态筛选', 'Product status')"
      >
        <button
          :class="{ active: filter === 'all' }"
          :aria-pressed="filter === 'all'"
          @click="filter = 'all'"
        >
          {{ t("全部", "All")
          }}<span>{{ catalog?.items.length || 0 }}</span></button
        ><button
          :class="{ active: filter === 'published' }"
          :aria-pressed="filter === 'published'"
          @click="filter = 'published'"
        >
          {{ t("已上架", "Published")
          }}<span>{{ publishedCount }}</span></button
        ><button
          :class="{ active: filter === 'draft' }"
          :aria-pressed="filter === 'draft'"
          @click="filter = 'draft'"
        >
          {{ t("草稿 / 下架", "Draft / offline") }}<span>{{ draftCount }}</span>
        </button>
      </div>
      <div class="catalog-search">
        <Search :size="16" /><input
          v-model="query"
          :aria-label="t('搜索后台商品', 'Search products')"
          :placeholder="t('搜索商品或地区', 'Search product or region')"
        /><button
          class="btn btn-ghost refresh"
          :disabled="loading"
          :aria-busy="loading"
          :aria-label="t('刷新商品目录', 'Refresh catalog')"
          @click="load"
        >
          <UiSpinner v-if="loading" :size="16" /><RefreshCw v-else :size="16" />
        </button>
      </div>
    </div>
    <p v-if="success" class="saved-message" role="status">
      <Check :size="15" />{{ success
      }}<button
        class="btn btn-ghost"
        :aria-label="t('关闭通知', 'Dismiss message')"
        @click="success = ''"
      >
        <X :size="14" />
      </button>
    </p>
    <div v-if="loadError" class="empty-state surface-card" role="alert">
      <Server :size="30" />
      <h2>{{ t("无法读取商品", "Products unavailable") }}</h2>
      <p>{{ loadError }}</p>
      <button class="btn btn-secondary" @click="load">
        {{ t("重新读取", "Try again") }}
      </button>
    </div>
    <UiLoading
      v-else-if="loading"
      layout="list"
      :label="t('正在读取商品…', 'Loading products…')"
    />
    <div v-else-if="!visibleItems.length" class="empty-state surface-card">
      <Layers :size="30" />
      <h2>{{ t("这里还没有商品", "No products here yet") }}</h2>
      <p>
        {{
          t(
            "创建一份草稿，填写规格并为每个币种独立定价。",
            "Start with a draft, define its specifications and price each currency independently.",
          )
        }}
      </p>
      <button
        class="btn btn-admin"
        :disabled="loading || !!loadError || !canCreate"
        @click="
          query = '';
          filter = 'all';
          openEditor('create');
        "
      >
        <Plus :size="15" />{{ t("新增商品", "Create product") }}
      </button>
    </div>
    <div v-else class="product-list">
      <article
        v-for="item in visibleItems"
        :key="item.id"
        class="product-row surface-card"
      >
        <div class="product-identity">
          <div class="product-icon"><Server :size="21" /></div>
          <div>
            <div class="product-name">
              <h2>{{ item.name }}</h2>
              <span
                class="badge"
                :class="item.available ? 'badge-success' : 'badge-neutral'"
                >{{
                  item.available
                    ? t("已上架", "Published")
                    : t("草稿 / 下架", "Draft / offline")
                }}</span
              >
            </div>
            <p>
              {{ typeName(item.type_id) }} · <MapPin :size="12" />{{
                item.region
              }}
              · {{ nodeName(item.node_id)
              }}<span class="item-id">{{ item.id }}</span>
            </p>
          </div>
        </div>
        <div class="product-spec-line">
          <span
            ><b>{{ item.cpu }}</b> vCPU</span
          ><span
            ><b>{{ item.memory_gb }}</b> GB {{ t("内存", "RAM") }}</span
          ><span
            ><b>{{ item.disk_gb }}</b> GB {{ t("存储", "disk") }}</span
          ><span
            ><b>{{ item.transfer_tb }}</b> TB {{ t("流量", "transfer") }}</span
          >
        </div>
        <div class="product-row-bottom">
          <div class="product-quote">
            <template v-if="priceFor(item)"
              ><strong class="money-figure">{{ money(priceFor(item)!) }}</strong
              ><span
                >{{ currency }} / {{ t("月", "mo") }} ·
                {{
                  priceFor(item)!.available
                    ? t("报价可售", "Quote available")
                    : t("报价停用", "Quote disabled")
                }}</span
              ></template
            ><template v-else
              ><strong class="missing-price">{{
                t("尚未定价", "No quote")
              }}</strong
              ><span>{{ currency }}</span></template
            ><small>{{
              t(
                `${item.prices.length} 种独立币种报价`,
                `${item.prices.length} independently priced currencies`,
              )
            }}</small>
          </div>
          <div class="row-actions">
            <button
              class="btn btn-secondary"
              :data-product-configuration-id="item.id"
              :disabled="loading"
              @click="openProductConfiguration(item)"
            >
              <Server :size="14" />{{ t("产品配置", "Product configuration") }}
            </button>
            <button
              class="btn btn-secondary"
              :disabled="loading"
              @click="openEditor('duplicate', item)"
            >
              <Copy :size="14" />{{ t("复制", "Duplicate") }}</button
            ><button
              class="btn btn-secondary edit-action"
              :disabled="loading"
              @click="openEditor('edit', item)"
            >
              <FilePenLine :size="14" />{{ t("编辑商品", "Edit product")
              }}<ArrowUpRight :size="14" />
            </button>
          </div>
        </div>
      </article>
    </div>
    <div class="catalog-boundary">
      <ShieldCheck :size="17" />
      <p>
        {{
          t(
            "商品调整仅影响新订单，不改变已有订单与账单。",
            "Product changes apply to new orders. Existing orders and invoices remain unchanged.",
          )
        }}
      </p>
      <span v-if="catalog" class="font-mono">r{{ catalog.revision }}</span>
    </div>

    <OverlayPanel
      :open="editorOpen"
      :busy="saving"
      :title="editorTitle"
      :description="
        mode === 'demo'
          ? t(
              '演示修改 · 不影响真实商品或客户订单',
              'Demo changes · No real products or orders are affected',
            )
          : t(
              '编辑商品信息、配置与价格。',
              'Edit product details, specifications and prices.',
            )
      "
      kind="drawer"
      @close="closeEditor"
    >
      <div v-if="discardConfirmation" class="discard-confirmation" role="alert">
        <h3>{{ t("放弃未保存的更改？", "Discard unsaved changes?") }}</h3>
        <p>
          {{
            t(
              "此草稿尚未保存到商品目录。",
              "This draft has not been saved to the catalog.",
            )
          }}
        </p>
        <div>
          <button
            class="btn btn-secondary"
            :disabled="saving"
            @click="keepEditing"
          >
            {{ t("继续编辑", "Keep editing") }}</button
          ><button
            class="btn btn-danger"
            :disabled="saving"
            @click="discardDraft"
          >
            {{ t("放弃草稿", "Discard draft") }}
          </button>
        </div>
      </div>
      <div v-if="editorMode === 'duplicate'" class="duplicate-preview">
        <div class="product-icon"><Copy :size="23" /></div>
        <h3>{{ form.name }}</h3>
        <p>
          {{
            t(
              "将复制规格和全部独立报价，生成新的商品 ID，并强制保持为草稿。保存后可继续编辑。",
              "Copy specifications and all independent quotes into a new product ID, always as a draft. Continue editing after duplication.",
            )
          }}
        </p>
        <ProductSpecs :plan="preview" :locale="locale" />
      </div>
      <template v-else
        ><section class="editor-section">
          <div class="section-kicker">
            <span>01</span>
            <h3>{{ t("基本信息", "Product identity") }}</h3>
          </div>
          <label class="form-group"
            ><span class="form-label"
              >{{ t("商品名称", "Product name") }} *</span
            ><input
              v-model="form.name"
              class="form-input"
              type="text"
              :disabled="saving || uncertain || conflict"
              :placeholder="
                t('例如：东京 · 均衡型', 'e.g. Tokyo · Balanced')
              " /></label
          ><label class="form-group"
            ><span class="form-label"
              >{{ t("服务器类型", "Server type") }} *</span
            ><UiSelect
              v-model="form.type_id"
              :options="typeOptions"
              :disabled="saving || uncertain || conflict"
              :placeholder="t('选择类型', 'Choose a type')"
          /></label>
          <label class="form-group"
            ><span class="form-label">{{ t("地区", "Region") }} *</span
            ><UiSelect
              v-model="form.region_id"
              :options="regionOptions"
              :disabled="!form.type_id || saving || uncertain || conflict"
              :placeholder="t('选择地区', 'Choose a region')"
          /></label>
          <label class="form-group"
            ><span class="form-label">{{ t("节点", "Node") }} *</span
            ><UiSelect
              v-model="form.node_id"
              :options="nodeOptions"
              :disabled="!form.region_id || saving || uncertain || conflict"
              :placeholder="t('选择节点', 'Choose a node')"
          /></label>
          <label class="form-group"
            ><span class="form-label">{{ t("商品描述", "Description") }}</span
            ><textarea
              v-model="form.description"
              class="form-textarea"
              rows="3"
              :disabled="saving || uncertain || conflict"
              :placeholder="
                t(
                  '用简短、准确的文字说明适用场景。',
                  'A short, accurate description of this product.',
                )
              "
            ></textarea>
          </label>
        </section>
        <section class="editor-section">
          <div class="section-kicker">
            <span>02</span>
            <h3>{{ t("资源规格", "Resource specifications") }}</h3>
            <small>{{ t("仅月付", "Monthly only") }}</small>
          </div>
          <div class="spec-fields">
            <label class="form-group"
              ><span class="form-label">{{ t("处理器", "CPU") }}</span>
              <div class="unit-input">
                <input
                  v-model="form.cpu"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  :disabled="saving || uncertain || conflict"
                /><span>vCPU</span>
              </div></label
            ><label class="form-group"
              ><span class="form-label">{{ t("内存", "Memory") }}</span>
              <div class="unit-input">
                <input
                  v-model="form.memory_gb"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  :disabled="saving || uncertain || conflict"
                /><span>GB</span>
              </div></label
            ><label class="form-group"
              ><span class="form-label">{{ t("存储", "Storage") }}</span>
              <div class="unit-input">
                <input
                  v-model="form.disk_gb"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  :disabled="saving || uncertain || conflict"
                /><span>GB</span>
              </div></label
            ><label class="form-group"
              ><span class="form-label">{{
                t("每月流量", "Monthly transfer")
              }}</span>
              <div class="unit-input">
                <input
                  v-model="form.transfer_tb"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  :disabled="saving || uncertain || conflict"
                /><span>TB</span>
              </div></label
            >
          </div>
        </section>
        <section class="editor-section">
          <div class="section-kicker">
            <span>03</span>
            <h3>{{ t("独立报价", "Independent quotes") }}</h3>
          </div>
          <p class="section-help">
            {{
              t(
                "每个币种独立定价，不换算汇率。留空表示不提供该币种报价；停用报价会保留金额。",
                "Price each currency independently, without conversion. Leave blank to omit a quote; disabling a quote preserves its amount.",
              )
            }}
          </p>
          <div class="price-editor">
            <div
              v-for="row in priceFields"
              :key="row.currency.code"
              class="price-row"
            >
              <div class="price-currency">
                <strong>{{ row.currency.code }}</strong
                ><span>{{ row.currency.name }}</span
                ><small v-if="!row.currency.enabled">{{
                  t("币种已停用", "Currency disabled")
                }}</small>
              </div>
              <label class="price-amount"
                ><span class="sr-only"
                  >{{ row.currency.code }}
                  {{ t("每月金额", "monthly amount") }}</span
                ><span v-if="row.currency.prefix" class="price-affix">{{
                  row.currency.prefix
                }}</span
                ><input
                  v-model="row.amount"
                  type="text"
                  inputmode="decimal"
                  :disabled="saving || uncertain || conflict"
                  :placeholder="t('暂不报价', 'No quote')"
                /><span v-if="row.currency.suffix" class="price-affix">{{
                  row.currency.suffix
                }}</span
                ><span class="price-period">/{{ t("月", "mo") }}</span></label
              ><label class="quote-availability"
                ><input
                  v-model="row.available"
                  type="checkbox"
                  :disabled="
                    !row.amount.trim() || saving || uncertain || conflict
                  "
                /><span>{{ t("可售", "Available") }}</span></label
              ><small class="precision-note">{{
                t(
                  `${row.currency.decimal_places} 位小数`,
                  `${row.currency.decimal_places} decimal places`,
                )
              }}</small>
            </div>
          </div>
        </section>
        <section class="editor-section">
          <div class="section-kicker">
            <span>04</span>
            <h3>{{ t("上架状态", "Publication") }}</h3>
          </div>
          <label class="publish-control" :class="{ published: form.available }"
            ><span
              ><strong>{{
                form.available
                  ? t("上架展示", "Publish product")
                  : t("保存为草稿 / 下架", "Keep draft / offline")
              }}</strong
              ><small>{{
                t(
                  "上架至少需一种启用币种有有效可售报价。",
                  "Publishing requires an available quote in an enabled currency.",
                )
              }}</small></span
            ><input
              v-model="form.available"
              type="checkbox"
              :disabled="saving || uncertain || conflict" /><span
              class="switch-track"
              aria-hidden="true"
              ><span></span></span
          ></label></section
      ></template>
      <section class="editor-section reason-section">
        <label class="form-group"
          ><span class="form-label">{{ t("操作原因", "Change reason") }} *</span
          ><textarea
            v-model="form.reason"
            class="form-textarea"
            rows="2"
            :disabled="saving || uncertain || conflict"
            :placeholder="
              t(
                '记录为什么新增、复制或修改商品。',
                'Record why this product is being created, copied or changed.',
              )
            "
          ></textarea
          ><small>{{
            t(
              "将与商品变更一起写入业务审计。最多 500 UTF-8 字节。",
              "Recorded in the business audit. Up to 500 UTF-8 bytes.",
            )
          }}</small></label
        >
      </section>
      <p v-if="saveError" class="editor-error" role="alert">{{ saveError }}</p>
      <button
        v-if="conflict || uncertain"
        class="btn btn-secondary discard-button"
        @click="
          editorOpen = false;
          load();
        "
      >
        {{ t("关闭草稿并核对最新目录", "Close draft and reload catalog") }}
      </button>
      <template #footer
        ><span class="draft-version font-mono"
          >r{{ draftRevision }} · c{{ draftCurrencyRevision }}</span
        ><button
          class="btn btn-secondary"
          :disabled="saving"
          @click="closeEditor"
        >
          {{ t("取消", "Cancel") }}</button
        ><button
          class="btn btn-admin"
          :disabled="saving || conflict || uncertain"
          @click="save"
          :aria-busy="saving"
        >
          <UiSpinner v-if="saving" :size="15" /><Check v-else :size="15" />{{
            saving
              ? t("保存中…", "Saving…")
              : editorMode === "duplicate"
                ? t("复制为草稿", "Duplicate draft")
                : t("保存商品", "Save product")
          }}
        </button></template
      >
    </OverlayPanel>
    <ProductConfigurationPanel
      v-if="configuringProduct"
      :open="true"
      :plan-id="configuringProduct.id"
      :plan-name="configuringProduct.name"
      :category="`${typeName(configuringProduct.type_id)} · ${configuringProduct.region} · ${nodeName(configuringProduct.node_id)}`"
      :locale="locale"
      :mode="mode"
      @close="closeProductConfiguration"
      @saved="load"
    />
    <CatalogTaxonomyManager
      :open="taxonomyOpen"
      :locale="locale"
      @close="taxonomyOpen = false"
      @changed="load"
    />
  </section>
</template>

<style scoped>
.catalog-heading-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.classification-filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
  max-width: 900px;
  gap: 16px;
  margin-bottom: 20px;
}
.classification-filters .form-group {
  margin: 0;
  min-width: 0;
}
.taxonomy-setup-note {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 16px 0;
  color: var(--text-secondary);
}
@media (max-width: 480px) {
  .classification-filters {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .catalog-heading-actions {
    width: 100%;
  }
  .catalog-heading-actions .btn {
    flex: 1;
  }
}

.admin-catalog {
  padding: 8px 0 22px;
}
.discard-confirmation {
  background: var(--status-warning-bg);
  border: 1px solid var(--status-warning-border);
  padding: 18px;
  border-radius: 10px;
  margin-bottom: 24px;
}
.discard-confirmation h3 {
  font-size: 15px;
  color: var(--status-warning);
}
.discard-confirmation p {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 8px 0 14px;
}
.discard-confirmation > div {
  display: flex;
  gap: 9px;
  flex-wrap: wrap;
}
.page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 28px;
}
.eyebrow {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--accent-admin);
  font-size: 10px;
  letter-spacing: 0.11em;
  margin-bottom: 12px;
}
.page-heading h1 {
  font-size: clamp(25px, 2.7vw, 34px);
  letter-spacing: -0.05em;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 10px;
}
.page-heading p {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.8;
}
.create-button {
  min-height: 42px;
  font-size: 12px;
}
.catalog-toolbar {
  display: flex;
  gap: 20px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 16px;
  margin-bottom: 20px;
}
.status-tabs {
  display: flex;
  gap: 4px;
}
.status-tabs button {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  min-height: 38px;
  padding: 8px 11px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.status-tabs button.active {
  color: var(--accent-admin);
  background: var(--status-warning-bg);
}
.status-tabs span {
  display: grid;
  place-items: center;
  min-width: 18px;
  padding: 0 4px;
  height: 18px;
  border-radius: 4px;
  font: 10px var(--font-mono);
  background: var(--bg-elevated);
}
.catalog-search {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-secondary);
  max-width: 280px;
  min-width: 180px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  padding-left: 11px;
  border-radius: 7px;
}
.catalog-search input {
  width: 100%;
  min-width: 0;
  font-size: 11px;
  background: transparent;
  border: 0;
  min-height: 40px;
}
.catalog-search input:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 0;
}
.refresh {
  width: 37px;
  min-height: 39px;
  padding: 0;
  flex-shrink: 0;
}
.saved-message {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--status-success);
  font-size: 12px;
  margin-bottom: 16px;
  padding: 10px 13px;
  background: var(--status-success-bg);
  border: 1px solid var(--status-success-border);
  border-radius: 8px;
  line-height: 1.7;
}
.saved-message .btn {
  margin-left: auto;
  padding: 6px;
}
.product-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: 15px;
}
.product-row {
  padding: 21px;
  min-width: 0;
  box-shadow: none;
  border-radius: 10px;
}
.product-identity {
  display: flex;
  gap: 12px;
  align-items: center;
}
.product-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 9px;
  color: var(--accent-admin);
  flex-shrink: 0;
}
.product-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.product-name h2 {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
.product-name .badge {
  font-size: 9px;
}
.product-identity > div:last-child {
  min-width: 0;
}
.product-identity p {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
  color: var(--text-secondary);
  font-size: 10px;
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.item-id {
  color: var(--text-secondary);
  font: 9px var(--font-mono);
  border-left: 1px solid var(--border-subtle);
  padding-left: 6px;
  margin-left: 3px;
}
.product-spec-line {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
  margin: 22px 0;
  padding: 16px 0;
  border-block: 1px solid var(--border-subtle);
}
.product-spec-line span {
  color: var(--text-secondary);
  font-size: 9px;
  line-height: 1.8;
}
.product-spec-line b {
  font: 600 15px var(--font-mono);
  color: var(--text-primary);
  display: block;
  overflow-wrap: anywhere;
}
.product-row-bottom {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
}
.product-quote {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 3px;
}
.product-quote strong {
  font-size: 21px;
  overflow-wrap: anywhere;
}
.product-quote .missing-price {
  font: 500 14px var(--font-sans);
  color: var(--text-secondary);
}
.product-quote span {
  font-size: 9px;
  color: var(--text-secondary);
}
.product-quote small {
  font-size: 9px;
  color: var(--text-secondary);
  margin-top: 6px;
}
.row-actions {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  min-width: 0;
  justify-content: flex-end;
}
.row-actions .btn {
  font-size: 10px;
  padding: 8px 9px;
  min-height: 37px;
}
.edit-action {
  border-color: var(--status-warning-border);
  color: var(--status-warning);
}
.catalog-boundary {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 22px;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.9;
}
.catalog-boundary svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--accent-admin);
}
.catalog-boundary p {
  max-width: 780px;
}
.catalog-boundary > span {
  margin-left: auto;
  font-size: 9px;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
  text-align: center;
  color: var(--text-secondary);
  padding: 50px 20px;
}
.empty-state h2 {
  font-size: 19px;
  color: var(--text-primary);
}
.empty-state p {
  font-size: 12px;
  max-width: 530px;
  overflow-wrap: anywhere;
}
.editor-section {
  margin-bottom: 27px;
}
.section-kicker {
  display: flex;
  gap: 9px;
  align-items: center;
  margin-bottom: 17px;
}
.section-kicker > span {
  color: var(--accent-admin);
  background: var(--status-warning-bg);
  border: 1px solid var(--status-warning-border);
  width: 25px;
  height: 23px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  font: 9px var(--font-mono);
}
.section-kicker h3 {
  font-size: 14px;
  font-weight: 600;
}
.section-kicker small {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-secondary);
}
.editor-section .form-group {
  margin-top: 14px;
}
.editor-section input,
.editor-section textarea {
  min-height: 44px;
  font-size: 12px;
  line-height: 1.6;
}
.editor-section :is(input, textarea):focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
.editor-section .form-label {
  font-size: 11px;
}
.spec-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 15px;
}
.spec-fields .form-group {
  margin-top: 0;
  margin-bottom: 12px;
}
.unit-input {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-canvas);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 0 12px;
}
.unit-input:focus-within {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
.unit-input input {
  min-width: 0;
  width: 100%;
  background: transparent;
  border: 0;
  outline: 0;
  font-family: var(--font-mono);
}
.unit-input span {
  color: var(--text-secondary);
  font-size: 10px;
}
.unit-input input:focus-visible {
  outline: 0;
}
.section-help {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.8;
  margin: -4px 0 16px;
}
.price-editor {
  border: 1px solid var(--border-subtle);
  border-radius: 9px;
  overflow: hidden;
}
.price-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  padding: 15px;
  border-bottom: 1px solid var(--border-subtle);
  align-items: center;
}
.price-row:last-child {
  border: 0;
}
.price-currency {
  display: flex;
  grid-column: 1/-1;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px 8px;
  min-width: 0;
}
.price-currency strong {
  font: 600 13px var(--font-mono);
}
.price-currency span,
.price-currency small {
  color: var(--text-secondary);
  font-size: 10px;
  overflow-wrap: anywhere;
}
.price-currency small {
  color: var(--status-warning);
}
.price-amount {
  display: grid;
  grid-column: 1/-1;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 8px;
  background: var(--bg-canvas);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 8px 10px;
  min-width: 0;
}
.price-amount:focus-within {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
.price-amount input {
  grid-column: 1/-1;
  min-width: 0;
  width: 100%;
  background: transparent;
  border: 0;
  outline: 0;
  font-family: var(--font-mono);
  font-size: 12px;
}
.price-amount input:focus-visible {
  outline: 0;
}
.price-affix,
.price-period {
  font-size: 10px;
  color: var(--text-secondary);
  min-width: 0;
  max-width: none;
  overflow-wrap: anywhere;
}
.price-affix {
  grid-column: 1;
}
.price-period {
  grid-column: 2;
}
.quote-availability {
  grid-column: 1;
  display: flex;
  gap: 5px;
  align-items: center;
  font-size: 10px;
  color: var(--text-secondary);
  cursor: pointer;
}
.quote-availability input {
  width: 15px;
  height: 15px;
  min-height: 15px;
  accent-color: var(--accent-admin);
}
.precision-note {
  grid-column: 2;
  justify-self: end;
  align-self: center;
  color: var(--text-secondary);
  font-size: 9px;
}
.publish-control {
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-canvas);
  padding: 16px;
  border-radius: 9px;
  cursor: pointer;
}
.publish-control > span:first-child {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
}
.publish-control strong {
  font-size: 12px;
  font-weight: 500;
}
.publish-control small {
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.publish-control input {
  position: absolute;
  width: 1px;
  height: 1px;
  min-height: 0;
  opacity: 0;
}
.switch-track {
  display: flex;
  align-items: center;
  background: var(--border-strong);
  width: 34px;
  height: 20px;
  border-radius: 20px;
  padding: 3px;
  flex-shrink: 0;
  transition: background 0.15s;
}
.switch-track span {
  width: 14px;
  height: 14px;
  background: var(--text-primary);
  border-radius: 50%;
  transition: transform 0.15s;
}
.published .switch-track {
  background: var(--action-admin-bg);
}
.published .switch-track span {
  transform: translateX(14px);
  background: var(--action-admin-text);
}
.publish-control:focus-within {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
.reason-section {
  border-top: 1px solid var(--border-subtle);
  padding-top: 7px;
  margin-bottom: 8px;
}
.reason-section small {
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.draft-version {
  margin-right: auto;
  color: var(--text-secondary);
  font-size: 9px;
}
.editor-error {
  padding: 13px;
  color: var(--status-danger);
  background: var(--status-danger-bg);
  border: 1px solid var(--status-danger-border);
  border-radius: 7px;
  margin-top: 16px;
  font-size: 11px;
  line-height: 1.9;
  overflow-wrap: anywhere;
}
.discard-button {
  margin-top: 12px;
  width: 100%;
  white-space: normal;
}
.duplicate-preview {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 17px;
  margin: 15px 0 30px;
}
.duplicate-preview h3 {
  font-size: 23px;
  overflow-wrap: anywhere;
}
.duplicate-preview p {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.9;
  max-width: 420px;
}
.duplicate-preview :deep(.product-specs) {
  align-self: stretch;
  text-align: left;
  margin-top: 15px;
  background: var(--bg-canvas);
  padding: 20px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 1100px) {
  .product-row-bottom {
    flex-wrap: wrap;
  }
  .row-actions {
    margin-left: auto;
  }
}
@media (max-width: 650px) {
  .page-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 18px;
    padding-bottom: 24px;
  }
  .page-heading h1 {
    font-size: 27px;
  }
  .page-heading p {
    font-size: 11px;
  }
  .create-button {
    width: 100%;
    min-height: 44px;
  }
  .catalog-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 13px;
  }
  .status-tabs {
    gap: 2px;
    justify-content: space-between;
  }
  .status-tabs button {
    font-size: 10px;
    padding: 8px;
    min-height: 42px;
    gap: 5px;
  }
  .catalog-search {
    width: 100%;
    max-width: none;
  }
  .catalog-search input {
    min-height: 42px;
  }
  .product-row {
    padding: 18px;
  }
  .product-identity {
    align-items: flex-start;
    gap: 10px;
  }
  .product-name h2 {
    font-size: 16px;
  }
  .product-icon {
    width: 37px;
    height: 37px;
  }
  .product-spec-line {
    gap: 6px;
  }
  .product-spec-line span {
    font-size: 8px;
  }
  .product-spec-line b {
    font-size: 15px;
  }
  .product-row-bottom {
    gap: 18px;
  }
  .product-quote {
    flex-basis: 100%;
  }
  .product-quote strong {
    font-size: 24px;
  }
  .row-actions {
    width: 100%;
  }
  .row-actions .btn {
    min-height: 44px;
    font-size: 11px;
  }
  .row-actions .edit-action {
    flex: 1;
    justify-content: space-between;
  }
  .catalog-boundary {
    font-size: 9px;
  }
  .catalog-boundary > span {
    display: none;
  }
  .price-row {
    padding: 12px;
    gap: 8px;
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .quote-availability {
    grid-column: 1;
    padding-top: 3px;
    min-height: 24px;
  }
  .precision-note {
    grid-column: 2;
  }
  .price-currency {
    grid-row: auto;
    align-self: start;
    padding-top: 0;
  }
  .price-currency span {
    font-size: 9px;
  }
  .spec-fields {
    gap: 0 11px;
  }
  .draft-version {
    display: none;
  }
  .section-kicker h3 {
    font-size: 13px;
  }
}
</style>
