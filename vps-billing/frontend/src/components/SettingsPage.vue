<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Check, Cloud, Eye, RefreshCw, Save, Server, Star } from "@lucide/vue";
import { api, ApiError } from "../lib/api";
import { tr } from "../lib/i18n";
import {
  defaultSiteSettings,
  readSiteSettings,
  safeSettingsURL,
  safeSettingsEmailHref,
  validateSiteSettings,
  type SettingsField,
  type SettingsIssue,
  type SiteSettings,
} from "../lib/settings";

const props = defineProps<{ preview: boolean }>();
const emit = defineEmits<{ saved: [settings: SiteSettings] }>();
const form = ref<SiteSettings>({ ...defaultSiteSettings });
const baseline = ref<SiteSettings>();
const loading = ref(false),
  saving = ref(false),
  saved = ref(false);
const advanced = ref(false),
  blocked = ref(false);
const error = ref<
  "" | "load" | "conflict" | "invalid" | "session" | "uncertain"
>("");
const issues = ref<SettingsIssue[]>([]);
const page = ref<HTMLElement>();
let generation = 0;
const dirty = computed(
  () =>
    baseline.value !== undefined &&
    JSON.stringify(form.value) !== JSON.stringify(baseline.value),
);
const logos = computed(
  () =>
    [
      { value: "star", name: tr("星形", "Star"), icon: Star },
      { value: "cloud", name: tr("云朵", "Cloud"), icon: Cloud },
      { value: "server", name: tr("服务器", "Server"), icon: Server },
    ] as const,
);
const themes = computed(
  () =>
    [
      { value: "blue", name: tr("海蓝", "Blue") },
      { value: "teal", name: tr("青绿", "Teal") },
      { value: "violet", name: tr("紫色", "Violet") },
    ] as const,
);
const logo = computed(
  () =>
    logos.value.find((item) => item.value === form.value.logo)?.icon || Star,
);
const supportHref = computed(() => safeSettingsURL(form.value.support_url));
const displayHref = computed(() =>
  safeSettingsURL(form.value.display_url, true),
);
const emailHref = computed(() =>
  safeSettingsEmailHref(form.value.support_email),
);
const errorText = computed(
  () =>
    ({
      load: tr(
        "无法读取站点设置，请确认管理员会话后重试。",
        "Could not load site settings. Check your administrator session and retry.",
      ),
      conflict: tr(
        "设置已被其他管理员修改。你的草稿仍保留在本页；请先复制需要保留的内容，再重新读取。",
        "Another administrator changed these settings. Your draft is still here; copy any changes you need before reloading.",
      ),
      invalid: tr(
        "请检查标注的字段后再保存。",
        "Check the highlighted fields before saving.",
      ),
      session: tr(
        "管理员会话或操作验证已失效，请重新登录后读取设置。",
        "Your administrator session or request verification has expired. Sign in again, then reload settings.",
      ),
      uncertain: tr(
        "无法确认保存结果。请先保留草稿并重新读取，核对服务器上的设置后再编辑。",
        "The save result could not be confirmed. Keep a copy of your draft, then reload and check the saved settings before editing again.",
      ),
      "": "",
    })[error.value],
);
function fieldError(field: SettingsField) {
  const issue = issues.value.find((item) => item.field === field);
  if (!issue) return "";
  return {
    required: tr("此项不能为空。", "This field is required."),
    text: tr(
      "内容过长或包含不支持的控制字符。中文占用多个字节，请适当缩短。",
      "The text is too long or contains unsupported control characters. Non-ASCII characters may use more bytes.",
    ),
    email: tr(
      "请填写有效邮箱，不要包含联系人姓名。",
      "Enter an email address without a display name.",
    ),
    url: tr(
      "请填写完整 HTTPS 地址，不含账号、密码或片段。",
      "Enter an HTTPS URL without credentials or a fragment.",
    ),
    origin: tr(
      "仅填写 HTTPS 域名和可选端口，不含末尾斜线、路径、查询或片段。",
      "Enter an HTTPS origin with an optional port, without a trailing slash, path, query, or fragment.",
    ),
    choice: tr("请选择提供的选项。", "Choose one of the listed options."),
    revision: tr(
      "版本号无效，请重新读取。",
      "Invalid revision. Reload settings.",
    ),
  }[issue.reason];
}
async function load() {
  if (saving.value) return;
  const current = ++generation;
  loading.value = true;
  baseline.value = undefined;
  error.value = "";
  issues.value = [];
  blocked.value = false;
  saved.value = false;
  try {
    const result = props.preview
      ? { ...defaultSiteSettings }
      : readSiteSettings(await api<unknown>("/admin/site-settings"));
    if (current !== generation) return;
    form.value = { ...result };
    baseline.value = { ...result };
  } catch {
    if (current === generation) error.value = "load";
  } finally {
    if (current === generation) loading.value = false;
  }
}
async function save() {
  if (
    props.preview ||
    saving.value ||
    loading.value ||
    !dirty.value ||
    blocked.value
  )
    return;
  issues.value = validateSiteSettings(form.value);
  saved.value = false;
  error.value = "";
  if (issues.value.length) {
    error.value = "invalid";
    if (
      issues.value.some((item) =>
        [
          "display_url",
          "email_signature",
          "invoice_issuer",
          "invoice_address",
        ].includes(item.field),
      )
    )
      advanced.value = true;
    await nextTick();
    page.value
      ?.querySelector<HTMLElement>(`[name="${issues.value[0]!.field}"]`)
      ?.focus();
    return;
  }
  const current = generation;
  saving.value = true;
  try {
    const result = readSiteSettings(
      await api<unknown>("/admin/site-settings", "POST", { ...form.value }),
    );
    if (current !== generation || props.preview) return;
    form.value = { ...result };
    baseline.value = { ...result };
    saved.value = true;
    emit("saved", result);
  } catch (cause) {
    if (current !== generation) return;
    if (cause instanceof ApiError && cause.code === "SETTINGS_CONFLICT") {
      error.value = "conflict";
    } else if (cause instanceof ApiError && cause.code === "INVALID_SETTINGS") {
      error.value = "invalid";
    } else if (
      cause instanceof ApiError &&
      [
        "FORBIDDEN",
        "AUTH_REQUIRED",
        "UNAUTHORIZED",
        "UNAUTHENTICATED",
        "CSRF_INVALID",
        "INVALID_CSRF",
        "CSRF_FAILED",
        "ORIGIN_DENIED",
      ].includes(cause.code)
    ) {
      error.value = "session";
    } else {
      // A network error may occur after the transaction committed. Reload,
      // rather than guessing that a second write would be safe.
      error.value = "uncertain";
    }
    blocked.value = error.value !== "invalid";
  } finally {
    if (current === generation) saving.value = false;
  }
}
watch(
  () => props.preview,
  () => {
    generation++;
    saving.value = false;
    void load();
  },
  { immediate: true },
);
watch(
  form,
  () => {
    saved.value = false;
  },
  { deep: true, flush: "sync" },
);
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <div ref="page" class="settings-page">
    <div class="settings-intro">
      <div>
        <h2>{{ tr("站点与运营信息", "Site and operator settings") }}</h2>
        <p>
          {{
            tr(
              "管理客户看到的名称、联系方式和默认选项。保存后生效。",
              "Manage your customer-facing identity, contact details, and defaults. Changes take effect after saving.",
            )
          }}
        </p>
      </div>
      <span v-if="baseline && !preview" class="tiny-tag"
        >{{ tr("版本", "Revision") }} {{ baseline.revision }}</span
      >
    </div>
    <div v-if="preview" class="settings-notice" role="status">
      <Eye :size="18" />
      <p>
        {{
          tr(
            "离线预览：可在本页试改样式，所有修改都不会保存，也不会请求服务器。",
            "Offline preview: try changes on this page. Nothing is saved or sent to the server.",
          )
        }}
      </p>
    </div>
    <div v-if="error" class="alert error settings-feedback" role="alert">
      <span>{{ errorText }}</span>
      <button v-if="error === 'load'" type="button" @click="load">
        {{ tr("重试", "Retry") }}
      </button>
    </div>
    <div v-if="saved" class="settings-success" role="status">
      <Check :size="18" />{{
        tr(
          "设置已保存。已有账单的金额、币种和开具信息保持不变。",
          "Settings saved. Existing invoices retain their amounts, currencies, and issuer details.",
        )
      }}
    </div>
    <div v-if="loading" class="panel settings-loading" role="status">
      <RefreshCw :size="20" class="spin" />{{
        tr("正在读取站点设置…", "Loading site settings…")
      }}
    </div>
    <form
      v-else-if="baseline"
      class="settings-layout"
      novalidate
      @submit.prevent="save"
    >
      <fieldset class="settings-fields" :disabled="saving">
        <legend class="settings-sr-only">
          {{ tr("站点设置", "Site settings") }}
        </legend>
        <section class="panel settings-section">
          <h3>{{ tr("名称与外观", "Identity and appearance") }}</h3>
          <div class="settings-field">
            <label for="settings-site-name"
              >{{ tr("站点名称", "Site name") }}
              <span>{{ tr("必填", "Required") }}</span></label
            >
            <input
              id="settings-site-name"
              v-model="form.site_name"
              name="site_name"
              required
              maxlength="120"
              :aria-invalid="!!fieldError('site_name')"
              aria-describedby="settings-site-name-error"
            />
            <small
              v-if="fieldError('site_name')"
              id="settings-site-name-error"
              class="settings-field-error"
              >{{ fieldError("site_name") }}</small
            >
          </div>
          <div class="settings-field">
            <label for="settings-company">{{
              tr("公司或运营方名称", "Company or operator name")
            }}</label>
            <input
              id="settings-company"
              v-model="form.company_name"
              name="company_name"
              maxlength="240"
              :aria-invalid="!!fieldError('company_name')"
              aria-describedby="settings-company-error"
            />
            <small
              v-if="fieldError('company_name')"
              id="settings-company-error"
              class="settings-field-error"
              >{{ fieldError("company_name") }}</small
            >
          </div>
          <fieldset class="settings-choice-group">
            <legend>{{ tr("站点标志", "Site logo") }}</legend>
            <div class="settings-choices">
              <label
                v-for="item in logos"
                :key="item.value"
                class="settings-choice"
              >
                <input
                  v-model="form.logo"
                  type="radio"
                  name="logo"
                  :value="item.value"
                /><component :is="item.icon" :size="20" /><span>{{
                  item.name
                }}</span>
              </label>
            </div>
            <p class="settings-help">
              {{
                tr(
                  "目前提供三种内置标志，暂不支持上传或外部图片。",
                  "Choose from three built-in logos. Uploads and external images are not supported yet.",
                )
              }}
            </p>
          </fieldset>
          <fieldset class="settings-choice-group">
            <legend>{{ tr("主题色", "Theme color") }}</legend>
            <div class="settings-choices">
              <label
                v-for="item in themes"
                :key="item.value"
                class="settings-choice"
              >
                <input
                  v-model="form.theme"
                  type="radio"
                  name="theme"
                  :value="item.value"
                /><i
                  class="settings-swatch"
                  :class="`settings-swatch-${item.value}`"
                  aria-hidden="true"
                ></i
                ><span>{{ item.name }}</span>
              </label>
            </div>
          </fieldset>
        </section>
        <section class="panel settings-section">
          <h3>{{ tr("默认语言与币种", "Default language and currency") }}</h3>
          <p class="settings-help">
            {{
              tr(
                "用于没有自行选择偏好的访客。语言与币种独立，切换语言不会换算价格。",
                "Used for visitors without a saved preference. Language and currency are independent; changing language does not convert prices.",
              )
            }}
          </p>
          <div class="settings-two-columns">
            <div class="settings-field">
              <label for="settings-locale">{{
                tr("默认语言", "Default language")
              }}</label>
              <select
                id="settings-locale"
                v-model="form.default_locale"
                name="default_locale"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div class="settings-field">
              <label for="settings-currency">{{
                tr("默认币种", "Default currency")
              }}</label>
              <select
                id="settings-currency"
                v-model="form.default_currency"
                name="default_currency"
              >
                <option value="CNY">
                  {{ tr("CNY · 人民币", "CNY · Chinese yuan") }}
                </option>
                <option value="USD">
                  {{ tr("USD · 美元", "USD · US dollar") }}
                </option>
              </select>
            </div>
          </div>
          <p class="settings-help">
            {{
              tr(
                "套餐需分别设置 CNY 和 USD 价格。本页不会修改套餐价格或历史账单。",
                "Plans require separate CNY and USD prices. This page does not change plan prices or existing invoices.",
              )
            }}
          </p>
        </section>
        <section class="panel settings-section">
          <h3>{{ tr("客户支持", "Customer support") }}</h3>
          <div class="settings-field">
            <label for="settings-email">{{
              tr("客服邮箱", "Support email")
            }}</label>
            <input
              id="settings-email"
              v-model="form.support_email"
              name="support_email"
              type="email"
              maxlength="254"
              placeholder="support@example.com"
              :aria-invalid="!!fieldError('support_email')"
              aria-describedby="settings-email-error"
            />
            <small
              v-if="fieldError('support_email')"
              id="settings-email-error"
              class="settings-field-error"
              >{{ fieldError("support_email") }}</small
            >
          </div>
          <div class="settings-field">
            <label for="settings-support-url">{{
              tr("帮助或联系页面", "Help or contact page")
            }}</label>
            <input
              id="settings-support-url"
              v-model="form.support_url"
              name="support_url"
              type="url"
              maxlength="500"
              placeholder="https://example.com/support"
              :aria-invalid="!!fieldError('support_url')"
              aria-describedby="settings-support-url-error"
            />
            <small
              v-if="fieldError('support_url')"
              id="settings-support-url-error"
              class="settings-field-error"
              >{{ fieldError("support_url") }}</small
            >
          </div>
        </section>
        <details
          class="panel settings-advanced"
          :open="advanced"
          @toggle="advanced = ($event.target as HTMLDetailsElement).open"
        >
          <summary>
            {{
              tr(
                "高级设置：账单、邮件署名与展示域名",
                "Advanced: invoices, email signature, and display domain",
              )
            }}
          </summary>
          <div class="settings-section">
            <h3>
              {{ tr("新账单开具信息", "Issuer details for new invoices") }}
            </h3>
            <p class="settings-help">
              {{
                tr(
                  "新订单及账单会保存创建时的运营方信息。修改后只对新记录生效；没有历史抬头的旧记录仍标记为未知。",
                  "New orders and invoices snapshot the operator identity when created. Changes apply only to new records; older records without an identity remain unknown.",
                )
              }}
            </p>
            <div class="settings-field">
              <label for="settings-issuer"
                >{{ tr("账单开具方", "Invoice issuer") }}
                <span>{{ tr("必填", "Required") }}</span></label
              >
              <input
                id="settings-issuer"
                v-model="form.invoice_issuer"
                name="invoice_issuer"
                required
                maxlength="240"
                :aria-invalid="!!fieldError('invoice_issuer')"
                aria-describedby="settings-issuer-error"
              />
              <small
                v-if="fieldError('invoice_issuer')"
                id="settings-issuer-error"
                class="settings-field-error"
                >{{ fieldError("invoice_issuer") }}</small
              >
            </div>
            <div class="settings-field">
              <label for="settings-address">{{
                tr("账单开具方地址", "Issuer address")
              }}</label>
              <textarea
                id="settings-address"
                v-model="form.invoice_address"
                name="invoice_address"
                rows="3"
                maxlength="1000"
                :aria-invalid="!!fieldError('invoice_address')"
                aria-describedby="settings-address-error"
              ></textarea>
              <small
                v-if="fieldError('invoice_address')"
                id="settings-address-error"
                class="settings-field-error"
                >{{ fieldError("invoice_address") }}</small
              >
            </div>
            <div class="settings-field">
              <label for="settings-signature">{{
                tr("邮件署名", "Email signature")
              }}</label>
              <textarea
                id="settings-signature"
                v-model="form.email_signature"
                name="email_signature"
                rows="3"
                maxlength="1000"
                :aria-invalid="!!fieldError('email_signature')"
                aria-describedby="settings-signature-help settings-signature-error"
              ></textarea>
              <p id="settings-signature-help" class="settings-help">
                {{
                  tr(
                    "仅保存纯文本署名，邮件服务仍未接入，保存不会发信。不支持 HTML 模板。",
                    "Stores a plain-text signature only. Email delivery remains disabled; saving does not send email. HTML templates are not supported.",
                  )
                }}
              </p>
              <small
                v-if="fieldError('email_signature')"
                id="settings-signature-error"
                class="settings-field-error"
                >{{ fieldError("email_signature") }}</small
              >
            </div>
            <div class="settings-field">
              <label for="settings-domain">{{
                tr("展示域名", "Display domain")
              }}</label>
              <input
                id="settings-domain"
                v-model="form.display_url"
                name="display_url"
                type="url"
                maxlength="300"
                placeholder="https://example.com"
                :aria-invalid="!!fieldError('display_url')"
                aria-describedby="settings-domain-help settings-domain-error"
              />
              <p id="settings-domain-help" class="settings-help">
                {{
                  tr(
                    "只作为客户可见的网站链接，不会修改 DNS、TLS 证书、登录来源限制或服务监听地址。请填写已有 HTTPS 网站的域名，不含末尾斜线。",
                    "A customer-facing website link only. This does not configure DNS, TLS certificates, login origin checks, or server addresses. Enter an existing HTTPS origin without a trailing slash.",
                  )
                }}
              </p>
              <small
                v-if="fieldError('display_url')"
                id="settings-domain-error"
                class="settings-field-error"
                >{{ fieldError("display_url") }}</small
              >
            </div>
          </div>
        </details>
        <div class="settings-actions">
          <div class="settings-action-buttons">
            <button
              class="button primary"
              type="submit"
              :disabled="preview || saving || !dirty || blocked"
            >
              <Save :size="16" />{{
                saving
                  ? tr("正在保存…", "Saving…")
                  : tr("保存设置", "Save settings")
              }}
            </button>
            <button
              class="button secondary"
              type="button"
              :disabled="saving"
              @click="load"
            >
              <RefreshCw :size="15" />{{
                dirty
                  ? tr("重新读取并放弃修改", "Reload and discard changes")
                  : tr("重新读取", "Reload")
              }}
            </button>
          </div>
          <span class="settings-help" aria-live="polite">{{
            preview
              ? tr("仅供本页预览", "Preview on this page only")
              : dirty
                ? tr("有未保存的修改", "Unsaved changes")
                : tr("与已保存设置一致", "Matches saved settings")
          }}</span>
        </div>
      </fieldset>
      <aside
        class="settings-preview"
        :data-theme="form.theme"
        :aria-label="tr('本页预览', 'Local preview')"
      >
        <div class="settings-preview-heading">
          <Eye :size="16" />
          <h3>{{ tr("本页预览", "Local preview") }}</h3>
        </div>
        <p class="settings-help">
          {{
            tr(
              "仅展示当前草稿，保存前不影响其他页面。",
              "Shows this draft only. Other pages change after saving.",
            )
          }}
        </p>
        <div class="panel settings-preview-card">
          <div class="settings-preview-brand">
            <span class="brand-mark"><component :is="logo" :size="21" /></span
            ><strong>{{
              form.site_name || tr("站点名称", "Site name")
            }}</strong>
          </div>
          <p v-if="form.company_name" class="settings-preview-company">
            {{ form.company_name }}
          </p>
          <div class="settings-preview-toolbar">
            <span>{{ tr("客户工作台", "Customer console") }}</span
            ><span class="settings-preview-primary">{{
              tr("查看套餐", "View plans")
            }}</span>
          </div>
          <div
            v-if="supportHref || emailHref || displayHref"
            class="settings-preview-links"
          >
            <a
              v-if="supportHref"
              :href="supportHref"
              target="_blank"
              rel="noopener noreferrer"
              >{{ tr("联系支持", "Contact support") }}</a
            >
            <a v-if="emailHref" :href="emailHref">{{ form.support_email }}</a>
            <a
              v-if="displayHref"
              :href="displayHref"
              target="_blank"
              rel="noopener noreferrer"
              >{{ form.display_url }}</a
            >
          </div>
        </div>
        <div class="panel settings-preview-card settings-invoice-preview">
          <p class="settings-preview-label">
            {{ tr("新账单抬头示意", "New invoice header preview") }}
          </p>
          <strong>{{
            form.invoice_issuer || tr("请填写开具方", "Enter an issuer")
          }}</strong>
          <p v-if="form.invoice_address" class="settings-preview-multiline">
            {{ form.invoice_address }}
          </p>
          <p v-if="form.support_email">{{ form.support_email }}</p>
          <span class="settings-help">{{
            tr(
              "此处为示意，不会创建账单。",
              "Preview only. No invoice is created.",
            )
          }}</span>
        </div>
        <div v-if="form.email_signature" class="panel settings-preview-card">
          <p class="settings-preview-label">
            {{ tr("邮件署名示意", "Email signature preview") }}
          </p>
          <p class="settings-preview-multiline">{{ form.email_signature }}</p>
          <span class="settings-help">{{
            tr("邮件服务未接入", "Email delivery is disabled")
          }}</span>
        </div>
      </aside>
    </form>
  </div>
</template>
