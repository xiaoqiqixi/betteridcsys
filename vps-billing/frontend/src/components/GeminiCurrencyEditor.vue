<script setup lang="ts">
import UiSpinner from "./UiSpinner.vue";

import { ref, computed, watch } from "vue";
import {
  Plus,
  RotateCcw,
  Save,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Trash2,
  ShieldAlert,
  Coins,
} from "@lucide/vue";

export interface CurrencyUsage {
  plan_prices: number;
  orders: number;
  invoices: number;
  services: number;
  pending_orders: number;
  unpaid_invoices: number;
  ongoing_services: number;
}

export interface RegistryCurrencyItem {
  code: string;
  name: string;
  prefix: string;
  suffix: string;
  decimal_places: number;
  enabled: boolean;
  sort_order: number;
  precision_locked: boolean;
  usage?: CurrencyUsage;
}

export interface CurrencyRegistry {
  revision: number;
  default_currency: string;
  currencies: RegistryCurrencyItem[];
}

export interface SaveCurrencyPayloadItem {
  code: string;
  name: string;
  prefix: string;
  suffix: string;
  decimal_places: number;
  enabled: boolean;
  sort_order: number;
}

export interface SaveCurrencyRegistryPayload {
  revision: number;
  default_currency: string;
  currencies: SaveCurrencyPayloadItem[];
}

interface DraftCurrencyRow extends SaveCurrencyPayloadItem {
  _uid: string;
  isNew: boolean;
  originalDecimalPlaces: number;
  precision_locked: boolean;
  usage: CurrencyUsage;
  usageKnown: boolean;
}

const props = defineProps<{
  locale: string;
  registry: CurrencyRegistry;
  busy: boolean;
  uncertain: boolean;
  error: string;
  notice: string;
}>();

const emit = defineEmits<{
  (e: "save", payload: SaveCurrencyRegistryPayload): void;
  (e: "reload"): void;
  (e: "dirty", value: boolean): void;
}>();

const utf8Encoder = new TextEncoder();
function byteLen(val: string): number {
  return utf8Encoder.encode(val || "").length;
}

function safeCount(val: unknown): number {
  return typeof val === "number" && Number.isSafeInteger(val) && val >= 0
    ? val
    : NaN;
}

function normalizeUsage(u?: CurrencyUsage): CurrencyUsage {
  return {
    plan_prices: safeCount(u?.plan_prices),
    orders: safeCount(u?.orders),
    invoices: safeCount(u?.invoices),
    services: safeCount(u?.services),
    pending_orders: safeCount(u?.pending_orders),
    unpaid_invoices: safeCount(u?.unpaid_invoices),
    ongoing_services: safeCount(u?.ongoing_services),
  };
}

