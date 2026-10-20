<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  api,
  ApiError,
  money,
  type Catalog,
  type CatalogItem,
} from "../lib/api";
import {
  canonicalAmount,
  readCurrencyRegistry,
  type CurrencyRegistry,
} from "../lib/currencies";
import { tr } from "../lib/i18n";
import ManagementDialog from "./ManagementDialog.vue";
const props = defineProps<{
  account: string;
  preview?: boolean;
  refreshKey?: number;
}>();
const emit = defineEmits<{ "auth-expired": []; saved: [] }>();
const route = useRoute(),
  router = useRouter();
const catalog = ref<Catalog>(),
  registry = ref<CurrencyRegistry>(),
  loading = ref(false),
  saving = ref(false),
  error = ref(""),
  requestID = ref(""),
  notice = ref(""),
  query = ref("");
let generation = 0,
  editorRevision = 0,
  editorCurrencyRevision = 0,
  taskRevision = 0,
  taskCurrencyRevision = 0;
const draftBaseline = ref("");
const editID = computed(() =>
  typeof route.query.edit === "string" ? route.query.edit : "",
);
const draft = reactive({
  name: "",
  description: "",
  region: "",
  cpu: "2",
  memory_gb: "2",
  disk_gb: "40",
  transfer_tb: "1",
  prices: [] as {
    currency: string;
    included: boolean;
    amount: string;
    available: boolean;
  }[],
});
const task = ref<"save" | "publish" | "unpublish" | "duplicate" | "">("");
const target = ref<CatalogItem>(),
  reason = ref(""),
  agreed = ref(false),
  modalError = ref(""),
  blocked = ref(false),
  publishSave = ref(false);
