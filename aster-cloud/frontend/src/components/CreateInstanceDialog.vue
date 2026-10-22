<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { RouterLink } from "vue-router";
import { useConsole } from "../context";
import { useQuery } from "../composables/query";
import { useMutation } from "../composables/mutation";
import { operationResponse, record, validResources } from "../api/client";
import type { Preset } from "../api/types";
import { sizeMiB } from "../format";
import UiOverlay from "./UiOverlay.vue";
import UiSelect from "./UiSelect.vue";
import UiButton from "./UiButton.vue";
import StateBlock from "./StateBlock.vue";
import InlineError from "./InlineError.vue";
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; accepted: [] }>();
const {
  prefs: { tr },
  notify,
} = useConsole();
const presets = useQuery(
  () => "/presets",
  (x): x is { items: Preset[] } =>
    record(x) &&
    Array.isArray(x.items) &&
    x.items.every(
      (v) =>
        record(v) &&
        typeof v.id === "string" &&
        typeof v.node_id === "string" &&
        validResources(v.resources),
    ),
);
const mutation = useMutation();
const form = reactive({ hostname: "", owner_ref: "", preset_id: "" });
let original = "";
const accepted = reactive({ id: "", instance: "" });
const options = computed(() =>
  (presets.data.value?.items || []).map((p) => ({
    value: p.id,
    label: `${p.id} · ${p.node_id} · ${p.resources.cpu_cores} vCPU / ${sizeMiB(p.resources.memory_mib)} / ${p.resources.system_disk_gib} GiB`,
  })),
);
const valid = computed(
  () =>
    /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,61}[a-zA-Z0-9])?$/.test(form.hostname) &&
    /^[a-f0-9]{32}$/.test(form.owner_ref) &&
    options.value.some((v) => v.value === form.preset_id),
);
const dirty = computed(() => original !== JSON.stringify(form));
watch(
  () => props.open,
  (open) => {
    if (open) {
      Object.assign(form, { hostname: "", owner_ref: "", preset_id: "" });
      original = JSON.stringify(form);
      accepted.id = "";
      accepted.instance = "";
      mutation.clearMessage();
    }
  },
  { immediate: true },
);
async function submit() {
  if (!valid.value || mutation.pendingKey.value) return;
  const result = await mutation.execute(
    "POST",
    "/instances",
    { ...form },
    operationResponse,
    { expectedStatus: 202, bindOperation: { action: "create" } },
  );
  if (result) {
    accepted.id = result.operation.id;
    accepted.instance = result.operation.instance_id;
    original = JSON.stringify(form);
    notify(
      tr(
        "创建任务已受理，请前往任务页面核对并派发。",
        "Creation accepted. Review and dispatch the task in Tasks.",
      ),
    );
    emit("accepted");
  }
}
</script>
<template>
  <UiOverlay
    :open="open"
    :title="tr('创建实例', 'Create instance')"
    :busy="mutation.busy.value"
    :dirty="dirty && !accepted.id && !mutation.pendingKey.value"
    :close-label="tr('关闭', 'Close')"
    :discard-label="tr('放弃未保存的更改', 'Discard unsaved changes')"
    :continue-label="tr('继续编辑', 'Continue editing')"
    @close="emit('close')"
    ><div v-if="accepted.id" class="callout" role="status">
      <strong>{{ tr("创建任务已受理", "Creation accepted") }}</strong>
      <p>
        {{
          tr(
            "实例尚未开通，核对并派发任务后开始处理。",
            "The instance has not been provisioned yet. Review and dispatch the task to begin.",
          )
        }}
      </p>
      <code class="break-anywhere">{{ accepted.id }}</code>
      <RouterLink
        class="task-link"
        :replace="true"
        :to="`/operations/${accepted.id}`"
        >{{ tr("查看原任务", "View original task") }}</RouterLink
      >
    </div>
    <StateBlock
      v-else
      :loading="presets.loading.value"
      :error="presets.error.value"
      :empty="!options.length"
      :title="tr('暂无可用规格', 'No approved configurations')"
      :description="
        tr(
          '请由管理员配置节点与预设规格后，再创建实例。',
          'Ask an administrator to configure nodes and approved presets before creating an instance.',
        )
      "
      @reload="presets.reload"
      ><form
        id="create-instance"
        class="creation-form"
        @submit.prevent="submit"
      >
        <label class="field"
          >{{ tr("预设规格", "Approved configuration")
          }}<UiSelect
            v-model="form.preset_id"
            :options="options"
            :label="tr('选择预设规格', 'Choose approved configuration')"
            :placeholder="tr('请选择规格', 'Choose a configuration')"
            :disabled="
              mutation.busy.value || !!mutation.pendingKey.value
            " /></label
        ><label class="field"
          >{{ tr("主机名", "Hostname")
          }}<input
            v-model="form.hostname"
            required
            maxlength="63"
            autocomplete="off"
            :disabled="mutation.busy.value || !!mutation.pendingKey.value"
            placeholder="server-name"
          /><span class="field-note">{{
            tr(
              "1–63 个英文字母、数字、短横线或点。",
              "1–63 letters, digits, hyphens or dots.",
            )
          }}</span></label
        ><label class="field"
          >{{ tr("归属客户 ID", "Owner customer ID")
          }}<input
            v-model="form.owner_ref"
            required
            maxlength="32"
            autocomplete="off"
            :disabled="mutation.busy.value || !!mutation.pendingKey.value"
          /><span class="field-note">{{
            tr(
              "32 位小写十六进制客户引用。",
              "A 32-character lowercase hexadecimal customer reference.",
            )
          }}</span></label
        ><InlineError
          :error="mutation.error.value"
          :pending-key="mutation.pendingKey.value"
        /><RouterLink
          v-if="mutation.error.value === 'unknown' && mutation.pendingKey.value"
          class="task-link"
          :replace="true"
          :to="`/operations/${mutation.pendingKey.value}`"
          >{{ tr("查看原任务", "View original task") }}</RouterLink
        >
      </form></StateBlock
    ><template #footer="{ close }"
      ><UiButton :disabled="mutation.busy.value" @click="close">{{
        accepted.id ? tr("完成", "Done") : tr("取消", "Cancel")
      }}</UiButton
      ><UiButton
        v-if="!accepted.id && options.length"
        type="submit"
        form="create-instance"
        variant="primary"
        :busy="mutation.busy.value"
        :disabled="!valid || !!mutation.pendingKey.value"
        >{{ tr("创建任务", "Create task") }}</UiButton
      ></template
    ></UiOverlay
  >
</template>
<style scoped>
.creation-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.callout p {
  margin: 12px 0;
}
.task-link {
  display: flex;
  align-items: center;
  min-height: 44px;
  overflow-wrap: anywhere;
}
</style>