// Missing/corrupt read-only metadata is unknown, never a fabricated zero or editable precision.
const usageKeys = [
  "plan_prices",
  "orders",
  "invoices",
  "services",
  "pending_orders",
  "unpaid_invoices",
  "ongoing_services",
] as const;
function knownUsage(usage: unknown): usage is CurrencyUsage {
  return (
    !!usage &&
    typeof usage === "object" &&
    usageKeys.every(
      (key) =>
        Number.isSafeInteger((usage as CurrencyUsage)[key]) &&
        (usage as CurrencyUsage)[key] >= 0,
    )
  );
}
function plainText(value: unknown, maxBytes: number): value is string {
  if (
    typeof value !== "string" ||
    byteLen(value) > maxBytes ||
    /[<>\p{Cc}\p{Cf}]/u.test(value)
  )
    return false;
  // JavaScript strings can contain unpaired surrogates; TextEncoder would silently replace them.
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function validRegistry(registry: CurrencyRegistry): boolean {
  if (
    !registry ||
    !Number.isSafeInteger(registry.revision) ||
    registry.revision < 1 ||
    !Array.isArray(registry.currencies) ||
    registry.currencies.length < 1 ||
    registry.currencies.length > 32
  )
    return false;
  const codes = new Set<string>();
  for (const row of registry.currencies) {
    if (
      !row ||
      !/^[A-Z]{3}$/.test(row.code) ||
      codes.has(row.code) ||
      !plainText(row.name, 80) ||
      !row.name.trim() ||
      !plainText(row.prefix, 24) ||
      !plainText(row.suffix, 24) ||
      !Number.isSafeInteger(row.decimal_places) ||
      row.decimal_places < 0 ||
      row.decimal_places > 6 ||
      typeof row.enabled !== "boolean" ||
      typeof row.precision_locked !== "boolean" ||
      !Number.isSafeInteger(row.sort_order) ||
      row.sort_order < 0 ||
      row.sort_order > 10000 ||
      !knownUsage(row.usage)
    )
      return false;
    codes.add(row.code);
  }
  return registry.currencies.some(
    (row) => row.code === registry.default_currency && row.enabled,
  );
}
function countLabel(value: number): number | string {
  return Number.isSafeInteger(value) && value >= 0 ? value : "—";
}
function payloadContent(payload: SaveCurrencyRegistryPayload): string {
  return JSON.stringify({
    default_currency: payload.default_currency,
    currencies: [...payload.currencies].sort((a, b) =>
      a.code.localeCompare(b.code),
    ),
  });
}
let submitted: SaveCurrencyRegistryPayload | null = null;

const isEn = computed(
  () => props.locale === "en" || props.locale.startsWith("en"),
);

const t = computed(() => {
  if (isEn.value) {
    return {
      title: "Currencies",
      subtitle:
        "Use CNY for your main offering. Add other currencies only when needed, with separate prices. Existing order and invoice amounts stay unchanged.",
      versionLabel: "Configuration version",
      primaryBadge: "Primary currency",
      revisionTag: (rev: number) => `Configuration version ${rev}`,
      addDraft: "Add another currency",
      reloadBtn: "Refresh currencies",
      discardBtn: "Discard Edits",
      saveBtn: "Save Changes",
      savingBtn: "Saving...",
      uncertainTitle: "Save not yet confirmed",
      uncertainDesc:
        "No save confirmation was received. Refresh and check whether your changes took effect before saving again.",
      conflictTitle: () => "Settings changed while you were editing",
      conflictDesc:
        "Your changes are still here. Discard them only when you are ready to load the latest settings.",
      loadLatestBtn: "Discard changes and refresh",
      codeLabel: "Currency code (3 letters)",
      nameLabel: "Currency Name",
      prefixLabel: "Prefix",
      suffixLabel: "Suffix",
      decimalsLabel: "Decimals (0-6)",
      sortLabel: "Sort (0-10000)",
      defaultBadge: "Default Currency",
      setDefaultBtn: "Set as Default",
      enabledLabel: "Enabled",
      disabledLabel: "Disabled",
      newDraftTag: "Unsaved Draft",
      removeDraftBtn: "Cancel Draft",
      precisionLockedNote:
        "Decimal places are fixed because prices or transactions already use this currency",
      obligationsLockNote:
        "Unfinished orders, invoices or services prevent disabling",
      defaultLockNote: "Default currency must remain enabled",
      previewLabel: "Amount display example",
      historyUsageLabel: "Usage history",
      activeObligationsLabel: "Unfinished items",
      statPlans: "Plan Quotes",
      statOrders: "Orders",
      statInvoices: "Invoices",
      statServices: "Services",
      obOrders: "Pending Orders",
      obInvoices: "Unpaid Invoices",
      obServices: "Ongoing Services",
      maxLimitNote: "Maximum 32 currencies reached.",
      errMaxCount: "Total currencies cannot exceed 32.",
      errDefaultMissing:
        "Default currency must be an existing enabled currency.",
      errRegistryUnknown:
        "Currency information or usage history could not be confirmed. Refresh before saving.",
      errPlainText:
        "Use plain text without markup, control or invisible formatting characters.",
      unknownObligations:
        "Usage could not be confirmed; disabling is unavailable",
      errCodeFormat: "Code must be 3 uppercase ASCII letters (A-Z).",
      errCodeDup: "Duplicate currency code.",
      errNameBytes: "Name is required (1–80 UTF-8 bytes).",
      errPrefixBytes: "Prefix must be 0–24 UTF-8 bytes.",
      errSuffixBytes: "Suffix must be 0–24 UTF-8 bytes.",
      errDecimals: "Decimals must be a safe integer between 0 and 6.",
      errPrecisionLocked: "Precision is locked and cannot be altered.",
      errSort: "Sort order must be a safe integer between 0 and 10000.",
      errObligationsDisable: "Cannot disable currency with active obligations.",
      errDefaultDisable: "Default currency must be enabled.",
    };
  }
  return {
    title: "币种设置",
    versionLabel: "配置版本",
    primaryBadge: "主要币种",
    subtitle:
      "以人民币（CNY）为主，其他币种按需添加、单独定价。历史订单和账单金额保持不变。",
    revisionTag: (rev: number) => `配置版本 ${rev}`,
    addDraft: "添加其他币种",
    reloadBtn: "刷新币种",
    discardBtn: "放弃修改",
    saveBtn: "保存修改",
    savingBtn: "保存中…",
    uncertainTitle: "保存结果待确认",
    uncertainDesc:
      "尚未收到保存确认。请先刷新币种，核对更改是否已生效，再决定下一步。",
    conflictTitle: () => "设置已更新，你还有未保存的修改",
    conflictDesc: "你的修改已保留。确认放弃后，可刷新并查看最新设置。",
    loadLatestBtn: "放弃修改并刷新",
    codeLabel: "币种代码（3 位大写字母）",
    nameLabel: "币种名称",
    prefixLabel: "前缀符号",
    suffixLabel: "后缀符号",
    decimalsLabel: "小数位 (0-6)",
    sortLabel: "排序 (0-10000)",
    defaultBadge: "默认币种",
    setDefaultBtn: "设为默认",
    enabledLabel: "已启用",
    disabledLabel: "已停用",
    newDraftTag: "尚未保存",
    removeDraftBtn: "移除此草稿",
    precisionLockedNote: "已有报价或交易记录，不能更改小数位",
    obligationsLockNote: "还有未完成的订单、账单或服务，暂不能停用",
    defaultLockNote: "默认币种必须保持启用",
    previewLabel: "金额显示示例",
    historyUsageLabel: "使用记录",
    activeObligationsLabel: "未完成事项",
    statPlans: "商品报价",
    statOrders: "累计订单",
    statInvoices: "累计账单",
    statServices: "累计服务",
    obOrders: "待付款订单",
    obInvoices: "未付账单",
    obServices: "持续中的服务",
    maxLimitNote: "已达 32 个币种上限。",
    errMaxCount: "币种总数最多不超过 32 个。",
    errDefaultMissing: "默认币种必须存在于列表且处于启用状态。",
    errRegistryUnknown: "暂时无法确认完整币种信息和使用记录，请刷新后再保存。",
    errPlainText: "仅允许纯文本，不含标记、控制或隐藏格式字符。",
    unknownObligations: "使用记录未确认，暂不能停用",
    errCodeFormat: "请填写 3 位大写英文字母，例如 USD。",
    errCodeDup: "币种代码重复。",
    errNameBytes: "名称必填，且长度须为 1–80 UTF-8 字节。",
    errPrefixBytes: "前缀长度须为 0–24 UTF-8 字节。",
    errSuffixBytes: "后缀长度须为 0–24 UTF-8 字节。",
    errDecimals: "小数位须为 0–6 的安全整数。",
    errPrecisionLocked: "该币种精度已锁定，不可更改。",
    errSort: "排序值须为 0–10000 的安全整数。",
    errObligationsDisable: "还有未完成的订单、账单或服务，暂不能停用。",
    errDefaultDisable: "默认币种必须保持启用。",
  };
});

const baseRevision = ref<number>(0);
const draftDefault = ref<string>("");
const draftRows = ref<DraftCurrencyRow[]>([]);
const baselineSnapshot = ref<string>("");
const hasUpstreamConflict = ref<boolean>(false);
let uidCounter = 1;

function toCleanPayload(
  rev: number,
  defCurr: string,
  rows: Array<SaveCurrencyPayloadItem>,
): SaveCurrencyRegistryPayload {
  return {
    revision: rev,
    default_currency: defCurr,
    currencies: rows.map((r) => ({
      code: r.code,
      name: r.name,
      prefix: r.prefix,
      suffix: r.suffix,
      decimal_places: r.decimal_places,
      enabled: r.enabled,
      sort_order: r.sort_order,
    })),
  };
}

function applyRegistryToDraft(reg: CurrencyRegistry) {
  const rev =
    typeof reg?.revision === "number" &&
    Number.isSafeInteger(reg.revision) &&
    reg.revision > 0
      ? reg.revision
      : NaN;
  const def =
    typeof reg?.default_currency === "string" ? reg.default_currency : "";
  const list = Array.isArray(reg?.currencies) ? reg.currencies : [];

  baseRevision.value = rev;
  draftDefault.value = def;
  draftRows.value = list
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const dec =
        typeof item.decimal_places === "number" &&
        Number.isSafeInteger(item.decimal_places) &&
        item.decimal_places >= 0 &&
        item.decimal_places <= 6
          ? item.decimal_places
          : NaN;
      return {
        _uid: `existing-${item.code}-${index}`,
        isNew: false,
        code: typeof item.code === "string" ? item.code : "",
        name: typeof item.name === "string" ? item.name : "",
        prefix: typeof item.prefix === "string" ? item.prefix : "",
        suffix: typeof item.suffix === "string" ? item.suffix : "",
        decimal_places: dec,
        originalDecimalPlaces: dec,
        enabled: item.enabled === true,
        sort_order:
          typeof item.sort_order === "number" &&
          Number.isSafeInteger(item.sort_order)
            ? item.sort_order
            : NaN,
        precision_locked:
          item.precision_locked !== false ||
          !knownUsage(item.usage) ||
          ["plan_prices", "orders", "invoices", "services"].some(
            (key) =>
              Number((item.usage as unknown as Record<string, number>)?.[key]) >
              0,
          ),
        usage: normalizeUsage(item.usage),
        usageKnown: knownUsage(item.usage),
      };
    });

  baselineSnapshot.value = JSON.stringify(
    toCleanPayload(rev, def, draftRows.value),
  );
  hasUpstreamConflict.value = false;
  submitted = null;
}

