<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { Check, FileCode2, Layers, Server } from "@lucide/vue";
import OverlayPanel from "./OverlayPanel.vue";
import UiSelect from "./UiSelect.vue";
import UiLoading from "./UiLoading.vue";
import UiSpinner from "./UiSpinner.vue";
import { useWorkspace } from "../composables/useWorkspace";
import { ApiError } from "../services/api";
import {
  type ProductConfiguration,
  type ProductResources,
  type ProductSpec,
  canonicalProductSpec,
  validProductSpec,
  validProductConfiguration,
  productConfigurationSHA256,
  RESOURCE_KEYS,
} from "../services/product-configuration";

const props = defineProps<{
  open: boolean;
  planId: string;
  planName: string;
  category: string;
  locale: "zh-CN" | "en";
  mode: "demo" | "api";
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
const { read, write, generation: identityGeneration } = useWorkspace();
const t = (zh: string, en: string) => (props.locale === "en" ? en : zh);
const record = ref<ProductConfiguration | null>(null);
const loading = ref(false),
  busy = ref(false),
  conflict = ref(false),
  uncertain = ref(false),
  discard = ref(false);
type ConfigurationError =
  | { kind: "api"; code?: string; requestId?: string }
  | { kind: "invalid" | "uncertain" };
const errorState = ref<ConfigurationError | null>(null),
  noticeState = ref<"reloaded" | "saved-api" | "saved-demo" | null>(null),
  reason = ref(""),
  original = ref("");
const error = computed(() => {
  if (!errorState.value) return "";
  if (errorState.value.kind === "invalid")
    return t(
      "请先检查标注的配置与操作原因。",
      "Check the marked fields and change reason.",
    );
  if (errorState.value.kind === "uncertain")
    return t(
      "保存结果尚未确认，已停止重复提交。请重新读取并核对，不能把网络错误当作保存失败。",
      "The save outcome is uncertain. Repeat submissions are blocked. Reload and check before another save.",
    );
  return safeError(errorState.value);
});
const notice = computed(() => {
  if (noticeState.value === "reloaded")
    return t(
      "已重新读取服务器中的配置。请核对后再修改；未重复提交。",
      "The stored configuration was reloaded. Review before editing; nothing was resubmitted.",
    );
  if (noticeState.value === "saved-demo")
    return t(
      "演示配置已保存，仅保留在内存预览中；未连接主控、未创建资源。",
      "Demo configuration saved in memory only. No controller was contacted and no resource was created.",
    );
  if (noticeState.value === "saved-api")
    return t(
      "产品配置已保存。仅用于后续新订单，保存不会立即开通。",
      "Product configuration saved. It applies only to future orders; saving does not provision a service.",
    );
  return "";
});
const attempted = ref(false),
  content = ref<HTMLElement | null>(null);
const mode = ref<ProductSpec["mode"]>("disabled"),
  controller = ref(""),
  remote = ref("");
const defaults = (): Record<keyof ProductResources, string> => ({
  datacenter_id: "",
  compute_node_id: "",
  node_group_id: "",
  image_id: "",
  cpu_cores: "2",
  memory_mib: "4096",
  system_disk_gib: "40",
  system_storage_id: "",
  data_disk_gib: "0",
  data_storage_id: "",
  network_type: "normal",
  bandwidth_mbps: "0",
  inbound_bandwidth_mbps: "0",
  transfer_gib: "0",
  traffic_direction: "out",
  ipv4_count: "1",
  ipv6_count: "0",
});
const resources = reactive(defaults());
const locked = computed(
  () =>
    loading.value ||
    busy.value ||
    conflict.value ||
    uncertain.value ||
    !record.value,
);
const modes = computed(() => [
  {
    value: "disabled" as const,
    title: t("暂不关联主控", "No controller mapping"),
    help: t(
      "不下发主控参数，原有商品销售不受影响。",
      "No controller parameters. Existing product sales remain unchanged.",
    ),
    icon: Layers,
  },
  {
    value: "preset" as const,
    title: t("固定远端套餐", "Remote preset"),
    help: t(
      "关联主控中已存在的套餐 ID。",
      "Use an existing product ID on the controller.",
    ),
    icon: Server,
  },
  {
    value: "custom" as const,
    title: t("自定义资源规格", "Custom resources"),
    help: t(
      "由管理员固定配置，客户不能修改资源或价格。",
      "Fixed by the administrator. Customers cannot change resources or prices.",
    ),
    icon: FileCode2,
  },
]);
const stringKeys = new Set([
  "datacenter_id",
  "compute_node_id",
  "node_group_id",
  "image_id",
  "system_storage_id",
  "data_storage_id",
  "network_type",
  "traffic_direction",
]);
const fieldLabels = computed<Record<keyof ProductResources, string>>(() => ({
  datacenter_id: t("数据中心 ID", "Datacenter ID"),
  compute_node_id: t("计算节点 ID", "Compute node ID"),
  node_group_id: t("节点组 ID（可选）", "Node group ID (optional)"),
  image_id: t("系统镜像 ID", "Image ID"),
  cpu_cores: t("CPU 核数", "CPU cores"),
  memory_mib: t("内存 · MiB", "Memory · MiB"),
  system_disk_gib: t("系统盘 · GiB", "System disk · GiB"),
  system_storage_id: t("系统盘存储 ID（可选）", "System storage ID (optional)"),
  data_disk_gib: t("数据盘 · GiB", "Data disk · GiB"),
  data_storage_id: t("数据盘存储 ID（可选）", "Data storage ID (optional)"),
  network_type: t("网络类型", "Network type"),
  bandwidth_mbps: t("出站带宽 · Mbps", "Outbound bandwidth · Mbps"),
  inbound_bandwidth_mbps: t("入站带宽 · Mbps", "Inbound bandwidth · Mbps"),
  transfer_gib: t("流量限额 · GiB", "Transfer allowance · GiB"),
  traffic_direction: t("流量统计方向", "Traffic direction"),
  ipv4_count: t("IPv4 数量", "IPv4 addresses"),
  ipv6_count: t("IPv6 数量", "IPv6 addresses"),
}));
const groups = computed(() => [
  {
    title: t("资源位置与镜像", "Placement and image"),
    help: t(
      "数据中心与计算节点至少填一项。这些是主控资源 ID，不是商品分类节点。",
      "Provide a datacenter or compute node. These are controller resource IDs, not catalog categories.",
    ),
    keys: [
      "datacenter_id",
      "compute_node_id",
      "node_group_id",
      "image_id",
    ] as const,
  },
  {
    title: t("计算与存储", "Compute and storage"),
    help: t(
      "内存须为 128 MiB 的整数倍。数据盘为 0 表示不添加数据盘。",
      "Memory must be a multiple of 128 MiB. A zero data disk means no data disk.",
    ),
    keys: [
      "cpu_cores",
      "memory_mib",
      "system_disk_gib",
      "system_storage_id",
      "data_disk_gib",
      "data_storage_id",
    ] as const,
  },
  {
    title: t("网络与地址", "Network and addresses"),
    help: t(
      "带宽或流量为 0 表示使用主控默认值，不代表不限量。IPv4 与 IPv6 至少分配一个地址。",
      "Zero bandwidth or transfer uses the controller default, not unlimited capacity. At least one IP address is required.",
    ),
    keys: [
      "network_type",
      "bandwidth_mbps",
      "inbound_bandwidth_mbps",
      "transfer_gib",
      "traffic_direction",
      "ipv4_count",
      "ipv6_count",
    ] as const,
  },
]);
const networkOptions = computed(() => [
  { value: "normal", label: t("普通网络", "Normal network") },
  { value: "vpc", label: t("VPC 网络", "VPC network") },
]);
const trafficOptions = computed(() => [
  { value: "in", label: t("仅入站", "Inbound only") },
  { value: "out", label: t("仅出站", "Outbound only") },
  { value: "all", label: t("入站与出站", "Inbound and outbound") },
]);
const spec = computed<ProductSpec>(() => ({
  mode: mode.value,
  controller_id: mode.value === "disabled" ? "" : controller.value.trim(),
  remote_product_id: mode.value === "preset" ? remote.value.trim() : "",
  resources:
    mode.value === "custom"
      ? (Object.fromEntries(
          RESOURCE_KEYS.map((key) => [
            key,
            stringKeys.has(key)
              ? resources[key].trim()
              : /^(?:0|[1-9]\d*)$/.test(resources[key])
                ? Number(resources[key])
                : NaN,
          ]),
        ) as unknown as ProductResources)
      : null,
}));
const preview = computed(() =>
  validProductSpec(spec.value)
    ? JSON.stringify(JSON.parse(canonicalProductSpec(spec.value)), null, 2)
    : "",
);
const state = () =>
  JSON.stringify({
    mode: mode.value,
    controller: controller.value,
    remote: remote.value,
    resources,
    reason: reason.value,
  });
const dirty = computed(() => !!record.value && state() !== original.value);
const bytes = (value: string) => new TextEncoder().encode(value).length;
const identifier = (value: string, required = false) =>
  (!required && !value.trim()) ||
  /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.trim());
