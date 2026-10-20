<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import {
  api,
  ApiError,
  type CustomerAccount,
  type CustomerAccountsPage as AccountPage,
} from "../lib/api";
import { tr } from "../lib/i18n";
import ManagementDialog from "./ManagementDialog.vue";
const props = defineProps<{
  account: string;
  preview?: boolean;
  refreshKey?: number;
}>();
const emit = defineEmits<{ "auth-expired": []; saved: [] }>();
const page = ref<AccountPage>(),
  loading = ref(false),
  saving = ref(false),
  error = ref(""),
  requestID = ref(""),
  notice = ref("");
const filters = reactive({ q: "", role: "", status: "" });
let applied = { ...filters },
  generation = 0,
  detailGeneration = 0;
const cursors = ref([""]),
  index = ref(0);
const task = ref<"create" | "edit" | "password" | "revoke" | "">("");
const selected = ref<CustomerAccount>();
const readingSelected = ref(false);
const invalidFields = ref<string[]>([]);
const draft = reactive({
  name: "",
  email: "",
  role: "customer" as "customer" | "admin",
  disabled: false,
  password: "",
  confirmation: "",
  reason: "",
  agreed: false,
});
const modalError = ref(""),
  blocked = ref(false);
const dialogTitle = computed(
  () =>
    ({
      create: tr("创建账户", "Create account"),
      edit: tr("修改账户权限", "Edit account access"),
      password: tr("重置登录密码", "Reset password"),
      revoke: tr("撤销全部会话", "Revoke all sessions"),
      "": "",
    })[task.value],
);
const self = computed(() => selected.value?.id === props.account.split(":")[0]);
const bytes = (s: string) => new TextEncoder().encode(s).length;
function message(cause: unknown, writing = false) {
  const code = cause instanceof ApiError ? cause.code : "";
  if (cause instanceof ApiError) requestID.value = cause.requestId ?? "";
  const labels: Record<string, [string, string]> = {
    ACCOUNT_CONFLICT: [
      "账户已被其他操作修改。请关闭并刷新，再核对后重新填写。",
      "This account changed. Close and reload, then review before editing again.",
    ],
    SELF_ACCOUNT_CHANGE: [
      "不能停用自己或降低自己的管理员权限。请由另一位管理员处理。",
      "You cannot disable or demote your own account. Ask another administrator.",
    ],
    LAST_ACTIVE_ADMIN: [
      "必须保留至少一名启用的管理员，不能停用或降权最后一名。",
      "At least one active administrator must remain.",
    ],
    ACCOUNT_EXISTS: [
      "该邮箱已有账户，请核对现有记录。",
      "An account already uses this email. Check the existing record.",
    ],
    INVALID_ACCOUNT: [
      "请核对姓名、邮箱、角色、密码及必填操作原因。",
      "Check the name, email, role, password and required reason.",
    ],
  };
  if (Object.hasOwn(labels, code)) return tr(...labels[code]!);
  return writing
    ? tr(
        "无法确认操作结果。请关闭并刷新核对账户；不会自动重试。",
        "The result is unconfirmed. Close and reload the account before another operation. No automatic retry.",
      )
    : tr(
        "未能读取账户。请重试；已有内容可能不是最新状态。",
        "Accounts could not be loaded. Retry; previously loaded data may be stale.",
      );
}
function read(value: unknown): AccountPage {
  const p = value as AccountPage;
  if (
    !p ||
    !Array.isArray(p.items) ||
    typeof p.has_more !== "boolean" ||
    p.limit !== 50 ||
    p.items.length > 50 ||
    (p.has_more &&
      (typeof p.next_cursor !== "string" ||
        !p.next_cursor ||
        p.next_cursor.length > 2048))
  )
    throw Error("INVALID_ACCOUNT_PAGE");
  const items = p.items.map((c) => {
    if (
      !c ||
      !["id", "email", "name"].every(
        (k) => typeof c[k as keyof CustomerAccount] === "string",
      ) ||
      !["admin", "customer"].includes(c.role) ||
      typeof c.disabled !== "boolean" ||
      !Number.isSafeInteger(c.revision) ||
      c.revision < 1
    )
      throw Error("INVALID_ACCOUNT");
    return {
      id: c.id,
      email: c.email,
      name: c.name,
      role: c.role,
      disabled: c.disabled,
      revision: c.revision,
    };
  });
  return {
    items,
    has_more: p.has_more,
    limit: 50,
    ...(p.has_more ? { next_cursor: p.next_cursor } : {}),
  };
}
async function load(cursor = "", target = index.value) {
  if (saving.value) return;
  const current = ++generation;
  loading.value = true;
  error.value = "";
  requestID.value = "";
  if (!props.account.endsWith(":admin")) {
    page.value = undefined;
    loading.value = false;
    return;
  }
  if (props.preview) {
    page.value = { items: [], has_more: false, limit: 50 };
    loading.value = false;
    return;
  }
  try {
    const q = new URLSearchParams({ limit: "50" });
    for (const [k, v] of Object.entries(applied)) if (v) q.set(k, v);
    if (cursor) q.set("cursor", cursor);
    const result = read(await api<unknown>("/admin/customer-accounts?" + q));
    if (current !== generation) return;
    page.value = result;
    index.value = target;
    cursors.value = cursors.value.slice(0, target + 1);
    cursors.value[target] = cursor;
  } catch (cause) {
    if (current !== generation) return;
    if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) {
      page.value = undefined;
      emit("auth-expired");
    }
    error.value = message(cause);
  } finally {
    if (current === generation) loading.value = false;
  }
}
function search() {
  applied = { q: filters.q.trim(), role: filters.role, status: filters.status };
  if (bytes(applied.q) > 120) {
    error.value = tr(
      "关键词不能超过120字节。",
      "Search must fit within 120 UTF-8 bytes.",
    );
    return;
  }
  void load("", 0);
}
function reset() {
  Object.assign(filters, { q: "", role: "", status: "" });
  search();
}
function turn(next: boolean) {
  if (loading.value || error.value || !page.value) return;
  if (next && page.value.has_more)
    void load(page.value.next_cursor, index.value + 1);
  else if (!next && index.value > 0)
    void load(cursors.value[index.value - 1], index.value - 1);
}
function clear() {
  detailGeneration++;
  readingSelected.value = false;
  invalidFields.value = [];
  task.value = "";
  selected.value = undefined;
  Object.assign(draft, {
    name: "",
    email: "",
    role: "customer",
    disabled: false,
    password: "",
    confirmation: "",
    reason: "",
    agreed: false,
  });
  modalError.value = "";
  blocked.value = false;
}
async function open(kind: typeof task.value, item?: CustomerAccount) {
  if (saving.value) return;
  clear();
  if (props.preview) return;
  selected.value = item;
  Object.assign(draft, {
    name: item?.name ?? "",
    email: item?.email ?? "",
    role: item?.role ?? "customer",
    disabled: item?.disabled ?? false,
  });
  task.value = kind;
  if (item) {
    readingSelected.value = true;
    const current = detailGeneration,
      identity = props.account;
    try {
      const latest = await api<CustomerAccount>(
        "/admin/customer-accounts/" + encodeURIComponent(item.id),
      );
      if (
        current !== detailGeneration ||
        identity !== props.account ||
        selected.value?.id !== item.id
      )
        return;
      const valid = read({ items: [latest], limit: 50, has_more: false })
        .items[0]!;
      selected.value = valid;
      Object.assign(draft, {
        name: valid.name,
        role: valid.role,
        disabled: valid.disabled,
      });
    } catch (cause) {
      if (
        current === detailGeneration &&
        identity === props.account &&
        selected.value?.id === item.id
      ) {
        blocked.value = true;
        modalError.value = message(cause);
        if (
          cause instanceof ApiError &&
          [401, 403].includes(cause.status ?? 0)
        ) {
          clear();
          page.value = undefined;
          emit("auth-expired");
        }
      }
    } finally {
      if (current === detailGeneration && identity === props.account)
        readingSelected.value = false;
    }
  }
}
function close() {
  if (!saving.value) clear();
}
async function submit() {
  if (
    saving.value ||
    readingSelected.value ||
    blocked.value ||
    props.preview ||
    !task.value
  )
    return;
  modalError.value = "";
  const reason = draft.reason.trim();
  const passwordTask = ["create", "password"].includes(task.value);
  invalidFields.value = [];
  const plain = (value: string) => !/[\p{Cc}\p{Cf}\p{Cs}<>]/u.test(value);
  if (
    ["create", "edit"].includes(task.value) &&
    (!draft.name.trim() || bytes(draft.name.trim()) > 120 || !plain(draft.name))
  )
    invalidFields.value.push("account_name");
  if (
    task.value === "create" &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) ||
      bytes(draft.email.trim()) > 254)
  )
    invalidFields.value.push("account_email");
  if (
    passwordTask &&
    (bytes(draft.password) < 16 || bytes(draft.password) > 72)
  )
    invalidFields.value.push("account_password");
  if (passwordTask && draft.password !== draft.confirmation)
    invalidFields.value.push("account_confirmation");
  if (!reason || bytes(reason) > 500 || !plain(reason))
    invalidFields.value.push("account_reason");
  if (!draft.agreed) invalidFields.value.push("account_agreed");
  if (invalidFields.value.length) {
    modalError.value = tr(
      "请核对必填信息。密码须16–72字节且两次一致；原因1–500字节，并勾选确认。",
      "Check required fields. Passwords must match and fit 16–72 bytes; a 1–500 byte reason and confirmation are required.",
    );
    await nextTick();
    document
      .querySelector<HTMLElement>(
        '.management-dialog[open] [aria-invalid="true"]',
      )
      ?.focus();
    return;
  }
  const identity = props.account,
    current = generation,
    kind = task.value,
    id = selected.value?.id;
  let path = "/admin/customer-accounts",
    body: Record<string, unknown>;
  if (kind === "create")
    body = {
      name: draft.name.trim(),
      email: draft.email.trim(),
      role: draft.role,
      password: draft.password,
      reason,
    };
  else {
    path += "/" + encodeURIComponent(id!);
    body = { revision: selected.value!.revision, reason };
    if (kind === "edit")
      Object.assign(body, {
        name: draft.name.trim(),
        role: draft.role,
        disabled: draft.disabled,
      });
    else if (kind === "password") {
      path += "/password";
      body.password = draft.password;
    } else path += "/revoke-sessions";
  }
  saving.value = true;
  try {
    const result = await api<CustomerAccount>(path, "POST", body);
    if (current !== generation || identity !== props.account) return;
    read({ items: [result], has_more: false, limit: 50 });
    if (kind !== "create" && result.revision <= Number(body.revision))
      throw new Error("INVALID_ACCOUNT_REVISION");
    // The write is confirmed; allow the required first-page re-read. Pending
    // writes and unconfirmed failures must retain the refresh/navigation guard.
    saving.value = false;
    clear();
    if (
      id === identity.split(":")[0] &&
      ["password", "revoke"].includes(kind)
    ) {
      page.value = undefined;
      emit("auth-expired");
      return;
    }
    notice.value = tr("账户操作已完成。", "Account operation completed.");
    cursors.value = [""];
    index.value = 0;
    emit("saved");
    await load("", 0);
  } catch (cause) {
    if (current === generation && identity === props.account) {
      modalError.value = message(cause, true);
      blocked.value = true;
      if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) {
        clear();
        page.value = undefined;
        emit("auth-expired");
      }
    }
  } finally {
    delete body.password;
    if (identity === props.account) {
      draft.password = "";
      draft.confirmation = "";
      saving.value = false;
    }
  }
}
watch(
  () => props.account,
  () => {
    generation++;
    page.value = undefined;
    clear();
    saving.value = false;
    notice.value = "";
    index.value = 0;
    cursors.value = [""];
    Object.assign(filters, { q: "", role: "", status: "" });
    applied = { ...filters };
    void load("", 0);
  },
  { flush: "sync" },
);
watch(
  () => props.refreshKey,
  () => load(cursors.value[index.value], index.value),
);
onMounted(() => load("", 0));
onBeforeUnmount(() => {
  generation++;
  clear();
});
</script>
<template>
  <section
    class="management-page"
    data-testid="customer-accounts-page"
    :aria-busy="loading"
  >
    <div class="management-toolbar">
      <p class="management-help">
        {{
          tr(
            "管理账户身份与访问权限；所有变更须填写原因并留存审计。邮箱创建后只读。",
            "Manage identities and access. Every change requires a reason and audit record. Email is read-only after creation.",
          )
        }}
      </p>
      <div class="management-actions">
        <button
          class="button secondary"
          :disabled="preview || loading || saving"
          @click="load(cursors[index], index)"
        >
          {{ tr("刷新账户", "Refresh accounts") }}</button
        ><button
          class="button primary"
          :disabled="preview || loading"
          @click="open('create')"
        >
          {{ tr("创建账户", "Create account") }}
        </button>
      </div>
    </div>
    <p v-if="preview" class="management-help">
      {{
        tr(
          "离线预览不读取或修改账户。",
          "Offline preview does not read or modify accounts.",
        )
      }}
    </p>
    <details class="panel management-filter">
      <summary>{{ tr("筛选账户", "Filter accounts") }}</summary>
      <form class="management-fields" @submit.prevent="search">
        <label class="management-field"
          >{{ tr("姓名或邮箱", "Name or email")
          }}<input v-model="filters.q" name="account_search" /></label
        ><label class="management-field"
          >{{ tr("账户角色", "Account role")
          }}<select v-model="filters.role">
            <option value="">{{ tr("全部角色", "All roles") }}</option>
            <option value="customer">{{ tr("客户", "Customer") }}</option>
            <option value="admin">{{ tr("管理员", "Administrator") }}</option>
          </select></label
        ><label class="management-field"
          >{{ tr("账户状态", "Account status")
          }}<select v-model="filters.status">
            <option value="">{{ tr("全部状态", "All statuses") }}</option>
            <option value="active">{{ tr("已启用", "Active") }}</option>
            <option value="disabled">{{ tr("已停用", "Disabled") }}</option>
          </select></label
        >
        <div class="management-actions">
          <button class="button primary" :disabled="loading || preview">
            {{ tr("查询账户", "Search accounts") }}</button
          ><button
            type="button"
            class="button secondary"
            :disabled="loading || preview"
            @click="reset"
          >
            {{ tr("重置", "Reset") }}
          </button>
        </div>
      </form>
    </details>
    <div v-if="error" role="alert" class="management-error">
      <p>{{ error }}</p>
      <code v-if="requestID">{{ requestID }}</code
      ><button
        class="button secondary"
        :disabled="loading"
        @click="load(cursors[index], index)"
      >
        {{ tr("重试读取", "Retry read") }}
      </button>
    </div>
    <p v-if="notice" role="status" class="management-success">{{ notice }}</p>
    <p v-if="loading" role="status" class="management-help">
      {{
        page
          ? tr(
              "正在刷新，以下为上次读取内容。",
              "Refreshing; previously loaded records remain visible.",
            )
          : tr("正在读取账户…", "Loading accounts…")
      }}
    </p>
    <div v-if="page" class="management-records account-records">
      <article
        v-for="item in page.items"
        :key="item.id"
        class="management-record"
        :data-account-id="item.id"
      >
        <div class="management-record-heading">
          <div>
            <strong>{{ item.name }}</strong>
            <p class="management-help">{{ item.email }}</p>
          </div>
          <span class="badge" :class="item.disabled ? 'gray' : 'green'">{{
            item.disabled ? tr("已停用", "Disabled") : tr("已启用", "Active")
          }}</span>
        </div>
        <dl class="management-kv">
          <div>
            <dt>{{ tr("账户ID", "Account ID") }}</dt>
            <dd>
              <code>{{ item.id }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ tr("角色", "Role") }}</dt>
            <dd>
              {{
                item.role === "admin"
                  ? tr("管理员", "Administrator")
                  : tr("客户", "Customer")
              }}
            </dd>
          </div>
        </dl>
        <div class="management-actions">
          <button
            class="button secondary"
            :disabled="preview || loading"
            @click="open('edit', item)"
          >
            {{ tr("编辑权限", "Edit access") }}</button
          ><button
            class="button secondary"
            :disabled="preview || loading"
            @click="open('password', item)"
          >
            {{ tr("重置密码", "Reset password") }}</button
          ><button
            class="button secondary"
            :disabled="preview || loading"
            @click="open('revoke', item)"
          >
            {{ tr("撤销会话", "Revoke sessions") }}
          </button>
        </div>
      </article>
      <p v-if="!page.items.length && !loading" class="panel management-help">
        {{ tr("没有符合条件的账户。", "No matching accounts.") }}
      </p>
      <div class="management-pagination">
        <button
          class="button secondary"
          :disabled="!index || loading || !!error"
          @click="turn(false)"
        >
          {{ tr("上一页", "Previous") }}</button
        ><span class="management-help">{{
          tr(
            `第${index + 1}页 · 本页${page.items.length}条`,
            `Page ${index + 1} · ${page.items.length} records`,
          )
        }}</span
        ><button
          class="button secondary"
          :disabled="!page.has_more || loading || !!error"
          @click="turn(true)"
        >
          {{ tr("下一页", "Next") }}
        </button>
      </div>
    </div>
    <ManagementDialog
      :open="!!task"
      :busy="saving"
      :title="dialogTitle"
      @close="close"
      @submit="submit"
      ><p v-if="selected" class="management-help">
        {{ selected.name }} · {{ selected.email }}<br /><code>{{
          selected.id
        }}</code>
      </p>
      <p v-if="readingSelected" class="management-help" role="status">
        {{
          tr("正在核对最新账户版本…", "Checking the latest account revision…")
        }}
      </p>
      <div
        v-if="modalError"
        id="account-fields-error"
        class="management-error"
        role="alert"
      >
        {{ modalError }}<code v-if="requestID">{{ requestID }}</code>
      </div>
      <div class="management-fields">
        <label
          v-if="task === 'create' || task === 'edit'"
          class="management-field wide"
          >{{ tr("姓名", "Name")
          }}<input
            v-model="draft.name"
            name="account_name"
            :aria-invalid="invalidFields.includes('account_name')"
            :aria-describedby="
              invalidFields.includes('account_name')
                ? 'account-fields-error'
                : undefined
            "
            required /></label
        ><label v-if="task === 'create'" class="management-field wide"
          >{{ tr("邮箱", "Email")
          }}<input
            v-model="draft.email"
            name="account_email"
            :aria-invalid="invalidFields.includes('account_email')"
            :aria-describedby="
              invalidFields.includes('account_email')
                ? 'account-fields-error'
                : undefined
            "
            type="email"
            autocomplete="off"
            required /></label
        ><label
          v-if="task === 'create' || task === 'edit'"
          class="management-field"
          >{{ tr("角色", "Role")
          }}<select v-model="draft.role" name="account_role" :disabled="self">
            <option value="customer">{{ tr("客户", "Customer") }}</option>
            <option value="admin">{{ tr("管理员", "Administrator") }}</option>
          </select></label
        ><label v-if="task === 'edit'" class="management-field"
          ><input
            v-model="draft.disabled"
            name="account_disabled"
            type="checkbox"
            :disabled="self"
          />{{ tr("停用此账户", "Disable account") }}</label
        >
        <p v-if="self && task === 'edit'" class="management-help wide">
          {{
            tr(
              "不能停用自己或降低自己的管理员权限。",
              "You cannot disable or demote your own account.",
            )
          }}
        </p>
        <template v-if="task === 'create' || task === 'password'"
          ><label class="management-field wide"
            >{{ tr("新密码（16–72字节）", "New password (16–72 bytes)")
            }}<input
              v-model="draft.password"
              name="account_password"
              :aria-invalid="invalidFields.includes('account_password')"
              :aria-describedby="
                invalidFields.includes('account_password')
                  ? 'account-fields-error'
                  : undefined
              "
              type="password"
              autocomplete="new-password"
              required /></label
          ><label class="management-field wide"
            >{{ tr("再次输入新密码", "Confirm new password")
            }}<input
              v-model="draft.confirmation"
              name="account_confirmation"
              :aria-invalid="invalidFields.includes('account_confirmation')"
              :aria-describedby="
                invalidFields.includes('account_confirmation')
                  ? 'account-fields-error'
                  : undefined
              "
              type="password"
              autocomplete="new-password"
              required
          /></label>
          <p class="management-help wide">
            {{
              tr(
                "密码不显示在操作结果或审计中。请通过安全渠道交付。重置将使既有会话失效。",
                "Passwords are not displayed in results or audit. Deliver them securely. Resetting revokes existing sessions.",
              )
            }}
          </p></template
        >
        <p v-if="task === 'revoke'" class="management-help wide">
          {{
            tr(
              "此账户的全部既有会话将失效，需要重新登录；不会改变订单或账务状态。",
              "All existing sessions for this account will expire. Orders and billing states are unchanged.",
            )
          }}
        </p>
        <label class="management-field wide"
          >{{ tr("操作原因（1–500字节）", "Reason (1–500 bytes)")
          }}<textarea
            v-model="draft.reason"
            name="account_reason"
            :aria-invalid="invalidFields.includes('account_reason')"
            :aria-describedby="
              invalidFields.includes('account_reason')
                ? 'account-fields-error'
                : undefined
            "
            required
          /></label
        ><label class="management-field wide"
          ><input
            v-model="draft.agreed"
            name="account_agreed"
            :aria-invalid="invalidFields.includes('account_agreed')"
            :aria-describedby="
              invalidFields.includes('account_agreed')
                ? 'account-fields-error'
                : undefined
            "
            type="checkbox"
          />{{
            tr(
              "我已核对账户及操作影响",
              "I reviewed the account and consequences",
            )
          }}</label
        >
      </div>
      <template #actions
        ><button
          class="button primary"
          :disabled="saving || readingSelected || blocked || !draft.agreed"
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
          @click="close"
        >
          {{ tr("取消", "Cancel") }}
        </button></template
      ></ManagementDialog
    >
  </section>
</template>