const currentPayload = computed<SaveCurrencyRegistryPayload>(() =>
  toCleanPayload(baseRevision.value, draftDefault.value, draftRows.value),
);

const isDirty = computed<boolean>(() => {
  return JSON.stringify(currentPayload.value) !== baselineSnapshot.value;
});

watch(
  () => props.registry,
  (newReg) => {
    if (!newReg) return;
    const incoming = toCleanPayload(
      newReg.revision,
      newReg.default_currency,
      Array.isArray(newReg.currencies)
        ? newReg.currencies.filter((row) => row && typeof row === "object")
        : [],
    );
    const acknowledged =
      submitted &&
      validRegistry(newReg) &&
      !props.uncertain &&
      newReg.revision === submitted.revision + 1 &&
      payloadContent(incoming) === payloadContent(submitted) &&
      payloadContent(currentPayload.value) === payloadContent(submitted);
    if (!baselineSnapshot.value || !isDirty.value || acknowledged) {
      applyRegistryToDraft(newReg);
    } else {
      const incomingSnap = JSON.stringify(
        toCleanPayload(
          newReg.revision,
          newReg.default_currency,
          Array.isArray(newReg.currencies)
            ? newReg.currencies.filter((row) => row && typeof row === "object")
            : [],
        ),
      );
      if (incomingSnap !== baselineSnapshot.value) {
        hasUpstreamConflict.value = true;
      }
    }
  },
  { immediate: true, deep: true },
);

watch(isDirty, (value) => emit("dirty", value), { immediate: true });

function hasActiveObligations(row: DraftCurrencyRow): boolean {
  if (!row.usageKnown) return true;
  const u = row.usage;
  return (
    u.pending_orders > 0 || u.unpaid_invoices > 0 || u.ongoing_services > 0
  );
}

function totalObligations(row: DraftCurrencyRow): string {
  if (!row.usageKnown) return "—";
  const u = row.usage;
  return (
    BigInt(u.pending_orders) +
    BigInt(u.unpaid_invoices) +
    BigInt(u.ongoing_services)
  ).toString();
}

