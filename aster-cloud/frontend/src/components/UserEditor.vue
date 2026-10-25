<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { Role, User } from "../api/types";
import { useConsole } from "../context";
import { useMutation } from "../composables/mutation";
import { userResponse } from "../api/client";
import { permissionNames } from "../format";
import UiOverlay from "./UiOverlay.vue";
import UiSelect from "./UiSelect.vue";
import UiButton from "./UiButton.vue";
import InlineError from "./InlineError.vue";
const props = defineProps<{
  open: boolean;
  user: User | null;
  roles: Role[];
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
const {
  prefs: { tr },
  notify,
  session,
} = useConsole();
const mutation = useMutation();
const form = reactive({
  name: "",
  email: "",
  password: "",
  role: "viewer",
  enabled: true,
  permissions: [] as string[],
});
let original = "";
const roleNames: Record<string, [string, string]> = {
  admin: ["管理员", "Administrator"],
  operator: ["操作员", "Operator"],
  viewer: ["只读成员", "Viewer"],
  custom: ["自定义", "Custom"],
};
const options = computed(() =>
  props.roles
    .filter(
      (r) =>
        session.user.value?.role === "admin" ||
        (r.id !== "admin" && r.permissions.every((p) => session.can(p))),
    )
    .map((r) => ({
      value: r.id,
      label: roleNames[r.id] ? tr(...roleNames[r.id]!) : r.name,
    })),
);
const grants = computed(() =>
  [...new Set(props.roles.flatMap((r) => r.permissions))]
    .filter((p) => session.can(p))
    .sort(),
);
const dirty = computed(() => original !== JSON.stringify(form));
const valid = computed(
  () =>
    form.name.length > 0 &&
    form.name.trim() === form.name &&
    [...form.name].length <= 100 &&
    /^[^\s@]+@[^\s@]+$/.test(form.email) &&
    new TextEncoder().encode(form.email).length <= 254 &&
    options.value.some((r) => r.value === form.role) &&
    (props.user
      ? !form.password || new TextEncoder().encode(form.password).length >= 12
      : new TextEncoder().encode(form.password).length >= 12),
);
watch(
  () => props.open,
  (open) => {
    if (open) {
      Object.assign(form, {
        name: props.user?.name || "",
        email: props.user?.email || "",
        password: "",
        role: props.user?.role || "viewer",
        enabled: props.user?.enabled ?? true,
        permissions:
          props.user?.role === "custom" ? [...props.user.permissions] : [],
      });
      original = JSON.stringify(form);
      mutation.clearMessage();
    } else form.password = "";
  },
  { immediate: true },
);
function toggle(value: string) {
  form.permissions = form.permissions.includes(value)
    ? form.permissions.filter((p) => p !== value)
    : [...form.permissions, value].sort();
}
async function submit() {
  if (!valid.value || mutation.pendingKey.value) return;
  const body = {
    name: form.name,
    email: form.email,
    role: form.role,
    ...(props.user ? { enabled: form.enabled } : {}),
    ...(form.password ? { password: form.password } : {}),
    ...(form.role === "custom"
      ? { permissions: [...form.permissions].sort() }
      : {}),
  };
  const result = await mutation.execute(
    props.user ? "PATCH" : "POST",
    props.user ? `/users/${encodeURIComponent(props.user.id)}` : "/users",
    body,
    userResponse,
    { expectedStatus: props.user ? 200 : 201 },
  );
  if (result) {
    form.password = "";
    original = JSON.stringify(form);
    notify(
      props.user
        ? tr("成员已更新。", "Member updated.")
        : tr("成员已创建。", "Member created."),
    );
    emit("saved");
    emit("close");
  }
}
</script>
<template>
  <UiOverlay
    :open="open"
    :title="user ? tr('编辑成员', 'Edit member') : tr('新增成员', 'Add member')"
    :busy="mutation.busy.value"
    :dirty="dirty && !mutation.pendingKey.value"
    drawer
    :close-label="tr('关闭', 'Close')"
    :discard-label="tr('放弃未保存的更改', 'Discard unsaved changes')"
    :continue-label="tr('继续编辑', 'Continue editing')"
    @close="emit('close')"
    ><form id="user-editor" class="user-form" @submit.prevent="submit">
      <fieldset :disabled="mutation.busy.value || !!mutation.pendingKey.value">
        <label class="field"
          >{{ tr("姓名", "Name")
          }}<input
            v-model="form.name"
            required
            maxlength="100"
            autocomplete="name" /></label
        ><label class="field"
          >{{ tr("邮箱", "Email")
          }}<input
            v-model="form.email"
            type="email"
            required
            maxlength="254"
            autocomplete="off" /></label
        ><label class="field"
          >{{
            user
              ? tr(
                  "新密码（留空则不更改）",
                  "New password (leave blank to keep)",
                )
              : tr("初始密码", "Initial password")
          }}<input
            v-model="form.password"
            type="password"
            :required="!user"
            minlength="12"
            maxlength="1024"
            autocomplete="new-password"
          /><span class="field-note">{{
            tr(
              "至少 12 字节，不会保存到浏览器。",
              "At least 12 bytes. Never saved in the browser.",
            )
          }}</span></label
        ><label class="field"
          >{{ tr("角色", "Role")
          }}<UiSelect
            v-model="form.role"
            :options="options"
            :label="tr('选择角色', 'Choose role')"
            :disabled="mutation.busy.value || !!mutation.pendingKey.value"
        /></label>
        <div v-if="form.role === 'custom'" class="permission-group">
          <h3>{{ tr("授予权限", "Granted permissions") }}</h3>
          <label v-for="grant in grants" :key="grant" class="check-row"
            ><input
              type="checkbox"
              :checked="form.permissions.includes(grant)"
              @change="toggle(grant)"
            /><span>{{
              permissionNames[grant] ? tr(...permissionNames[grant]!) : grant
            }}</span></label
          >
        </div>
        <label v-if="user" class="check-row user-enabled"
          ><input v-model="form.enabled" type="checkbox" /><span>{{
            tr("允许此成员登录", "Allow this member to sign in")
          }}</span></label
        >
      </fieldset>
      <InlineError
        :error="mutation.error.value"
        :pending-key="mutation.pendingKey.value"
      />
    </form>
    <template #footer="{ close }"
      ><UiButton :disabled="mutation.busy.value" @click="close">{{
        tr("取消", "Cancel")
      }}</UiButton
      ><UiButton
        type="submit"
        form="user-editor"
        variant="primary"
        :busy="mutation.busy.value"
        :disabled="!valid || !dirty || !!mutation.pendingKey.value"
        >{{
          user
            ? tr("保存更改", "Save changes")
            : tr("创建成员", "Create member")
        }}</UiButton
      ></template
    ></UiOverlay
  >
</template>
<style scoped>
.user-form fieldset {
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.permission-group {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--subtle);
}
.permission-group h3 {
  font-size: 13px;
  margin: 0 0 12px;
}
.check-row {
  display: flex;
  gap: 10px;
  align-items: center;
  min-height: 44px;
  font-size: 13px;
  color: var(--text);
  overflow-wrap: anywhere;
}
.check-row input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
  flex-shrink: 0;
}
.user-enabled {
  margin-top: 4px;
}
</style>