const bytes = (s: string) => new TextEncoder().encode(s).length;
const rows = computed(
  () =>
    catalog.value?.items.filter((p) =>
      (p.name + " " + p.region + " " + p.id)
        .toLowerCase()
        .includes(query.value.toLowerCase()),
    ) ?? [],
);
const title = computed(
  () =>
    ({
      save: publishSave.value
        ? tr("保存并上架商品", "Save and publish")
        : tr("保存商品草稿", "Save product draft"),
      publish: tr("上架商品", "Publish product"),
      unpublish: tr("下架商品", "Unpublish product"),
      duplicate: tr("复制为新草稿", "Duplicate as draft"),
      "": "",
    })[task.value],
);
function read(value: unknown): Catalog {
  const c = value as Catalog;
  if (
    !c ||
    !Number.isSafeInteger(c.revision) ||
    c.revision < 1 ||
    !Number.isSafeInteger(c.currency_revision) ||
    c.currency_revision < 1 ||
    !Array.isArray(c.items)
  )
    throw Error("INVALID_CATALOG");
  for (const p of c.items) {
    if (
      !p ||
      !["id", "name", "description", "region"].every(
        (k) => typeof p[k as keyof CatalogItem] === "string",
      ) ||
      ![p.cpu, p.memory_gb, p.disk_gb, p.transfer_tb].every(
        (v) => Number.isSafeInteger(v) && v > 0,
      ) ||
      typeof p.available !== "boolean" ||
      !Array.isArray(p.prices) ||
      p.prices.length > 32 ||
      p.prices.some(
        (x) =>
          !x ||
          !/^[A-Z]{3}$/.test(x.currency) ||
          !Number.isSafeInteger(x.amount_minor) ||
          x.amount_minor < 1 ||
          typeof x.available !== "boolean",
      )
    )
      throw Error("INVALID_CATALOG");
  }
  return c;
}
function text(cause: unknown, write = false) {
  if (cause instanceof ApiError) {
    requestID.value = cause.requestId ?? "";
    if (cause.code === "CATALOG_CONFLICT")
      return tr(
        "目录或价格已变化。不会自动重发；请关闭确认，保留需要的内容后重新读取。",
        "Catalog or prices changed. No automatic retry; close this confirmation, keep a copy of your changes and reload.",
      );
    if (["INVALID_CATALOG", "INVALID_BODY"].includes(cause.code))
      return tr(
        "服务器未接受商品。请核对规格、币种报价、可售状态及操作原因。",
        "The product was not accepted. Check specifications, currency prices, availability and reason.",
      );
  }
  return write
    ? tr(
        "操作结果尚未确认。请重新读取核对，勿直接重复提交。",
        "The result is unconfirmed. Reload and check before another submission.",
      )
    : tr(
        "未能读取商品目录或币种配置，请重试。已有目录可能不是最新。",
        "Catalog or currencies could not be loaded. Retry; existing data may be stale.",
      );
}
function decimal(minor: number, places: number) {
  const n = BigInt(minor),
    unit = 10n ** BigInt(places);
  return (
    String(n / unit) +
    (places ? "." + String(n % unit).padStart(places, "0") : "")
  );
}
const dirty = computed(
  () =>
    !!editID.value &&
    !!draftBaseline.value &&
    JSON.stringify(draft) !== draftBaseline.value,
);
const removeRouteGuard = router.beforeEach((to, from) => {
  if (to.fullPath === from.fullPath) return true;
  if (saving.value) {
    modalError.value = tr(
      "正在提交，请等待结果后再离开。",
      "A write is in progress. Wait for its result before leaving.",
    );
    return false;
  }
  if (task.value) {
    closeTask();
    return false;
  }
  if (!dirty.value) return true;
  return window.confirm(
    tr(
      "离开会放弃尚未保存的商品修改，确定离开？",
      "Leave and discard unsaved product changes?",
    ),
  );
});
function fill() {
  if (!editID.value || !registry.value || !catalog.value) return;
  const p = catalog.value.items.find((p) => p.id === editID.value);
  if (editID.value !== "new" && !p) {
    error.value = tr(
      "未找到该商品，请返回目录核对。",
      "Product not found. Return to the catalog.",
    );
    return;
  }
  Object.assign(draft, {
    name: p?.name ?? "",
    description: p?.description ?? "",
    region: p?.region ?? "",
    cpu: String(p?.cpu ?? 2),
    memory_gb: String(p?.memory_gb ?? 2),
    disk_gb: String(p?.disk_gb ?? 40),
    transfer_tb: String(p?.transfer_tb ?? 1),
    prices: registry.value.currencies.map((c) => {
      const price = p?.prices.find((p) => p.currency === c.code);
      return {
        currency: c.code,
        included: !!price,
        amount: price ? decimal(price.amount_minor, c.decimal_places) : "",
        available: price?.available ?? false,
      };
    }),
  });
  draftBaseline.value = JSON.stringify(draft);
  editorRevision = catalog.value.revision;
  editorCurrencyRevision = registry.value.revision;
}
async function load(replaceDraft: unknown = false) {
  if (saving.value) return;
  if ((dirty.value || task.value) && replaceDraft !== true) {
    error.value = tr(
      "当前草稿或确认内容已保留，后台刷新暂停。重新读取前请先核对并保留修改。",
      "Your draft or confirmation is retained; background refresh is paused. Keep a copy of changes before reloading.",
    );
    return;
  }
  const draftAtStart = JSON.stringify(draft),
    taskAtStart = task.value;
  const current = ++generation;
  loading.value = true;
  error.value = "";
  requestID.value = "";
  if (!props.account.endsWith(":admin")) {
    catalog.value = undefined;
    registry.value = undefined;
    loading.value = false;
    return;
  }
  if (props.preview) {
    loading.value = false;
    return;
  }
  try {
    const [c, r] = await Promise.all([
      api<unknown>("/admin/catalog"),
      api<unknown>("/admin/currencies"),
    ]);
    if (current !== generation) return;
    if (JSON.stringify(draft) !== draftAtStart || task.value !== taskAtStart) {
      error.value = tr(
        "读取期间内容已编辑，已保留本地草稿；请核对后重新读取。",
        "You edited during the read. Your local draft was retained; review before reloading.",
      );
      return;
    }
    const nextCatalog = read(c),
      nextRegistry = readCurrencyRegistry(r);
    if (nextCatalog.currency_revision !== nextRegistry.revision)
      throw new Error("CATALOG_CURRENCY_READ_CONFLICT");
    catalog.value = nextCatalog;
    registry.value = nextRegistry;
    blocked.value = false;
    fill();
  } catch (cause) {
    if (current !== generation) return;
    if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) {
      catalog.value = undefined;
      registry.value = undefined;
      emit("auth-expired");
    }
    error.value = text(cause);
  } finally {
    if (current === generation) loading.value = false;
  }
}
function reload() {
  if (saving.value || task.value) return;
  if (
    dirty.value &&
    !window.confirm(
      tr(
        "重新读取将替换尚未保存的草稿，确定继续？",
        "Reload and replace the unsaved draft?",
      ),
    )
  )
    return;
  void load(true);
}
function closeTask() {
  if (saving.value) return;
  task.value = "";
  target.value = undefined;
  reason.value = "";
  agreed.value = false;
  modalError.value = "";
}
function begin(kind: typeof task.value, item?: CatalogItem, publish = false) {
  if (
    props.preview ||
    !catalog.value ||
    !registry.value ||
    loading.value ||
    saving.value ||
    blocked.value
  )
    return;
  task.value = kind;
  target.value = item ? JSON.parse(JSON.stringify(item)) : undefined;
  taskRevision = kind === "save" ? editorRevision : catalog.value.revision;
  // Always bind to the actual registry used to format/parse this draft.
  taskCurrencyRevision =
    kind === "save" ? editorCurrencyRevision : registry.value.revision;
  reason.value = "";
  agreed.value = false;
  modalError.value = "";
  publishSave.value = publish;
}
function payload() {
  const maxima = {
    cpu: 4096,
    memory_gb: 1048576,
    disk_gb: 16777216,
    transfer_tb: 1048576,
  };
  const specs = {} as Record<keyof typeof maxima, number>;
  if (
    !draft.name.trim() ||
    bytes(draft.name.trim()) > 120 ||
    !draft.region.trim() ||
    bytes(draft.region.trim()) > 120 ||
    bytes(draft.description) > 500 ||
    /[\p{Cc}\p{Cf}\p{Cs}<>]/u.test(draft.name + draft.region) ||
    /[\p{Cf}\p{Cs}<>]|[\u0000-\u0009\u000b-\u001f\u007f]/u.test(
      draft.description,
    )
  )
    throw Error("INVALID_CATALOG");
  for (const [key, max] of Object.entries(maxima)) {
    const v = draft[key as keyof typeof maxima];
    if (
      !/^[1-9]\d*$/.test(v) ||
      !Number.isSafeInteger(Number(v)) ||
      Number(v) > max
    )
      throw Error("INVALID_CATALOG");
    specs[key as keyof typeof maxima] = Number(v);
  }
  const prices = draft.prices
    .filter((p) => p.included)
    .map((p) => {
      const c = registry.value!.currencies.find((c) => c.code === p.currency)!;
      const canonical = canonicalAmount(p.amount, c.decimal_places);
      const minor = BigInt(canonical.replace(".", ""));
      return {
        currency: p.currency,
        amount_minor: Number(minor),
        available: p.available,
      };
    });
  return {
    name: draft.name.trim(),
    description: draft.description,
    ...specs,
    region: draft.region.trim(),
    available: publishSave.value,
    prices,
  };
}
async function submit() {
  if (
    saving.value ||
    blocked.value ||
    !task.value ||
    !catalog.value ||
    props.preview
  )
    return;
  modalError.value = "";
  if (
    !reason.value.trim() ||
    bytes(reason.value.trim()) > 500 ||
    !agreed.value
  ) {
    modalError.value = tr(
      "填写1–500字节操作原因并确认影响。",
      "Enter a 1–500 byte reason and confirm the consequences.",
    );
    return;
  }
  let body: Record<string, unknown> = {
      revision: taskRevision,
      currency_revision: taskCurrencyRevision,
      reason: reason.value.trim(),
    },
    path = "/admin/catalog";
  const kind = task.value;
  try {
    if (kind === "save") {
      Object.assign(body, payload());
      if (editID.value !== "new")
        path += "/" + encodeURIComponent(editID.value);
    } else {
      path += "/" + encodeURIComponent(target.value!.id);
      if (kind === "duplicate") path += "/duplicate";
      else {
        const { id, ...fields } = target.value!;
        void id;
        Object.assign(body, fields, { available: kind === "publish" });
      }
    }
  } catch {
    modalError.value = tr(
      "请核对名称/地区字节上限、正整数规格与各币种金额精度。金额不自动舍入或换汇。",
      "Check text limits, positive integer specifications and exact currency precision. Amounts are never rounded or converted.",
    );
    return;
  }
  const current = generation,
    identity = props.account;
  saving.value = true;
  try {
    const result = await api<{
      revision: number;
      currency_revision: number;
      plan: CatalogItem;
    }>(path, "POST", body);
    if (current !== generation || identity !== props.account) return;
    read({
      revision: result.revision,
      currency_revision: result.currency_revision,
      items: [result.plan],
    });
    if (result.revision <= Number(body.revision))
      throw new Error("INVALID_CATALOG_REVISION");
    saving.value = false;
    draftBaseline.value = JSON.stringify(draft);
    closeTask();
    notice.value = tr(
      "商品目录已更新，历史成交快照不受影响。",
      "Catalog updated; historical order snapshots remain unchanged.",
    );
    await router.push("/catalog");
    emit("saved");
    await load();
  } catch (cause) {
    if (current === generation && identity === props.account) {
      modalError.value = text(cause, true);
      error.value = modalError.value;
      blocked.value = true;
      if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) {
        catalog.value = undefined;
        emit("auth-expired");
      }
    }
  } finally {
    if (identity === props.account) saving.value = false;
  }
}
watch(editID, () => {
  closeTask();
  fill();
});
watch(
  () => props.account,
  () => {
    generation++;
    catalog.value = undefined;
    registry.value = undefined;
    saving.value = false;
    closeTask();
    Object.assign(draft, { name: "", description: "", region: "", prices: [] });
    draftBaseline.value = JSON.stringify(draft);
    notice.value = "";
    void load();
  },
  { flush: "sync" },
);
watch(() => props.refreshKey, load);
onMounted(load);
onBeforeUnmount(() => {
  generation++;
  removeRouteGuard();
});
</script>
<template>
  <section
    class="management-page"
    data-testid="catalog-page"
    :aria-busy="loading"
  >
    <div class="management-toolbar">
      <p class="management-help">
        {{
          tr(
            "商品规格与各币种独立报价统一管理。下架仅影响新订单，历史金额与快照不变。",
            "Manage specifications and independent currency prices. Unpublishing affects new orders only, not historical amounts or snapshots.",
          )
        }}
      </p>
      <div class="management-actions">
        <button
          class="button secondary"
          :disabled="preview || loading || saving"
          @click="reload"
        >
          {{ tr("重新读取目录", "Reload catalog") }}</button
        ><button
          v-if="!editID"
          class="button primary"
          :disabled="preview || loading || !catalog"
          @click="router.push('/catalog?edit=new')"
        >
          {{ tr("新增商品", "New product") }}</button
        ><button
          v-else
          class="button secondary"
          :disabled="saving"
          @click="router.push('/catalog')"
        >
          {{ tr("返回商品目录", "Back to catalog") }}
        </button>
      </div>
    </div>
    <p v-if="preview" class="management-help">
      {{
        tr(
          "离线预览不读取或修改商品。",
          "Offline preview does not read or modify products.",
        )
      }}
    </p>
    <div v-if="error" class="management-error" role="alert">
      <p>{{ error }}</p>
      <code v-if="requestID">{{ requestID }}</code
      ><button
        class="button secondary"
        :disabled="loading || saving"
        @click="reload"
      >
        {{ tr("重新读取（将替换草稿）", "Reload (replaces draft)") }}
      </button>
    </div>
    <p v-if="notice" class="management-success" role="status">{{ notice }}</p>
    <p v-if="loading" class="management-help" role="status">
      {{ tr("正在读取目录与币种…", "Loading catalog and currencies…") }}
    </p>
    <template v-if="catalog && registry">
      <template v-if="editID"
        ><form
          class="management-section"
          @submit.prevent="begin('save', undefined, false)"
        >
          <section class="panel management-section">
            <h2>
              {{
                editID === "new"
                  ? tr("新商品 · 默认草稿", "New product · draft by default")
                  : tr("编辑商品", "Edit product")
              }}
            </h2>
            <p class="management-help">
              {{
                tr(
                  "商品仅作为账务套餐，不会自动开通真实资源。名称/地区各120字节，描述500字节。",
                  "Products are billing plans, not automatic resource provisioning. Name and region: 120 bytes each; description: 500 bytes.",
                )
              }}
            </p>
            <div class="management-fields catalog-fields">
              <label class="management-field"
                >{{ tr("商品名称", "Product name")
                }}<input
                  v-model="draft.name"
                  name="catalog_name"
                  required /></label
              ><label class="management-field"
                >{{ tr("地区", "Region")
                }}<input
                  v-model="draft.region"
                  name="catalog_region"
                  required /></label
              ><label class="management-field wide"
                >{{ tr("商品说明", "Description")
                }}<textarea
                  v-model="draft.description"
                  name="catalog_description"
                /></label
              ><label
                v-for="(label, key) in {
                  cpu: 'vCPU',
                  memory_gb: tr('内存GB', 'Memory GB'),
                  disk_gb: tr('硬盘GB', 'Disk GB'),
                  transfer_tb: tr('流量TB', 'Transfer TB'),
                }"
                :key="key"
                class="management-field catalog-spec"
                >{{ label
                }}<input
                  v-model="draft[key]"
                  :name="`catalog_${key}`"
                  inputmode="numeric"
                  required
              /></label>
            </div>
          </section>
          <section class="panel management-section">
            <h2>{{ tr("独立币种报价", "Independent currency prices") }}</h2>
            <p class="management-help">
              {{
                tr(
                  "不配置报价可存草稿。上架须至少有一个已启用币种的开启报价；不自动换汇。原币种报价可停卖，但金额不能置零。",
                  "A draft may have no prices. Publishing requires an available price in an enabled currency. No automatic FX; stored prices must stay positive.",
                )
              }}
            </p>
            <div
              v-for="price in draft.prices"
              :key="price.currency"
              class="management-price"
            >
              <label class="management-field"
                ><input
                  v-model="price.included"
                  type="checkbox"
                  :name="`include_${price.currency}`"
                />{{ price.currency
                }}<small
                  v-if="
                    !registry.currencies.find((c) => c.code === price.currency)
                      ?.enabled
                  "
                  >{{ tr("已停用", "Disabled") }}</small
                ></label
              ><label class="management-field"
                >{{ tr("月付金额", "Monthly amount")
                }}<input
                  v-model="price.amount"
                  :disabled="!price.included"
                  :name="`amount_${price.currency}`"
                  inputmode="decimal"
                  :aria-label="
                    price.currency + ' ' + tr('月付金额', 'monthly amount')
                  "
                /><small>{{
                  tr(
                    "按此币种精度填写；不自动舍入",
                    "Use this currency precision; no rounding",
                  )
                }}</small></label
              ><label class="management-field"
                ><input
                  v-model="price.available"
                  type="checkbox"
                  :disabled="!price.included"
                  :name="`available_${price.currency}`"
                />{{ tr("开启报价", "Offer price") }}</label
              >
            </div>
          </section>
          <div class="management-actions">
            <button
              class="button secondary"
              :disabled="saving || loading || blocked"
            >
              {{ tr("保存为草稿", "Save as draft") }}</button
            ><button
              type="button"
              class="button primary"
              :disabled="saving || loading || blocked"
              @click="begin('save', undefined, true)"
            >
              {{ tr("保存并上架", "Save and publish") }}
            </button>
          </div>
        </form></template
      >
      <template v-else
        ><div class="panel management-fields">
          <label class="management-field wide"
            >{{ tr("筛选完整目录（仅本地）", "Filter complete catalog (local)")
            }}<input
              v-model="query"
              name="catalog_search"
              :placeholder="tr('名称、地区或ID', 'Name, region or ID')"
          /></label>
          <p class="management-help wide">
            {{
              tr(
                `完整目录${catalog.items.length}项 · 当前显示${rows.length}项（本地筛选）。`,
                `Complete catalog: ${catalog.items.length} · ${rows.length} shown (local filter).`,
              )
            }}
          </p>
        </div>
        <div class="management-records">
          <article
            v-for="item in rows"
            :key="item.id"
            class="management-record"
            :data-product-id="item.id"
          >
            <div class="management-record-heading">
              <div>
                <strong>{{ item.name }}</strong
                ><code>{{ item.id }}</code>
              </div>
              <span class="badge" :class="item.available ? 'green' : 'gray'">{{
                item.available
                  ? tr("已上架", "Published")
                  : tr("草稿/已下架", "Draft/unpublished")
              }}</span>
            </div>
            <p class="management-help">{{ item.description }}</p>
            <dl class="management-kv">
              <div>
                <dt>{{ tr("地区", "Region") }}</dt>
                <dd>{{ item.region }}</dd>
              </div>
              <div>
                <dt>{{ tr("规格", "Specifications") }}</dt>
                <dd>
                  {{ item.cpu }} vCPU · {{ item.memory_gb }} GB ·
                  {{ item.disk_gb }} GB · {{ item.transfer_tb }} TB
                </dd>
              </div>
            </dl>
            <div
              v-for="price in item.prices"
              :key="price.currency"
              class="management-record-heading"
            >
              <strong>{{
                money(
                  price.amount_minor,
                  price.currency,
                  registry.currencies.find((c) => c.code === price.currency),
                )
              }}</strong
              ><span class="management-help">{{
                price.available
                  ? tr("报价开启", "Price offered")
                  : tr("报价关闭", "Price unavailable")
              }}</span>
            </div>
            <p v-if="!item.prices.length" class="management-help">
              {{ tr("尚未配置报价", "No currency prices configured") }}
            </p>
            <div class="management-actions">
              <button
                class="button secondary"
                :disabled="loading || blocked"
                @click="
                  router.push('/catalog?edit=' + encodeURIComponent(item.id))
                "
              >
                {{ tr("编辑商品", "Edit product") }}</button
              ><button
                class="button secondary"
                :disabled="loading || blocked"
                @click="begin('duplicate', item)"
              >
                {{ tr("复制为草稿", "Duplicate as draft") }}</button
              ><button
                class="button secondary"
                :disabled="loading || blocked"
                @click="begin(item.available ? 'unpublish' : 'publish', item)"
              >
                {{
                  item.available
                    ? tr("下架", "Unpublish")
                    : tr("上架", "Publish")
                }}
              </button>
            </div>
          </article>
          <p v-if="!rows.length && !loading" class="panel management-help">
            {{ tr("没有符合条件的商品。", "No matching products.") }}
          </p>
        </div></template
      >
    </template>
    <ManagementDialog
      :open="!!task"
      :busy="saving"
      :title="title"
      @close="closeTask"
      @submit="submit"
      ><p class="management-help">
        {{ target?.name || draft.name }}<br /><code v-if="target">{{
          target.id
        }}</code>
      </p>
      <p class="management-help" style="margin-block: 16px">
        {{
          task === "duplicate"
            ? tr(
                "复制规格和独立报价，新商品保持草稿，不会自动上架。",
                "Copies specifications and prices into a new unpublished draft.",
              )
            : task === "unpublish"
              ? tr(
                  "下架将阻止新订单，历史订单/账单不变。",
                  "Unpublishing blocks new orders; historical orders and invoices remain unchanged.",
                )
              : tr(
                  "服务器会校验最新目录版本、币种及报价。不会开通真实资源。",
                  "The server validates the catalog revision, currencies and prices. No real resources are provisioned.",
                )
        }}
      </p>
      <div v-if="modalError" class="management-error" role="alert">
        {{ modalError }}<code v-if="requestID">{{ requestID }}</code>
      </div>
      <label class="management-field"
        >{{ tr("操作原因（1–500字节）", "Reason (1–500 bytes)")
        }}<textarea v-model="reason" name="catalog_reason" required /></label
      ><label class="management-field"
        ><input v-model="agreed" name="catalog_agreed" type="checkbox" />{{
          tr(
            "我已核对内容及可售状态",
            "I reviewed the content and availability",
          )
        }}</label
      ><template #actions
        ><button
          class="button primary"
          :disabled="saving || blocked || !agreed"
        >
          {{
            saving
              ? tr("正在提交…", "Submitting…")
              : tr("确认操作", "Confirm operation")
          }}</button
        ><button
          type="button"
          class="button secondary"
          :disabled="saving"
          @click="closeTask"
        >
          {{ tr("取消", "Cancel") }}
        </button></template
      ></ManagementDialog
    >
  </section>
</template>