function validateRow(
  row: DraftCurrencyRow,
  codeCounts: Map<string, number>,
): string[] {
  const errs: string[] = [];
  if (!/^[A-Z]{3}$/.test(row.code)) {
    errs.push(t.value.errCodeFormat);
  } else if ((codeCounts.get(row.code) ?? 0) > 1) {
    errs.push(t.value.errCodeDup);
  }

  if (
    ![row.name, row.prefix, row.suffix].every((value) =>
      plainText(value, Number.MAX_SAFE_INTEGER),
    )
  )
    errs.push(t.value.errPlainText);
  const nameB = byteLen(row.name);
  if (!row.name.trim() || nameB < 1 || nameB > 80) {
    errs.push(t.value.errNameBytes);
  }

  if (byteLen(row.prefix) > 24) {
    errs.push(t.value.errPrefixBytes);
  }

  if (byteLen(row.suffix) > 24) {
    errs.push(t.value.errSuffixBytes);
  }

  if (
    typeof row.decimal_places !== "number" ||
    !Number.isSafeInteger(row.decimal_places) ||
    row.decimal_places < 0 ||
    row.decimal_places > 6
  ) {
    errs.push(t.value.errDecimals);
  } else if (
    !row.isNew &&
    row.precision_locked &&
    row.decimal_places !== row.originalDecimalPlaces
  ) {
    errs.push(t.value.errPrecisionLocked);
  }

  if (
    typeof row.sort_order !== "number" ||
    !Number.isSafeInteger(row.sort_order) ||
    row.sort_order < 0 ||
    row.sort_order > 10000
  ) {
    errs.push(t.value.errSort);
  }

  if (!row.enabled && hasActiveObligations(row)) {
    errs.push(t.value.errObligationsDisable);
  }

  if (!row.enabled && row.code === draftDefault.value) {
    errs.push(t.value.errDefaultDisable);
  }

  return errs;
}

const rowErrorsMap = computed<Record<string, string[]>>(() => {
  const counts = new Map<string, number>();
  for (const r of draftRows.value) {
    if (r.code) {
      counts.set(r.code, (counts.get(r.code) ?? 0) + 1);
    }
  }
  const map: Record<string, string[]> = {};
  for (const r of draftRows.value) {
    map[r._uid] = validateRow(r, counts);
  }
  return map;
});

const globalErrors = computed<string[]>(() => {
  const errs: string[] = [];
  if (!validRegistry(props.registry)) errs.push(t.value.errRegistryUnknown);
  if (draftRows.value.length > 32) {
    errs.push(t.value.errMaxCount);
  }
  const defRow = draftRows.value.find(
    (r) => r.code === draftDefault.value && /^[A-Z]{3}$/.test(r.code),
  );
  if (!defRow || !defRow.enabled) {
    errs.push(t.value.errDefaultMissing);
  }
  return errs;
});

const hasAnyValidationError = computed<boolean>(() => {
  if (globalErrors.value.length > 0) return true;
  return Object.values(rowErrorsMap.value).some((list) => list.length > 0);
});

const canSave = computed<boolean>(() => {
  return (
    !props.busy &&
    !props.uncertain &&
    !hasUpstreamConflict.value &&
    isDirty.value &&
    !hasAnyValidationError.value
  );
});

function formatSamplePreview(row: DraftCurrencyRow): string {
  const dec =
    typeof row.decimal_places === "number" &&
    Number.isSafeInteger(row.decimal_places) &&
    row.decimal_places >= 0 &&
    row.decimal_places <= 6
      ? row.decimal_places
      : NaN;
  if (!Number.isSafeInteger(dec)) return "—";
  const sampleMajor = 1280n;
  const scale = BigInt("1" + "0".repeat(dec));
  const sampleMinor =
    sampleMajor * scale + (dec > 0 ? BigInt("5".padEnd(dec, "0")) : 0n);
  const digits = sampleMinor.toString();

  let intPart = "0";
  let fracPart = "";
  if (dec === 0) {
    intPart = digits;
  } else if (digits.length <= dec) {
    intPart = "0";
    fracPart = digits.padStart(dec, "0");
  } else {
    intPart = digits.slice(0, digits.length - dec);
    fracPart = digits.slice(digits.length - dec);
  }
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const numStr = dec > 0 ? `${grouped}.${fracPart}` : grouped;
  const pre = row.prefix || "";
  const suf = row.suffix
    ? row.suffix.startsWith(" ")
      ? row.suffix
      : ` ${row.suffix}`
    : "";
  if (pre || suf) {
    return `${pre}${numStr}${suf}`;
  }
  return row.code ? `${numStr} ${row.code}` : numStr;
}

function addDraftCurrency() {
  if (draftRows.value.length >= 32 || props.busy) return;
  const nextSort =
    draftRows.value.reduce(
      (max, r) => (r.sort_order > max ? r.sort_order : max),
      0,
    ) + 10;
  draftRows.value.push({
    _uid: `draft-${uidCounter++}`,
    isNew: true,
    code: "",
    name: "",
    prefix: "",
    suffix: "",
    decimal_places: 2,
    originalDecimalPlaces: 2,
    enabled: true,
    sort_order: Math.min(10000, nextSort),
    precision_locked: false,
    usage: {
      plan_prices: 0,
      orders: 0,
      invoices: 0,
      services: 0,
      pending_orders: 0,
      unpaid_invoices: 0,
      ongoing_services: 0,
    },
    usageKnown: true,
  });
}

function removeDraftRow(uid: string) {
  if (props.busy) return;
  const idx = draftRows.value.findIndex((r) => r._uid === uid && r.isNew);
  if (idx !== -1) {
    draftRows.value.splice(idx, 1);
  }
}