const invalid = computed(() => {
  const result: Record<string, string> = {};
  if (
    !reason.value.trim() ||
    bytes(reason.value.trim()) > 500 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason.value)
  )
    result.reason = t(
      "请填写 1–500 UTF-8 字节的操作原因。",
      "Enter a reason of 1–500 UTF-8 bytes.",
    );
  if (mode.value === "disabled") return result;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(controller.value.trim()))
    result.controller = t(
      "目标主控标识为 1–64 位小写字母、数字、下划线或连字符，不能填写地址或密钥。",
      "Use a 1–64 character lowercase controller identifier, not a URL or credential.",
    );
  if (mode.value === "preset") {
    if (!identifier(remote.value, true))
      result.remote = t(
        "请填写合法的主控产品标识，最多 128 位 ASCII 字符。",
        "Enter a valid remote product ID, up to 128 ASCII characters.",
      );
    return result;
  }
  for (const key of [
    "datacenter_id",
    "compute_node_id",
    "node_group_id",
    "system_storage_id",
    "data_storage_id",
    "image_id",
  ] as const)
    if (!identifier(resources[key], key === "image_id"))
      result[key] = t(
        "ID 仅允许字母、数字、点、下划线、冒号和连字符，首位须为字母或数字。",
        "Use a resource ID beginning with a letter or number, with only letters, numbers, dots, underscores, colons and hyphens.",
      );
  if (!resources.datacenter_id.trim() && !resources.compute_node_id.trim())
    result.datacenter_id = t(
      "数据中心 ID 与计算节点 ID 至少填一项。",
      "Provide a datacenter or compute node ID.",
    );
  const limits = {
    cpu_cores: [1, 4096],
    memory_mib: [128, 1073741824],
    system_disk_gib: [1, 16777216],
    data_disk_gib: [0, 16777216],
    bandwidth_mbps: [0, 10000000],
    inbound_bandwidth_mbps: [0, 10000000],
    transfer_gib: [0, 1073741824],
    ipv4_count: [0, 64],
    ipv6_count: [0, 256],
  };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const raw = resources[key as keyof ProductResources],
      n = Number(raw);
    if (
      !/^(?:0|[1-9]\d*)$/.test(raw) ||
      !Number.isSafeInteger(n) ||
      n < min! ||
      n > max!
    )
      result[key] = t(
        `请填写 ${min}–${max} 范围内的整数，不接受小数、指数或前导零。`,
        `Enter an integer from ${min} to ${max}, without decimals, exponents or leading zeroes.`,
      );
  }
  if (!result.memory_mib && Number(resources.memory_mib) % 128)
    result.memory_mib = t(
      "内存须为 128 MiB 的整数倍。",
      "Memory must be a multiple of 128 MiB.",
    );
  if (Number(resources.data_disk_gib) === 0 && resources.data_storage_id.trim())
    result.data_storage_id = t(
      "没有数据盘时，请留空数据盘存储 ID。",
      "Leave data storage empty when no data disk is configured.",
    );
  if (Number(resources.ipv4_count) + Number(resources.ipv6_count) < 1)
    result.ipv4_count = t(
      "IPv4 与 IPv6 数量之和至少为 1。",
      "At least one IPv4 or IPv6 address is required.",
    );
  return result;
});
let epoch = 0;
const current = (token: number, identity: number, planId: string) =>
  token === epoch &&
  identity === identityGeneration.value &&
  props.open &&
  props.planId === planId;
