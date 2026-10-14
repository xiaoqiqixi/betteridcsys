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
import { api } from "../lib/api";
import {
  readIntegrationManifest,
  previewIntegrations,
  type IntegrationSummary,
} from "../lib/integrations";
const props = defineProps<{ preview: boolean; refreshToken: number }>();
const items = ref<IntegrationSummary[]>([]),
  loading = ref(false),
  error = ref("");
const selected = ref<IntegrationSummary>(),
  drawer = ref<HTMLDialogElement>();
const groups = [
  {
    kind: "payment",
    title: "支付服务",
    caption: "独立收款适配器，让账务与渠道解耦。",
    icon: CreditCard,
  },
  {
    kind: "email",
    title: "邮件服务",
    caption: "统一发送接口，让投递渠道自由替换。",
    icon: Mail,
  },
];
const planned = [
  { name: "短信通知", icon: MessageSquare },
  { name: "对象存储", icon: HardDrive },
  { name: "节点控制器", icon: Server },
];
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
      ? previewIntegrations
      : readIntegrationManifest(await api<unknown>("/admin/integrations"));
    if (current === generation) items.value = result;
  } catch {
    // Do not echo backend diagnostics: configuration errors may contain secrets.
    if (current === generation)
      error.value = "无法读取扩展清单。请确认管理员会话与服务端状态后重试。";
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function open(item: IntegrationSummary) {
  selected.value = item;
  await nextTick();
  drawer.value?.showModal();
}
const label = (item: IntegrationSummary) =>
  !item.enabled || item.status === "disabled"
    ? "未启用"
    : item.status === "ready" && item.configured
      ? "配置就绪"
      : "不可用";
const tone = (item: IntegrationSummary) =>
  label(item) === "配置就绪"
    ? "green"
    : label(item) === "未启用"
      ? "gray"
      : "amber";
watch(() => [props.preview, props.refreshToken], load, { immediate: true });
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
        <p class="eyebrow">BUILT TO ADAPT</p>
        <h2>能力可扩展，核心保持简单。</h2>
        <p>
          在同一处查看支付与邮件适配器。渠道实现独立于业务，配置由服务端安全管理。
        </p>
      </div>
      <div class="integration-totals">
        <strong>{{ loading || error ? "—" : items.length }}</strong
        ><span>已注册适配器</span
        ><small>{{
          loading || error ? "等待读取" : `${enabledCount} 个已启用`
        }}</small>
      </div>
    </section>
    <div class="integration-boundary">
      <ShieldCheck :size="17" />
      <p>
        {{
          preview
            ? "样例清单 · 未连接任何外部服务。"
            : "以下状态来自服务端注册表，不代表外部服务连通性验证。"
        }}
        首版通过环境变量与密钥管理配置，本页仅供查看。
      </p>
    </div>
    <div v-if="error" class="alert error" role="alert">
      <AlertCircle :size="18" /><span>{{ error }}</span
      ><button @click="load">重试</button>
    </div>
    <div v-else-if="loading" class="panel integration-empty" role="status">
      <RefreshCw :size="20" class="spin" />
      <p>正在读取服务端扩展清单…</p>
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
            >{{
              items.filter((i) => i.kind === group.kind).length
            }}
            个适配器</span
          >
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
              ><span v-if="!item.capabilities.length">暂无可用能力</span>
            </div>
            <div class="integration-card-footer">
              <span><LockKeyhole :size="13" />服务端配置</span
              ><button
                class="text-button"
                :aria-label="`查看 ${item.name} 配置说明`"
                @click="open(item)"
              >
                配置说明<ArrowUpRight :size="15" />
              </button>
            </div>
          </article>
          <div
            v-if="!items.some((i) => i.kind === group.kind)"
            class="panel integration-empty"
          >
            <component :is="group.icon" :size="23" />
            <p>服务端尚未注册此类适配器。</p>
          </div>
        </div>
      </section>
    </template>
    <section class="integration-roadmap">
      <div>
        <p class="eyebrow">ROOM TO GROW</p>
        <h2>为未来，留好位置。</h2>
        <p>以下方向仍在规划中，尚未提供可用接口或插件。</p>
      </div>
      <div class="integration-planned">
        <div v-for="item in planned" :key="item.name">
          <component :is="item.icon" :size="18" /><span>{{ item.name }}</span
          ><small>规划中</small>
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
            <p class="eyebrow">INTEGRATION DETAILS</p>
            <h2 id="integration-title">{{ selected.name }}</h2>
          </div>
          <button
            class="icon-button"
            aria-label="关闭扩展详情"
            @click="drawer?.close()"
          >
            <X :size="21" />
          </button>
        </div>
        <div class="integration-detail-status">
          <span class="badge" :class="tone(selected)">{{
            label(selected)
          }}</span
          ><span class="mono">{{ selected.id }}</span>
        </div>
        <p class="integration-detail-description">{{ selected.description }}</p>
        <dl class="account-details">
          <div>
            <dt>当前选择</dt>
            <dd>{{ selected.enabled ? "已启用" : "未启用" }}</dd>
          </div>
          <div>
            <dt>配置状态</dt>
            <dd>{{ selected.configured ? "已配置" : "未配置" }}</dd>
          </div>
          <div>
            <dt>配置方式</dt>
            <dd>服务端环境变量</dd>
          </div>
        </dl>
        <section class="integration-detail-section">
          <h3>接口能力</h3>
          <div class="integration-capabilities">
            <span
              v-for="capability in selected.capabilities"
              :key="capability"
              >{{ capability }}</span
            ><span v-if="!selected.capabilities.length">暂无可用能力</span>
          </div>
        </section>
        <section class="integration-detail-section">
          <h3>配置项清单</h3>
          <p>这里只显示字段说明，不读取或展示已保存的配置值。</p>
          <div
            v-for="field in selected.configuration_fields"
            :key="field.key"
            class="integration-field"
          >
            <div>
              <b>{{ field.label }}</b
              ><span
                >{{ field.required ? "必填" : "可选" }} ·
                {{
                  field.secret || field.type === "secret_ref"
                    ? "密钥引用"
                    : field.type === "url"
                      ? "服务地址"
                      : "文本"
                }}</span
              >
            </div>
            <code>{{ field.key }}</code
            ><small v-if="field.secret || field.type === 'secret_ref'"
              ><LockKeyhole
                :size="12"
              />通过服务端密钥管理注入，不在浏览器输入</small
            >
          </div>
          <p
            v-if="!selected.configuration_fields.length"
            class="integration-field-empty"
          >
            此适配器未声明配置项。
          </p>
        </section>
        <section class="integration-detail-section">
          <h3>如何接入</h3>
          <ol class="integration-steps">
            <li>
              在服务端配置已注册的适配器与所需环境变量，密钥通过部署平台安全注入。
            </li>
            <li>
              重启服务使配置生效，返回此页刷新清单，并另行验证外部服务连通性。
            </li>
            <li>
              新供应商需实现类型化接口、注册并重新构建。暂不支持在线安装、上传脚本或在此切换。
            </li>
          </ol>
        </section>
        <div v-if="selected.limitations.length" class="integration-limitations">
          <b>当前限制</b>
          <ul>
            <li v-for="limitation in selected.limitations" :key="limitation">
              {{ limitation }}
            </li>
          </ul>
        </div>
        <button class="button secondary full" @click="drawer?.close()">
          关闭说明
        </button>
      </template>
    </dialog>
  </div>
</template>