function onCodeInput(row: DraftCurrencyRow, ev: Event) {
  if (!row.isNew) return;
  const target = ev.target as HTMLInputElement;
  const upper = target.value
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);
  row.code = upper;
  target.value = upper;
}

function onIntInput(
  row: DraftCurrencyRow,
  field: "decimal_places" | "sort_order",
  ev: Event,
) {
  const raw = (ev.target as HTMLInputElement).value.trim();
  if (!/^-?\d+$/.test(raw)) {
    row[field] = NaN;
    return;
  }
  const parsed = Number(raw);
  row[field] = Number.isSafeInteger(parsed) ? parsed : NaN;
}

function selectAsDefault(row: DraftCurrencyRow) {
  if (props.busy || !/^[A-Z]{3}$/.test(row.code)) return;
  row.enabled = true;
  draftDefault.value = row.code;
}

function discardChanges() {
  if (props.busy) return;
  applyRegistryToDraft(props.registry);
}

function handleReload() {
  emit("reload");
}

function discardAndReload() {
  applyRegistryToDraft(props.registry);
  emit("reload");
}

function handleSave() {
  if (!canSave.value) return;
  submitted = structuredClone(currentPayload.value);
  emit("save", structuredClone(submitted));
}
</script>

<template>
  <section class="gce-root" :aria-busy="busy ? 'true' : 'false'">
    <header class="gce-header">
      <div class="gce-header-text">
        <div class="gce-title-row">
          <h1 class="gce-title">{{ t.title }}</h1>
          <details>
            <summary class="gce-rev-badge">{{ t.versionLabel }}</summary>
            <span class="gce-rev-badge gce-mono">{{
              Number.isSafeInteger(baseRevision)
                ? t.revisionTag(baseRevision)
                : "—"
            }}</span>
          </details>
        </div>
        <p class="gce-subtitle">{{ t.subtitle }}</p>
      </div>

      <div class="gce-toolbar">
        <button
          type="button"
          class="gce-btn gce-btn-secondary"
          :disabled="busy"
          @click="handleReload"
        >
          <RotateCcw :size="15" aria-hidden="true" />
          <span>{{ t.reloadBtn }}</span>
        </button>

        <button
          type="button"
          class="gce-btn gce-btn-secondary"
          :disabled="busy || draftRows.length >= 32"
          @click="addDraftCurrency"
        >
          <Plus :size="15" aria-hidden="true" />
          <span>{{ t.addDraft }}</span>
        </button>

        <button
          v-if="isDirty"
          type="button"
          class="gce-btn gce-btn-ghost"
          :disabled="busy"
          @click="discardChanges"
        >
          <span>{{ t.discardBtn }}</span>
        </button>

        <button
          type="button"
          class="gce-btn gce-btn-admin"
          :disabled="!canSave"
          :aria-busy="busy"
          @click="handleSave"
        >
          <UiSpinner v-if="busy" :size="15" /><Save
            v-else
            :size="15"
            aria-hidden="true"
          />
          <span>{{ busy ? t.savingBtn : t.saveBtn }}</span>
        </button>
      </div>
    </header>

    <!-- Uncertain State Alert -->
    <div v-if="uncertain" class="gce-banner gce-banner-warn" role="alert">
      <div class="gce-banner-main">
        <ShieldAlert :size="18" class="gce-banner-icon" aria-hidden="true" />
        <div>
          <h2 class="gce-banner-title">{{ t.uncertainTitle }}</h2>
          <p class="gce-banner-desc">{{ t.uncertainDesc }}</p>
        </div>
      </div>
      <button
        type="button"
        class="gce-btn gce-btn-secondary"
        :disabled="busy"
        @click="handleReload"
      >
        <RotateCcw :size="15" aria-hidden="true" />
        <span>{{ t.reloadBtn }}</span>
      </button>
    </div>

    <!-- Upstream Revision Conflict Alert -->
    <div
      v-if="hasUpstreamConflict"
      class="gce-banner gce-banner-warn"
      role="alert"
    >
      <div class="gce-banner-main">
        <AlertTriangle :size="18" class="gce-banner-icon" aria-hidden="true" />
        <div>
          <h2 class="gce-banner-title">
            {{ t.conflictTitle() }}
          </h2>
          <p class="gce-banner-desc">{{ t.conflictDesc }}</p>
        </div>
      </div>
      <button
        type="button"
        class="gce-btn gce-btn-secondary"
        :disabled="busy"
        @click="discardAndReload"
      >
        <RotateCcw :size="15" aria-hidden="true" />
        <span>{{ t.loadLatestBtn }}</span>
      </button>
    </div>

    <!-- Plain Text Error / Notice Banners -->
    <div v-if="error" class="gce-banner gce-banner-error" role="alert">
      <AlertTriangle :size="18" class="gce-banner-icon" aria-hidden="true" />
      <p class="gce-banner-plain">{{ error }}</p>
    </div>

    <div v-if="notice" class="gce-banner gce-banner-notice" role="status">
      <CheckCircle2 :size="18" class="gce-banner-icon" aria-hidden="true" />
      <p class="gce-banner-plain">{{ notice }}</p>
    </div>

    <div
      v-if="globalErrors.length > 0"
      class="gce-banner gce-banner-error"
      role="alert"
    >
      <AlertTriangle :size="18" class="gce-banner-icon" aria-hidden="true" />
      <ul class="gce-err-list">
        <li v-for="(err, idx) in globalErrors" :key="idx">{{ err }}</li>
      </ul>
    </div>

    <!-- Currency Rows -->
    <div class="gce-list">
      <article
        v-for="row in draftRows"
        :key="row._uid"
        class="gce-card"
        :class="{
          'is-default': row.code === draftDefault && row.code !== '',
          'is-draft': row.isNew,
          'has-error': (rowErrorsMap[row._uid]?.length ?? 0) > 0,
        }"
      >
        <!-- Row Top Bar -->
        <div class="gce-card-top">
          <div class="gce-identity">
            <Coins :size="16" class="gce-coin-icon" aria-hidden="true" />
            <span v-if="!row.isNew" class="gce-code-pill gce-mono">{{
              row.code
            }}</span>
            <span v-else class="gce-draft-pill">{{ t.newDraftTag }}</span>

            <span v-if="row.code === 'CNY'" class="gce-default-pill">{{
              t.primaryBadge
            }}</span>
            <span
              v-if="row.code === draftDefault && row.code !== ''"
              class="gce-default-pill"
            >
              {{ t.defaultBadge }}
            </span>
          </div>

          <div class="gce-top-actions">
            <button
              v-if="row.code !== draftDefault"
              type="button"
              class="gce-btn gce-btn-sm gce-btn-secondary"
              :disabled="busy || !/^[A-Z]{3}$/.test(row.code)"
              @click="selectAsDefault(row)"
            >
              <span>{{ t.setDefaultBtn }}</span>
            </button>

            <label
              class="gce-toggle-label"
              :class="{
                'is-locked':
                  busy ||
                  row.code === draftDefault ||
                  (!row.isNew && hasActiveObligations(row)),
              }"
            >
              <input
                v-model="row.enabled"
                type="checkbox"
                class="gce-checkbox"
                :disabled="
                  busy ||
                  row.code === draftDefault ||
                  (!row.isNew && hasActiveObligations(row))
                "
              />
              <span>{{ row.enabled ? t.enabledLabel : t.disabledLabel }}</span>
            </label>

            <button
              v-if="row.isNew"
              type="button"
              class="gce-btn gce-btn-sm gce-btn-danger"
              :disabled="busy"
              @click="removeDraftRow(row._uid)"
            >
              <Trash2 :size="14" aria-hidden="true" />
              <span>{{ t.removeDraftBtn }}</span>
            </button>
          </div>
        </div>

        <!-- Form Fields Grid -->
        <div class="gce-form-grid">
          <div class="gce-field">
            <label class="gce-label" :for="`code-${row._uid}`">{{
              t.codeLabel
            }}</label>
            <input
              :id="`code-${row._uid}`"
              type="text"
              class="gce-input gce-mono"
              :value="row.code"
              :readonly="!row.isNew"
              :disabled="busy || !row.isNew"
              maxlength="3"
              placeholder="USD"
              @input="onCodeInput(row, $event)"
            />
          </div>

          <div class="gce-field gce-field-wide">
            <div class="gce-label-row">
              <label class="gce-label" :for="`name-${row._uid}`">{{
                t.nameLabel
              }}</label>
              <span
                class="gce-byte-hint gce-mono"
                :class="{
                  'is-over': byteLen(row.name) > 80 || byteLen(row.name) < 1,
                }"
              >
                {{ byteLen(row.name) }}/80 B
              </span>
            </div>
            <input
              :id="`name-${row._uid}`"
              v-model="row.name"
              type="text"
              class="gce-input"
              :disabled="busy"
            />
          </div>

          <div class="gce-field">
            <div class="gce-label-row">
              <label class="gce-label" :for="`prefix-${row._uid}`">{{
                t.prefixLabel
              }}</label>
              <span
                class="gce-byte-hint gce-mono"
                :class="{ 'is-over': byteLen(row.prefix) > 24 }"
              >
                {{ byteLen(row.prefix) }}/24 B
              </span>
            </div>
            <input
              :id="`prefix-${row._uid}`"
              v-model="row.prefix"
              type="text"
              class="gce-input gce-mono"
              :disabled="busy"
            />
          </div>

          <div class="gce-field">
            <div class="gce-label-row">
              <label class="gce-label" :for="`suffix-${row._uid}`">{{
                t.suffixLabel
              }}</label>
              <span
                class="gce-byte-hint gce-mono"
                :class="{ 'is-over': byteLen(row.suffix) > 24 }"
              >
                {{ byteLen(row.suffix) }}/24 B
              </span>
            </div>
            <input
              :id="`suffix-${row._uid}`"
              v-model="row.suffix"
              type="text"
              class="gce-input gce-mono"
              :disabled="busy"
            />
          </div>

          <div class="gce-field">
            <div class="gce-label-row">
              <label class="gce-label" :for="`dec-${row._uid}`">{{
                t.decimalsLabel
              }}</label>
              <Lock
                v-if="row.precision_locked"
                :size="12"
                class="gce-lock-icon"
                aria-hidden="true"
              />
            </div>
            <input
              :id="`dec-${row._uid}`"
              type="number"
              min="0"
              max="6"
              step="1"
              class="gce-input gce-mono"
              :value="
                Number.isSafeInteger(row.decimal_places)
                  ? row.decimal_places
                  : ''
              "
              :disabled="busy || (!row.isNew && row.precision_locked)"
              @input="onIntInput(row, 'decimal_places', $event)"
            />
          </div>

          <div class="gce-field">
            <label class="gce-label" :for="`sort-${row._uid}`">{{
              t.sortLabel
            }}</label>
            <input
              :id="`sort-${row._uid}`"
              type="number"
              min="0"
              max="10000"
              step="1"
              class="gce-input gce-mono"
              :value="
                Number.isSafeInteger(row.sort_order) ? row.sort_order : ''
              "
              :disabled="busy"
              @input="onIntInput(row, 'sort_order', $event)"
            />
          </div>
        </div>

        <!-- Preview & Lock Explanations -->
        <div class="gce-meta-bar">
          <div class="gce-preview">
            <span class="gce-meta-label">{{ t.previewLabel }}:</span>
            <span class="gce-preview-val gce-mono">{{
              formatSamplePreview(row)
            }}</span>
          </div>

          <div class="gce-locks">
            <span
              v-if="!row.isNew && row.precision_locked"
              class="gce-lock-tag"
            >
              <Lock :size="12" aria-hidden="true" />
              <span>{{ t.precisionLockedNote }}</span>
            </span>
            <span
              v-if="!row.isNew && hasActiveObligations(row)"
              class="gce-lock-tag is-amber"
            >
              <Lock :size="12" aria-hidden="true" />
              <span
                >{{
                  row.usageKnown ? t.obligationsLockNote : t.unknownObligations
                }}
                ({{ totalObligations(row) }})</span
              >
            </span>
            <span
              v-else-if="row.code === draftDefault && row.code !== ''"
              class="gce-lock-tag"
            >
              <span>{{ t.defaultLockNote }}</span>
            </span>
          </div>
        </div>

        <!-- Read-only Validated Usage & Obligation Counters (Existing Currencies) -->
        <div v-if="!row.isNew" class="gce-usage-grid">
          <div class="gce-usage-group">
            <span class="gce-usage-title">{{ t.activeObligationsLabel }}</span>
            <div class="gce-usage-pills">
              <span
                class="gce-usage-item"
                :class="{ 'is-active-ob': row.usage.pending_orders > 0 }"
              >
                {{ t.obOrders }}:
                <strong class="gce-mono">{{
                  countLabel(row.usage.pending_orders)
                }}</strong>
              </span>
              <span
                class="gce-usage-item"
                :class="{ 'is-active-ob': row.usage.unpaid_invoices > 0 }"
              >
                {{ t.obInvoices }}:
                <strong class="gce-mono">{{
                  countLabel(row.usage.unpaid_invoices)
                }}</strong>
              </span>
              <span
                class="gce-usage-item"
                :class="{ 'is-active-ob': row.usage.ongoing_services > 0 }"
              >
                {{ t.obServices }}:
                <strong class="gce-mono">{{
                  countLabel(row.usage.ongoing_services)
                }}</strong>
              </span>
            </div>
          </div>

          <div class="gce-usage-group">
            <span class="gce-usage-title">{{ t.historyUsageLabel }}</span>
            <div class="gce-usage-pills">
              <span class="gce-usage-item">
                {{ t.statPlans }}:
                <strong class="gce-mono">{{
                  countLabel(row.usage.plan_prices)
                }}</strong>
              </span>
              <span class="gce-usage-item">
                {{ t.statOrders }}:
                <strong class="gce-mono">{{
                  countLabel(row.usage.orders)
                }}</strong>
              </span>
              <span class="gce-usage-item">
                {{ t.statInvoices }}:
                <strong class="gce-mono">{{
                  countLabel(row.usage.invoices)
                }}</strong>
              </span>
              <span class="gce-usage-item">
                {{ t.statServices }}:
                <strong class="gce-mono">{{
                  countLabel(row.usage.services)
                }}</strong>
              </span>
            </div>
          </div>
        </div>

        <!-- Row Validation Errors -->
        <ul
          v-if="(rowErrorsMap[row._uid]?.length ?? 0) > 0"
          class="gce-row-errors"
          role="alert"
        >
          <li v-for="(err, eIdx) in rowErrorsMap[row._uid]" :key="eIdx">
            {{ err }}
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
.gce-root {
  --c-canvas: var(--bg-canvas, #070b14);
  --c-surface: var(--bg-surface, #0d1322);
  --c-elevated: var(--bg-elevated, #131c31);
  --c-text: var(--text-primary, #f1f5f9);
  --c-text-sec: var(--text-secondary, #94a3b8);
  --c-text-muted: var(--text-muted, #64748b);
  --c-accent: var(--accent-primary, #00e5be);
  --c-admin: var(--accent-admin, #f59e0b);
  --c-border: var(--border-subtle, rgba(148, 163, 184, 0.14));
  --c-border-strong: var(--border-strong, rgba(148, 163, 184, 0.28));

  color: var(--c-text);
  font-size: 14px;
  line-height: 1.5;
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-sizing: border-box;
}

.gce-root *,
.gce-root *::before,
.gce-root *::after {
  box-sizing: border-box;
}

.gce-mono {
  font-family: var(
    --font-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace
  );
  font-variant-numeric: tabular-nums;
}

/* Header */
.gce-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.gce-header-text {
  flex: 1 1 320px;
  min-width: 0;
}

.gce-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.gce-title {
  font-size: clamp(20px, 2.2vw, 24px);
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
  color: var(--c-text);
}

.gce-rev-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  background-color: var(--status-warning-bg);
  color: var(--status-warning);
  border: 1px solid var(--status-warning-border);
}

.gce-subtitle {
  font-size: 13px;
  color: var(--c-text-sec);
  margin: 0;
}

.gce-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* Buttons */
.gce-btn {
  min-height: 44px;
  padding: 0 15px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid transparent;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
  white-space: nowrap;
}

.gce-btn-sm {
  min-height: 44px;
  padding: 0 12px;
  font-size: 13px;
}

.gce-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gce-btn-admin {
  background-color: var(--action-admin-bg);
  color: var(--action-admin-text);
}

.gce-btn-admin:hover:not(:disabled) {
  background-color: var(--action-admin-hover);
}

.gce-btn-secondary {
  background-color: var(--c-surface);
  color: var(--c-text);
  border-color: var(--c-border-strong);
}

.gce-btn-secondary:hover:not(:disabled) {
  background-color: var(--c-elevated);
}

.gce-btn-ghost {
  background-color: transparent;
  color: var(--c-text-sec);
  border-color: var(--c-border);
}

.gce-btn-ghost:hover:not(:disabled) {
  color: var(--c-text);
  background-color: var(--bg-hover);
}

.gce-btn-danger {
  background-color: var(--status-danger-bg);
  color: var(--status-danger);
  border-color: var(--status-danger-border);
}

/* Banners */
.gce-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background-color: var(--c-surface);
}

.gce-banner-warn {
  border-color: var(--status-warning-border);
  background-color: var(--status-warning-bg);
}

.gce-banner-error {
  border-color: var(--status-danger-border);
  background-color: var(--status-danger-bg);
  justify-content: flex-start;
}

.gce-banner-notice {
  border-color: var(--status-success-border);
  background-color: var(--status-success-bg);
  justify-content: flex-start;
}

.gce-banner-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1 1 260px;
  min-width: 0;
}

.gce-banner-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--c-admin);
}

.gce-banner-error .gce-banner-icon {
  color: var(--status-danger);
}

.gce-banner-notice .gce-banner-icon {
  color: var(--c-accent);
}

.gce-banner-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 2px;
}

.gce-banner-desc,
.gce-banner-plain {
  font-size: 13px;
  color: var(--c-text-sec);
  margin: 0;
  overflow-wrap: anywhere;
}

.gce-banner-plain {
  color: var(--c-text);
}

/* Cards List */
.gce-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.gce-card {
  background-color: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: 10px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.gce-card.is-default {
  border-color: var(--accent-primary);
}

.gce-card.is-draft {
  border-color: var(--status-warning-border);
}

.gce-card.has-error {
  border-color: var(--status-danger-border);
}

.gce-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--c-border);
}

.gce-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.gce-coin-icon {
  color: var(--c-accent);
}

.gce-code-pill {
  font-size: 14px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 6px;
  background-color: var(--c-elevated);
  border: 1px solid var(--c-border-strong);
}

.gce-draft-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  background-color: var(--status-warning-bg);
  color: var(--status-warning);
}

