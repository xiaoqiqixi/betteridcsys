<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  CreditCard,
  Mail,
  Puzzle,
  ArrowUpRight,
  LockKeyhole,
  ShieldCheck,
  X,
  RefreshCw,
  MessageSquare,
  HardDrive,
  Server,
  AlertCircle,
} from "@lucide/vue";
import { locale, tr } from "../lib/i18n";
import { api } from "../lib/api";
import EmailSettingsPanel from "./EmailSettingsPanel.vue";
import {
  readIntegrationManifest,
  localizedPreviewIntegrations,
  type IntegrationSummary,
} from "../lib/integrations";
const props = defineProps<{ preview: boolean; refreshToken: number }>();
const items = ref<IntegrationSummary[]>([]),
  loading = ref(false),
  error = ref("");
const selected = ref<IntegrationSummary>(),
  drawer = ref<HTMLDialogElement>();
const smtpAvailable = ref(props.preview),
  smtpPanel = ref<HTMLElement>();
const groups = computed(() => [
  {
    kind: "payment",
    title: tr("支付服务", "Payment services"),
    caption: tr(
      "通过独立适配器连接支付服务。",
      "Payment providers connect through separate adapters.",
    ),
    icon: CreditCard,
  },
  {
    kind: "email",
    title: tr("邮件服务", "Email services"),
    caption: tr(
      "邮件服务使用统一的发送接口。",
      "Email providers share a typed delivery interface.",
    ),
    icon: Mail,
  },
]);
const planned = computed(() => [
  { name: tr("短信通知", "SMS notifications"), icon: MessageSquare },
  { name: tr("对象存储", "Object storage"), icon: HardDrive },
  { name: tr("节点控制器", "Server controllers"), icon: Server },
]);
const enabledCount = computed(
  () => items.value.filter((i) => i.enabled).length,
);
let generation = 0;
async function load() {
  const current = ++generation;
  drawer.value?.close();
  selected.value = undefined;
  error.value = "";
  items.value = [];
  loading.value = true;
  try {
    const result = props.preview
      ? localizedPreviewIntegrations()
      : readIntegrationManifest(await api<unknown>("/admin/integrations"));
    if (current === generation) {
      items.value = result;
      smtpAvailable.value = result.some((item) => item.id === "email.smtp");
    }
  } catch {
    // Do not echo backend diagnostics: configuration errors may contain secrets.
    if (current === generation)
      error.value = tr(
        "无法读取扩展清单。请确认管理员会话与服务端状态后重试。",
        "Cannot load integrations. Check your administrator session and server status, then retry.",
      );
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function open(item: IntegrationSummary) {
  if (item.id === "email.smtp") {
    smtpPanel.value?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    smtpPanel.value
      ?.querySelector<HTMLElement>("h3")
      ?.focus({ preventScroll: true });
    return;
  }
  selected.value = item;
  await nextTick();
  drawer.value?.showModal();
}
async function refreshManifest() {
  const current = generation;
  try {
    const result = readIntegrationManifest(
      await api<unknown>("/admin/integrations"),
    );
    if (current === generation && !props.preview) items.value = result;
  } catch {
    // The saved settings remain authoritative; never echo provider diagnostics.
    if (current === generation)
      error.value = tr(
        "SMTP 配置已保存，但扩展状态刷新失败。请稍后刷新。",
        "SMTP settings were saved, but integration status could not refresh. Refresh it later.",
      );
  }
}
const label = (item: IntegrationSummary) =>
  !item.enabled || item.status === "disabled"
    ? tr("未启用", "Disabled")
    : item.status === "ready" && item.configured
      ? tr("配置就绪", "Configured")
      : tr("不可用", "Unavailable");
const tone = (item: IntegrationSummary) =>
  label(item) === tr("配置就绪", "Configured")
    ? "green"
    : label(item) === tr("未启用", "Disabled")
      ? "gray"
      : "amber";
watch(() => [props.preview, props.refreshToken, locale.value], load, {
  immediate: true,
});
onBeforeUnmount(() => {
  generation++;
  drawer.value?.close();
});
</script>

<template>
  <div class="integrations-page">
    <section class="integration-intro panel">
      <div class="integration-intro-icon">
        <Puzzle :size="27" :stroke-width="1.5" />
      </div>
      <div class="integration-intro-copy">
        <p class="eyebrow">{{ tr("扩展清单", "INTEGRATIONS") }}</p>
        <h2>
          {{ tr("已注册扩展", "Registered integrations") }}
        </h2>
        <p>
          {{
            tr(
              "在同一处查看支付与邮件适配器。渠道实现独立于业务，配置由服务端安全管理。",
              "View payment and email adapters here. Provider implementations and configuration are managed on the server.",
            )
          }}
        </p>
      </div>
      <div class="integration-totals">
        <strong>{{ loading || error ? "—" : items.length }}</strong
        ><span> {{ tr("已注册适配器", "Registered adapters") }} </span
        ><small>{{
          loading || error
            ? tr("等待读取", "Waiting for data")
            : tr(`${enabledCount} 个已启用`, `${enabledCount} enabled`)
        }}</small>
      </div>
    </section>
    <div class="integration-boundary">
      <ShieldCheck :size="17" />
      <p>
        {{
          preview
            ? tr(
                "样例清单 · 未连接任何外部服务。",
                "Sample manifest · No external services connected.",
              )
            : tr(
                "以下状态来自服务端注册表，不代表外部服务连通性验证。",
                "Status comes from the server registry and does not prove connectivity to an external service.",
              )
        }}
        {{
          tr(
            "官方 SMTP 插件可在此配置；其他适配器按各自的配置说明管理。",
            "Configure the official SMTP plugin here; manage other adapters using their configuration guides.",
          )
        }}
      </p>
    </div>
    <div v-if="error" class="alert error" role="alert">
      <AlertCircle :size="18" /><span>{{ error }}</span
      ><button @click="load">{{ tr("重试", "Retry") }}</button>
    </div>
    <div v-else-if="loading" class="panel integration-empty" role="status">
      <RefreshCw :size="20" class="spin" />
      <p>
        {{
          tr(
            "正在读取服务端扩展清单…",
            "Loading the server integration manifest…",
          )
        }}
      </p>
    </div>
    <template v-else>
      <section
        v-for="group in groups"
        :key="group.kind"
        class="integration-group"
        :aria-label="group.title"
      >
        <div class="integration-group-heading">
          <div>
            <h2>{{ group.title }}</h2>
            <p>{{ group.caption }}</p>
          </div>
          <span class="tiny-tag"
            >{{ items.filter((i) => i.kind === group.kind).length }}
            {{ tr("个适配器", " adapters") }}
          </span>
        </div>
        <div class="integration-grid">
          <article
            v-for="item in items.filter((i) => i.kind === group.kind)"
            :key="item.id"
            class="panel integration-card"
          >
            <div class="integration-card-top">
              <span class="integration-provider-icon"
                ><component
                  :is="group.icon"
                  :size="23"
                  :stroke-width="1.6" /></span
              ><span class="badge" :class="tone(item)">{{ label(item) }}</span>
            </div>
            <h3>{{ item.name }}</h3>
            <p>{{ item.description }}</p>
            <div class="integration-capabilities">
              <span v-for="capability in item.capabilities" :key="capability">{{
                capability
              }}</span
              ><span v-if="!item.capabilities.length">
                {{ tr("暂无可用能力", "No available capabilities") }}
              </span>
            </div>
            <div class="integration-card-footer">
              <span
                ><LockKeyhole :size="13" />
                {{ tr("服务端配置", "Server configuration") }} </span
              ><button
                class="text-button"
                :aria-label="
                  item.id === 'email.smtp'
                    ? tr('配置 SMTP', 'Configure SMTP')
                    : tr(
                        `查看 ${item.name} 配置说明`,
                        `Configuration guide for ${item.name}`,
                      )
                "
                @click="open(item)"
              >
                {{
                  item.id === "email.smtp"
                    ? tr("配置 SMTP", "Configure SMTP")
                    : tr("配置说明", "Configuration guide")
                }}
                <ArrowUpRight :size="15" />
              </button>
            </div>
          </article>
          <div
            v-if="!items.some((i) => i.kind === group.kind)"
            class="panel integration-empty"
          >
            <component :is="group.icon" :size="23" />
            <p>
              {{
                tr(
                  "服务端尚未注册此类适配器。",
                  "No adapters of this kind are registered.",
                )
              }}
            </p>
          </div>
        </div>
      </section>
    </template>
    <div v-if="smtpAvailable || preview" ref="smtpPanel">
      <EmailSettingsPanel
        :preview="preview"
        :refresh-token="refreshToken"
        @saved="refreshManifest"
      />
    </div>
    <section class="integration-roadmap">
      <div>
        <p class="eyebrow">{{ tr("后续扩展", "PLANNED EXTENSIONS") }}</p>
        <h2>{{ tr("计划中的扩展", "Planned integrations") }}</h2>
        <p>
          {{
            tr(
              "以下方向仍在规划中，尚未提供可用接口或插件。",
              "These extensions are planned. No working interfaces or plugins are available yet.",
            )
          }}
        </p>
      </div>
      <div class="integration-planned">
        <div v-for="item in planned" :key="item.name">
          <component :is="item.icon" :size="18" /><span>{{ item.name }}</span
          ><small> {{ tr("规划中", "Planned") }} </small>
        </div>
      </div>
    </section>
    <dialog
      ref="drawer"
      class="modal integration-drawer"
      aria-labelledby="integration-title"
      @close="selected = undefined"
    >
      <template v-if="selected"
        ><div class="modal-heading">
          <div>
            <p class="eyebrow">{{ tr("扩展详情", "Integration details") }}</p>
            <h2 id="integration-title">{{ selected.name }}</h2>
          </div>
          <button
            class="icon-button"
            :aria-label="tr('关闭扩展详情', 'Close integration details')"
            @click="drawer?.close()"
          >
            <X :size="21" />
          </button>
        </div>
        <div class="modal-body">
          <div class="integration-detail-status">
            <span class="badge" :class="tone(selected)">{{
              label(selected)
            }}</span
            ><span class="mono">{{ selected.id }}</span>
          </div>
          <p class="integration-detail-description">
            {{ selected.description }}
          </p>
          <dl class="account-details">
            <div>
              <dt>{{ tr("当前选择", "Selection") }}</dt>
              <dd>
                {{
                  selected.enabled
                    ? tr("已启用", "Enabled")
                    : tr("未启用", "Disabled")
                }}
              </dd>
            </div>
            <div>
              <dt>{{ tr("配置状态", "Configuration status") }}</dt>
              <dd>
                {{
                  selected.configured
                    ? tr("已配置", "Configured")
                    : tr("未配置", "Not configured")
                }}
              </dd>
            </div>
            <div>
              <dt>{{ tr("配置方式", "Configuration method") }}</dt>
              <dd>
                {{
                  selected.configuration_mode === "admin_api"
                    ? tr("管理员设置", "Administrator settings")
                    : tr("服务端环境变量", "Server environment variables")
                }}
              </dd>
            </div>
          </dl>
          <section
            v-if="selected.kind === 'payment'"
            class="integration-detail-section"
          >
            <h3>{{ tr("支持币种", "Supported currencies") }}</h3>
            <p>
              {{
                selected.supported_currencies.length
                  ? selected.supported_currencies
                      .map(
                        (code) =>
                          `${code} · ${selected?.currency_decimal_places[code]} ${tr("位小数", "decimal places")}`,
                      )
                      .join(" / ")
                  : tr("无可用支付币种", "No payment currencies available")
              }}
            </p>
          </section>
          <section class="integration-detail-section">
            <h3>{{ tr("接口能力", "Capabilities") }}</h3>
            <div class="integration-capabilities">
              <span
                v-for="capability in selected.capabilities"
                :key="capability"
                >{{ capability }}</span
              ><span v-if="!selected.capabilities.length">
                {{ tr("暂无可用能力", "No available capabilities") }}
              </span>
            </div>
          </section>
          <section class="integration-detail-section">
            <h3>{{ tr("配置项清单", "Configuration fields") }}</h3>
            <p>
              {{
                tr(
                  "这里只显示字段说明，不读取或展示已保存的配置值。",
                  "Only field descriptions are shown. Saved values are never read or displayed here.",
                )
              }}
            </p>
            <div
              v-for="field in selected.configuration_fields"
              :key="field.key"
              class="integration-field"
            >
              <div>
                <b>{{ field.label }}</b
                ><span
                  >{{
                    field.required
                      ? tr("必填", "Required")
                      : tr("可选", "Optional")
                  }}
                  ·
                  {{
                    field.secret || field.type === "secret_ref"
                      ? tr("密钥引用", "Secret reference")
                      : field.type === "url"
                        ? tr("服务地址", "Service URL")
                        : tr("文本", "Text")
                  }}</span
                >
              </div>
              <code>{{ field.key }}</code
              ><small v-if="field.secret || field.type === 'secret_ref'"
                ><LockKeyhole :size="12" />
                {{
                  tr(
                    "通过服务端密钥管理注入，不在浏览器输入",
                    "Injected through server secret management, never entered in the browser",
                  )
                }}
              </small>
            </div>
            <p
              v-if="!selected.configuration_fields.length"
              class="integration-field-empty"
            >
              {{
                tr(
                  "此适配器未声明配置项。",
                  "This adapter has no configuration fields.",
                )
              }}
            </p>
          </section>
          <section class="integration-detail-section">
            <h3>{{ tr("如何接入", "How to connect") }}</h3>
            <ol class="integration-steps">
              <li>
                {{
                  tr(
                    "在服务端配置已注册的适配器与所需环境变量，密钥通过部署平台安全注入。",
                    "Configure a registered adapter and its environment variables on the server. Inject secrets securely through the deployment platform.",
                  )
                }}
              </li>
              <li>
                {{
                  tr(
                    "重启服务使配置生效，返回此页刷新清单，并另行验证外部服务连通性。",
                    "Restart the service, refresh this page, and separately verify connectivity to the external provider.",
                  )
                }}
              </li>
              <li>
                {{
                  tr(
                    "新供应商需实现类型化接口、注册并重新构建。暂不支持在线安装、上传脚本或在此切换。",
                    "New providers require a typed implementation, registration and rebuild. Online installation, script upload and switching here are not supported.",
                  )
                }}
              </li>
            </ol>
          </section>
          <div
            v-if="selected.limitations.length"
            class="integration-limitations"
          >
            <b> {{ tr("当前限制", "Current limitations") }} </b>
            <ul>
              <li v-for="limitation in selected.limitations" :key="limitation">
                {{ limitation }}
              </li>
            </ul>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button secondary full" @click="drawer?.close()">
            {{ tr("关闭说明", "Close guide") }}
          </button>
        </div>
      </template>
    </dialog>
  </div>
</template>