function apply(value: ProductConfiguration) {
  record.value = value;
  mode.value = value.spec.mode;
  controller.value = value.spec.controller_id;
  remote.value = value.spec.remote_product_id;
  Object.assign(resources, defaults());
  if (value.spec.resources)
    for (const key of RESOURCE_KEYS)
      resources[key] = String(value.spec.resources[key]);
  reason.value = "";
  attempted.value = false;
  discard.value = false;
  original.value = state();
}
function safeError(cause: unknown) {
  const e = cause as { code?: string; requestId?: string };
  const message =
    e.code === "FORBIDDEN"
      ? t(
          "当前账户没有产品配置权限。",
          "This account cannot configure products.",
        )
      : e.code === "NOT_FOUND"
        ? t(
            "商品已不存在，请关闭后重新选择。",
            "This product no longer exists. Close and choose another product.",
          )
        : e.code === "INVALID_PRODUCT_CONFIGURATION"
          ? t(
              "产品配置未通过校验，请检查标识和资源参数。",
              "Check the identifiers and resource parameters.",
            )
          : e.code === "PRODUCT_CONFIGURATION_CONFLICT"
            ? t(
                "产品配置已变化，请重新读取并核对，未自动重试。",
                "The configuration changed. Reload and review; no automatic retry.",
              )
            : t(
                "无法确认产品配置，请手动重新读取。",
                "The configuration could not be verified. Reload manually.",
              );
  return (
    message +
    (e.requestId && /^[a-f0-9]{32}$/.test(e.requestId)
      ? ` · ${t("请求编号", "Request ID")} ${e.requestId}`
      : "")
  );
}
function apiError(cause: unknown): ConfigurationError {
  const e = cause as { code?: string; requestId?: string };
  return { kind: "api", code: e.code, requestId: e.requestId };
}
async function load(reconcile = false) {
  if (busy.value || !props.open) return;
  const token = ++epoch,
    identity = identityGeneration.value,
    planId = props.planId;
  loading.value = true;
  busy.value = false;
  record.value = null;
  errorState.value = null;
  noticeState.value = null;
  conflict.value = uncertain.value = false;
  discard.value = false;
  try {
    const value = await read<unknown>(
      `/admin/catalog/${encodeURIComponent(planId)}/product-configuration`,
    );
    if (!current(token, identity, planId)) return;
    if (
      !validProductConfiguration(value) ||
      value.plan_id !== planId ||
      (await productConfigurationSHA256(value.spec)) !==
        value.configuration_sha256
    )
      throw new ApiError("INVALID_RESPONSE");
    if (!current(token, identity, planId)) return;
    apply(value);
    if (reconcile) noticeState.value = "reloaded";
  } catch (cause) {
    if (token === epoch) errorState.value = apiError(cause);
  } finally {
    if (token === epoch) loading.value = false;
  }
}
function close() {
  if (busy.value) return;
  if (dirty.value && !uncertain.value) discard.value = true;
  else emit("close");
}
function keep() {
  if (!busy.value) discard.value = false;
}
function discardDraft() {
  if (!busy.value) emit("close");
}
function chooseMode(value: ProductSpec["mode"]) {
  if (locked.value || mode.value === value) return;
  mode.value = value;
  remote.value = "";
  Object.assign(resources, defaults());
  if (value === "disabled") controller.value = "";
  attempted.value = false;
  noticeState.value = null;
}
async function save() {
  if (!props.open || locked.value || !record.value || !dirty.value) return;
  attempted.value = true;
  errorState.value = null;
  noticeState.value = null;
  if (Object.keys(invalid.value).length || !validProductSpec(spec.value)) {
    errorState.value = { kind: "invalid" };
    await nextTick();
    content.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  const token = epoch,
    identity = identityGeneration.value,
    planId = props.planId,
    capturedReason = reason.value.trim(),
    captured = record.value,
    expected = JSON.parse(canonicalProductSpec(spec.value)) as ProductSpec;
  discard.value = false;
  busy.value = true;
  try {
    const hash = await productConfigurationSHA256(expected);
    if (!current(token, identity, planId)) return;
    const value = await write<unknown>(
      `/admin/catalog/${encodeURIComponent(captured.plan_id)}/product-configuration`,
      {
        revision: captured.revision,
        spec: expected,
        reason: capturedReason,
      },
    );
    if (!current(token, identity, planId)) return;
    if (
      !validProductConfiguration(value) ||
      value.plan_id !== captured.plan_id ||
      value.revision !== captured.revision + 1 ||
      value.price_revision <= captured.price_revision ||
      canonicalProductSpec(value.spec) !== canonicalProductSpec(expected) ||
      value.configuration_sha256 !== hash
    )
      throw new ApiError("INVALID_RESPONSE", 200, { uncertain: true });
    apply(value);
    noticeState.value = props.mode === "demo" ? "saved-demo" : "saved-api";
    emit("saved");
  } catch (cause) {
    if (!current(token, identity, planId)) return;
    const e = cause as { code?: string; status?: number; uncertain?: boolean };
    conflict.value = e.code === "PRODUCT_CONFIGURATION_CONFLICT";
    uncertain.value = !!e.uncertain || !e.status || e.status >= 500;
    errorState.value = uncertain.value
      ? { kind: "uncertain" }
      : apiError(cause);
  } finally {
    if (token === epoch) busy.value = false;
  }
}
watch(
  () => [props.open, props.planId, props.mode, identityGeneration.value],
  () => {
    epoch++;
    record.value = null;
    busy.value = false;
    errorState.value = noticeState.value = null;
    reason.value = "";
    controller.value = remote.value = "";
    mode.value = "disabled";
    Object.assign(resources, defaults());
    if (props.open && props.planId) void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  epoch++;
});
</script>

<template>
  <OverlayPanel
    :open="open"
    :busy="busy"
    :title="t('产品配置', 'Product configuration')"
    :description="
      t(
        '独立于前台展示规格与报价，仅保存供付款后手动下发使用的参数。',
        'Separate from public specifications and prices. Parameters are for manual dispatch after payment.',
      )
    "
    kind="drawer"
    @close="close"
  >
    <div ref="content" class="product-configuration">
      <div class="configuration-product">
        <strong>{{ planName }}</strong>
        <p>{{ category }}</p>
        <code>{{ planId }}</code>
      </div>
      <UiLoading
        v-if="loading"
        :label="t('正在读取产品配置…', 'Loading product configuration…')"
      />
      <template v-else-if="record">
        <div v-if="discard" class="configuration-discard" role="alert">
          <h3>
            {{ t("放弃未保存的产品配置？", "Discard unsaved configuration?") }}
          </h3>
          <p>
            {{
              t(
                "当前草稿尚未保存，不会因此停止已经提交的远端请求。",
                "This draft has not been saved. Discarding it does not cancel a submitted remote request.",
              )
            }}
          </p>
          <div>
            <button class="btn btn-secondary" :disabled="busy" @click="keep">
              {{ t("继续编辑", "Keep editing") }}</button
            ><button
              class="btn btn-danger"
              :disabled="busy"
              @click="discardDraft"
            >
              {{ t("放弃草稿", "Discard draft") }}
            </button>
          </div>
        </div>
        <section class="configuration-section">
          <h3>{{ t("配置方式", "Configuration mode") }}</h3>
          <div class="configuration-modes">
            <button
              v-for="item in modes"
              :key="item.value"
              type="button"
              :aria-pressed="mode === item.value"
              :disabled="locked"
              :class="{ selected: mode === item.value }"
              @click="chooseMode(item.value)"
            >
              <component :is="item.icon" :size="18" /><span
                ><strong>{{ item.title }}</strong
                ><small>{{ item.help }}</small></span
              ><Check
                v-if="mode === item.value"
                class="mode-check"
                :size="18"
              />
            </button>
          </div>
        </section>
        <p class="configuration-boundary">
          {{
            t(
              "当前只保存非秘密参数，不验证连接、不自动下发。主控地址和凭据由服务器单独管理，不能填在商品字段中。",
              "Only non-secret parameters are stored. Saving neither verifies connectivity nor dispatches a task. Controller addresses and credentials belong in separate server configuration.",
            )
          }}
        </p>
        <section v-if="mode !== 'disabled'" class="configuration-section">
          <h3>{{ t("主控关联", "Controller mapping") }}</h3>
          <label class="form-group"
            ><span class="form-label"
              >{{ t("目标主控标识", "Target controller identifier") }} *</span
            ><input
              v-model="controller"
              class="form-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :disabled="locked"
              :aria-invalid="attempted && !!invalid.controller"
              aria-describedby="configuration-controller-help"
              :placeholder="
                t(
                  '填写服务器侧约定的标识，不是地址或密钥',
                  'Server-defined identifier, not a URL or credential',
                )
              "
            /><small id="configuration-controller-help">{{
              (attempted && invalid.controller) ||
              t(
                "可预留标识，但不代表该主控已接入或可用。",
                "An identifier may be reserved; this does not mean a controller is connected or available.",
              )
            }}</small></label
          ><label v-if="mode === 'preset'" class="form-group"
            ><span class="form-label"
              >{{ t("主控产品标识", "Controller product identifier") }} *</span
            ><input
              v-model="remote"
              class="form-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :disabled="locked"
              :aria-invalid="attempted && !!invalid.remote"
              aria-describedby="configuration-remote-help"
            /><small id="configuration-remote-help">{{
              (attempted && invalid.remote) ||
              t(
                "使用主控中的实际产品标识，不从商品名称或分类节点猜测。",
                "Use the actual controller product identifier, never a catalog label or category node.",
              )
            }}</small></label
          >
        </section>
        <template v-if="mode === 'custom'"
          ><section
            v-for="group in groups"
            :key="group.title"
            class="configuration-section"
          >
            <h3>{{ group.title }}</h3>
            <p class="section-help">{{ group.help }}</p>
            <div class="configuration-fields">
              <label v-for="key in group.keys" :key="key" class="form-group"
                ><span class="form-label">{{ fieldLabels[key] }}</span
                ><UiSelect
                  v-if="key === 'network_type' || key === 'traffic_direction'"
                  v-model="resources[key]"
                  :options="
                    key === 'network_type' ? networkOptions : trafficOptions
                  "
                  :disabled="locked"
                /><input
                  v-else
                  v-model="resources[key]"
                  class="form-input"
                  type="text"
                  :inputmode="stringKeys.has(key) ? 'text' : 'numeric'"
                  autocomplete="off"
                  spellcheck="false"
                  :disabled="locked"
                  :aria-invalid="attempted && !!invalid[key]"
                  :aria-describedby="
                    attempted && invalid[key]
                      ? `configuration-${key}-help`
                      : undefined
                  "
                /><small
                  v-if="attempted && invalid[key]"
                  :id="`configuration-${key}-help`"
                  >{{ invalid[key] }}</small
                ></label
              >
            </div>
          </section></template
        >
        <section class="configuration-section">
          <h3>{{ t("参数预览", "Parameter preview") }}</h3>
          <p class="section-help">
            {{
              t(
                "仅预览本商品的非秘密配置，不是已发送的开通请求；不包含客户信息、订单和金额。",
                "A non-secret configuration preview, not a dispatched request. Customer, order and financial data are excluded.",
              )
            }}
          </p>
          <pre v-if="preview" class="configuration-preview">{{ preview }}</pre>
          <p v-else class="configuration-incomplete">
            {{
              t(
                "补全合法的目标主控标识和资源参数后显示预览。",
                "Complete valid identifiers and resources to preview the configuration.",
              )
            }}
          </p>
        </section>
        <section class="configuration-section">
          <label class="form-group"
            ><span class="form-label"
              >{{ t("操作原因", "Change reason") }} *</span
            ><textarea
              v-model="reason"
              class="form-textarea"
              rows="2"
              :disabled="locked"
              :aria-invalid="attempted && !!invalid.reason"
              aria-describedby="configuration-reason-help"
            /><small id="configuration-reason-help">{{
              (attempted && invalid.reason) ||
              t(
                "1–500 UTF-8 字节，与配置变更一起记录；不要填写密码或密钥。",
                "1–500 UTF-8 bytes, recorded with the change. Do not enter passwords or secrets.",
              )
            }}</small></label
          >
        </section>
      </template>
      <p v-if="notice" class="configuration-notice" role="status">
        {{ notice }}
      </p>
      <p v-if="error" class="configuration-error" role="alert">{{ error }}</p>
      <button
        v-if="!loading && (!record || conflict || uncertain)"
        class="btn btn-secondary configuration-reload"
        :disabled="busy"
        @click="load(true)"
      >
        {{ t("重新读取并核对配置", "Reload and check configuration") }}
      </button>
    </div>
    <template #footer
      ><span class="configuration-version"
        >{{ record ? `r${record.revision}` : "—"
        }}<small>{{
          t(
            "仅保存配置 · 未验证对接",
            "Configuration only · Integration unverified",
          )
        }}</small></span
      ><button class="btn btn-secondary" :disabled="busy" @click="close">
        {{ t("关闭", "Close") }}</button
      ><button
        class="btn btn-admin"
        :disabled="locked || !dirty"
        :aria-busy="busy"
        @click="save"
      >
        <UiSpinner v-if="busy" :size="15" /><Check v-else :size="15" />{{
          busy ? t("保存中…", "Saving…") : t("保存配置", "Save configuration")
        }}
      </button></template
    >
  </OverlayPanel>
</template>

<style scoped>
.product-configuration {
  min-width: 0;
}
.configuration-product {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-subtle);
  overflow-wrap: anywhere;
}
.configuration-product strong {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}
.configuration-product p,
.configuration-product code {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.configuration-section {
  margin-bottom: 28px;
  min-width: 0;
}
.configuration-section h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
}
.configuration-section .section-help,
.configuration-boundary {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.75;
  margin-bottom: 16px;
  overflow-wrap: anywhere;
}
.configuration-boundary {
  background: var(--bg-subtle);
  padding: 14px 16px;
  border-radius: var(--radius-md);
  margin-bottom: 28px;
}
.configuration-modes {
  display: grid;
  gap: 10px;
}
.configuration-modes button {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  min-height: 76px;
  padding: 16px;
  text-align: start;
  background: var(--bg-canvas);
  border: 1px solid var(--border-control);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
}
.configuration-modes button.selected {
  background: var(--bg-active);
  border-color: var(--accent-primary);
  color: var(--text-primary);
}
.configuration-modes button:hover:not(:disabled) {
  background: var(--bg-hover);
}
.configuration-modes button > svg {
  flex: 0 0 18px;
  margin-top: 2px;
}
.configuration-modes button > span {
  flex: 1;
  min-width: 0;
}
.configuration-modes strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
}
.configuration-modes small {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.mode-check {
  color: var(--accent-primary);
}
.configuration-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.configuration-section .form-group {
  min-width: 0;
  margin-bottom: 16px;
}
.configuration-fields .form-group {
  margin-bottom: 0;
}
.configuration-section .form-label {
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.configuration-section small {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}
.configuration-section [aria-invalid="true"] {
  border-color: var(--status-danger);
}
.configuration-preview {
  padding: 16px;
  max-height: 340px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.75;
  background: var(--bg-canvas);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
}
.configuration-incomplete {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
}
.configuration-error,
.configuration-notice,
.configuration-discard {
  padding: 16px;
  margin-bottom: 20px;
  border: 1px solid var(--status-danger-border);
  background: var(--status-danger-bg);
  color: var(--status-danger);
  border-radius: var(--radius-md);
  font-size: 13px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}
.configuration-notice {
  color: var(--status-success);
  border-color: var(--status-success-border);
  background: var(--status-success-bg);
}
.configuration-discard {
  color: var(--status-warning);
  border-color: var(--status-warning-border);
  background: var(--status-warning-bg);
}
.configuration-discard h3 {
  font-size: 15px;
  margin-bottom: 8px;
}
.configuration-discard > div {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}
.configuration-version {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
}
.configuration-version small {
  display: block;
  margin-top: 4px;
  font: 11px/1.6 var(--font-sans);
  overflow-wrap: anywhere;
}
.configuration-reload {
  max-width: 100%;
  white-space: normal;
}
@media (max-width: 480px) {
  .configuration-fields {
    grid-template-columns: 1fr;
  }
  .configuration-version {
    flex-basis: 100%;
  }
}
</style>