.gce-default-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  background-color: var(--status-success-bg);
  color: var(--c-accent);
}

.gce-top-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.gce-toggle-label {
  min-height: 44px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--c-border);
  background-color: var(--c-elevated);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.gce-toggle-label.is-locked {
  opacity: 0.6;
  cursor: not-allowed;
}

.gce-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--c-accent);
}

/* Form Grid */
.gce-form-grid {
  display: grid;
  grid-template-columns: 110px minmax(180px, 1.6fr) repeat(
      4,
      minmax(110px, 1fr)
    );
  gap: 12px;
  align-items: start;
}

.gce-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.gce-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.gce-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-sec);
}

.gce-byte-hint {
  font-size: 12px;
  color: var(--c-text-muted);
}

.gce-byte-hint.is-over {
  color: var(--status-danger);
  font-weight: 600;
}

.gce-lock-icon {
  color: var(--c-admin);
}

.gce-input {
  min-height: 44px;
  width: 100%;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-control);
  background-color: var(--c-canvas);
  color: var(--c-text);
  font-size: 14px;
}

.gce-input:disabled,
.gce-input[readonly] {
  opacity: 0.65;
  background-color: var(--c-elevated);
  cursor: not-allowed;
}

.gce-input[readonly]:not(:disabled) {
  opacity: 1;
  color: var(--text-secondary);
  cursor: default;
}

/* Meta & Usage */
.gce-meta-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 4px;
}

.gce-preview {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}

.gce-meta-label {
  color: var(--c-text-sec);
  font-size: 12px;
}

.gce-preview-val {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-accent);
  overflow-wrap: anywhere;
}

.gce-locks {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.gce-lock-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--c-text-sec);
  background-color: var(--status-neutral-bg);
  padding: 3px 8px;
  border-radius: 6px;
}

.gce-lock-tag.is-amber {
  color: var(--status-warning);
  background-color: var(--status-warning-bg);
}

.gce-usage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background-color: var(--bg-subtle);
  border: 1px solid var(--c-border);
}

.gce-usage-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.gce-usage-title {
  font-size: 12px;
  color: var(--c-text-sec);
  font-weight: 500;
}

.gce-usage-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.gce-usage-item {
  font-size: 12px;
  color: var(--c-text-sec);
  background-color: var(--c-surface);
  border: 1px solid var(--c-border);
  padding: 3px 8px;
  border-radius: 6px;
}

.gce-usage-item.is-active-ob {
  border-color: var(--status-warning-border);
  color: var(--status-warning);
}

.gce-err-list,
.gce-row-errors {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--status-danger);
}

.gce-btn:focus-visible,
.gce-input:focus-visible,
.gce-checkbox:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

@media (max-width: 1024px) {
  .gce-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gce-field-wide {
    grid-column: span 2;
  }

  .gce-usage-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .gce-card {
    padding: 14px;
  }

  .gce-form-grid {
    grid-template-columns: 1fr;
  }

  .gce-field-wide {
    grid-column: span 1;
  }

  .gce-toolbar {
    width: 100%;
  }

  .gce-toolbar .gce-btn {
    flex: 1 1 calc(50% - 6px);
  }
}
</style>
