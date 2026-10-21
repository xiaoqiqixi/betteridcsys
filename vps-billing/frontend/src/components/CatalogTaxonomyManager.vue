<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Check, Plus, Trash2 } from "@lucide/vue";
import OverlayPanel from "./OverlayPanel.vue";
import UiLoading from "./UiLoading.vue";
import UiSpinner from "./UiSpinner.vue";
import UiSelect from "./UiSelect.vue";
import { useWorkspace } from "../composables/useWorkspace";
import {
  type CatalogTaxonomy,
  sortCatalogEntries,
  validCatalogTaxonomy,
} from "../services/catalog-taxonomy";

const props = defineProps<{ open: boolean; locale: "zh-CN" | "en" }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const { read, write, generation: identity } = useWorkspace();
const t = (zh: string, en: string) => (props.locale === "en" ? en : zh);
const draft = ref<CatalogTaxonomy | null>(null);
const active = ref<"types" | "regions">("types");
const reason = ref("");
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const blocked = ref(false);
const uncertain = ref(false);
const discard = ref(false);
let original = "";
let generation = 0;
const dirty = computed(
  () => !!draft.value && JSON.stringify(draft.value) !== original,
);
const locked = computed(() => saving.value || blocked.value || uncertain.value);
const typeOptions = computed(() =>
  sortCatalogEntries(draft.value?.types || []).map((item) => ({
    value: item.id,
    label: item.name || t("未命名类型", "Unnamed type"),
  })),
);
function safeError(e: unknown) {
  const code = (e as { code?: string }).code;
  if (code === "TAXONOMY_IN_USE")
    return t(
      "分类仍被商品引用。请先调整商品归属，或下架相关商品后再停用；已被引用的分类不能直接移除。",
      "Products still reference this category. Reassign them, or unpublish them before disabling it. Referenced categories cannot be removed.",
    );
  if (code === "TAXONOMY_CONFLICT")
    return t(
      "分类已被其他操作更新。请丢弃草稿并读取最新分类后重新编辑。",
      "Categories changed elsewhere. Discard this draft and reload before editing again.",
    );
  if (code === "INVALID_TAXONOMY" || code === "INVALID_BODY")
    return t(
      "请检查名称、所属类型和排序；分类名称不可为空，排序范围为 0–1000000。",
      "Check names, parent types and sort orders. Names are required; sort orders range from 0 to 1000000.",
    );
  if (code === "FORBIDDEN" || code === "AUTH_REQUIRED")
    return t(
      "当前账户没有分类管理权限，请重新确认登录身份。",
      "This account cannot manage categories. Check your sign-in.",
    );
  return t(
    "无法读取或保存分类，请稍后重新核对。",
    "Categories could not be loaded or saved. Check again later.",
  );
}
async function load() {
  const request = ++generation;
  draft.value = null;
  reason.value = "";
  error.value = "";
  blocked.value = uncertain.value = discard.value = false;
  loading.value = true;
  try {
    const result = await read<unknown>("/admin/catalog-taxonomy");
    if (request !== generation || !props.open) return;
    if (!validCatalogTaxonomy(result)) throw { code: "INVALID_RESPONSE" };
    draft.value = structuredClone(result);
    original = JSON.stringify(draft.value);
  } catch (e) {
    if (request === generation) error.value = safeError(e);
  } finally {
    if (request === generation) loading.value = false;
  }
}
function close() {
  if (saving.value) return;
  if (!uncertain.value && (dirty.value || reason.value.trim()))
    discard.value = true;
  else emit("close");
}
function add() {
  if (!draft.value || locked.value) return;
  if (active.value === "types") {
    if (draft.value.types.length >= 128) return;
    draft.value.types.push({
      id: `type-${crypto.randomUUID()}`,
      name: "",
      sort_order: draft.value.types.length * 10,
      enabled: true,
    });
  } else {
    if (draft.value.regions.length >= 512 || !draft.value.types.length) return;
    draft.value.regions.push({
      id: `region-${crypto.randomUUID()}`,
      type_id: draft.value.types[0]!.id,
      name: "",
      sort_order: draft.value.regions.length * 10,
      enabled: true,
    });
  }
}
function remove(id: string) {
  if (!draft.value || locked.value) return;
  if (active.value === "types") {
    if (draft.value.regions.some((r) => r.type_id === id)) {
      error.value = t(
        "该类型下还有地区，请先调整地区归属或停用该类型。",
        "This type still has regions. Reassign them or disable the type instead.",
      );
      return;
    }
    draft.value.types = draft.value.types.filter((row) => row.id !== id);
  } else
    draft.value.regions = draft.value.regions.filter((row) => row.id !== id);
}
function canonical(value: CatalogTaxonomy) {
  return JSON.stringify({
    types: sortCatalogEntries(value.types),
    regions: sortCatalogEntries(value.regions),
  });
}
async function save() {
  if (!draft.value || locked.value || loading.value) return;
  const payload: CatalogTaxonomy = {
    revision: draft.value.revision,
    types: draft.value.types.map((row) => ({ ...row, name: row.name.trim() })),
    regions: draft.value.regions.map((row) => ({ ...row })),
  };
  if (
    !validCatalogTaxonomy(payload) ||
    !reason.value.trim() ||
    new TextEncoder().encode(reason.value.trim()).length > 500
  ) {
    error.value = t(
      "请完整填写分类名称、所属类型、有效排序及操作原因（最多 500 字节）。",
      "Complete category names, parent types, valid sort orders and a change reason (up to 500 UTF-8 bytes).",
    );
    return;
  }
  const request = generation;
  const account = identity.value;
  saving.value = true;
  error.value = "";
  try {
    const result = await write<unknown>("/admin/catalog-taxonomy", {
      ...payload,
      reason: reason.value.trim(),
    });
    if (request !== generation || account !== identity.value || !props.open)
      return;
    if (
      !validCatalogTaxonomy(result) ||
      result.revision !== payload.revision + 1 ||
      canonical(result) !== canonical(payload)
    )
      throw { uncertain: true };
    original = JSON.stringify(draft.value);
    reason.value = "";
    emit("changed");
    emit("close");
  } catch (e) {
    if (request !== generation || account !== identity.value) return;
    const failure = e as {
      status?: number;
      code?: string;
      uncertain?: boolean;
    };
    uncertain.value =
      !!failure.uncertain || !failure.status || failure.status >= 500;
    blocked.value = failure.code === "TAXONOMY_CONFLICT";
    error.value = uncertain.value
      ? t(
          "保存结果尚未确认，已停止重复提交。请关闭后重新打开分类，先核对实际结果。",
          "The save outcome is uncertain. Repeat submissions are blocked. Close and reopen categories to check the actual result first.",
        )
      : safeError(e);
  } finally {
    if (request === generation) saving.value = false;
  }
}
watch(
  () => [props.open, identity.value],
  () => {
    generation++;
    draft.value = null;
    saving.value = loading.value = discard.value = false;
    if (props.open) void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <OverlayPanel
    :open="open"
    :busy="saving"
    :title="t('类型与地区', 'Types and regions')"
    :description="
      t(
        '先整理商品归属，再添加套餐。',
        'Organize your catalog before adding plans.',
      )
    "
    @close="close"
  >
    <div class="taxonomy-editor">
      <div v-if="discard" class="taxonomy-alert" role="alert">
        <strong>{{
          t("放弃未保存的分类更改？", "Discard unsaved category changes?")
        }}</strong>
        <div class="taxonomy-actions">
          <button class="btn btn-secondary" @click="discard = false">
            {{ t("继续编辑", "Keep editing") }}</button
          ><button class="btn btn-danger" @click="emit('close')">
            {{ t("放弃更改", "Discard changes") }}
          </button>
        </div>
      </div>
      <div
        class="taxonomy-tabs"
        :aria-label="t('分类管理', 'Category management')"
      >
        <button
          class="btn"
          :class="active === 'types' ? 'btn-admin' : 'btn-secondary'"
          :aria-pressed="active === 'types'"
          @click="active = 'types'"
        >
          {{ t("服务器类型", "Server types")
          }}<span v-if="draft">{{ draft.types.length }}</span>
        </button>
        <button
          class="btn"
          :class="active === 'regions' ? 'btn-admin' : 'btn-secondary'"
          :aria-pressed="active === 'regions'"
          @click="active = 'regions'"
        >
          {{ t("地区", "Regions")
          }}<span v-if="draft">{{ draft.regions.length }}</span>
        </button>
      </div>
      <UiLoading
        v-if="loading"
        layout="list"
        :label="t('正在读取分类…', 'Loading categories…')"
      />
      <template v-else-if="draft">
        <p class="taxonomy-help">
          {{
            t(
              "数字越小越靠前。停用后不再供客户选择；正在上架的商品须先调整归属或下架。",
              "Lower sort orders appear first. Disabled categories are hidden from buyers; reassign or unpublish their published products first.",
            )
          }}
        </p>
        <div v-if="active === 'types'" class="taxonomy-list">
          <fieldset
            v-for="(row, index) in draft.types"
            :key="row.id"
            class="taxonomy-row"
            :disabled="locked"
          >
            <legend>{{ t(`类型 ${index + 1}`, `Type ${index + 1}`) }}</legend>
            <label class="form-group taxonomy-name"
              ><span class="form-label">{{ t("类型名称", "Type name") }}</span
              ><input
                v-model="row.name"
                class="form-input"
                :aria-label="
                  t(`类型 ${index + 1} 名称`, `Type ${index + 1} name`)
                "
                :placeholder="
                  t('例如：标准云服务器', 'e.g. Standard cloud server')
                "
            /></label>
            <label class="form-group taxonomy-sort"
              ><span class="form-label">{{ t("排序", "Sort order") }}</span
              ><input
                v-model.number="row.sort_order"
                class="form-input"
                inputmode="numeric"
                :aria-label="
                  t(`类型 ${index + 1} 排序`, `Type ${index + 1} sort order`)
                "
            /></label>
            <label class="taxonomy-enabled"
              ><input v-model="row.enabled" type="checkbox" />{{
                t("启用", "Enabled")
              }}</label
            >
            <button
              class="btn btn-ghost taxonomy-remove"
              :aria-label="
                t(
                  `移除类型 ${row.name || index + 1}`,
                  `Remove type ${row.name || index + 1}`,
                )
              "
              @click="remove(row.id)"
            >
              <Trash2 :size="16" />
            </button>
          </fieldset>
          <p v-if="!draft.types.length" class="taxonomy-help">
            {{
              t(
                "先添加一种服务器类型，再为它添加地区。",
                "Add a server type, then add its regions.",
              )
            }}
          </p>
        </div>
        <div v-else class="taxonomy-list">
          <fieldset
            v-for="(row, index) in draft.regions"
            :key="row.id"
            class="taxonomy-row"
            :disabled="locked"
          >
            <legend>{{ t(`地区 ${index + 1}`, `Region ${index + 1}`) }}</legend>
            <label class="form-group taxonomy-name"
              ><span class="form-label">{{ t("地区名称", "Region name") }}</span
              ><input
                v-model="row.name"
                class="form-input"
                :aria-label="
                  t(`地区 ${index + 1} 名称`, `Region ${index + 1} name`)
                "
                :placeholder="t('例如：中国香港', 'e.g. Hong Kong')"
            /></label>
            <label class="form-group taxonomy-parent"
              ><span class="form-label">{{ t("所属类型", "Server type") }}</span
              ><UiSelect
                v-model="row.type_id"
                :options="typeOptions"
                :disabled="locked"
                :aria-label="
                  t(
                    `地区 ${index + 1} 所属类型`,
                    `Region ${index + 1} server type`,
                  )
                "
            /></label>
            <label class="form-group taxonomy-sort"
              ><span class="form-label">{{ t("排序", "Sort order") }}</span
              ><input
                v-model.number="row.sort_order"
                class="form-input"
                inputmode="numeric"
                :aria-label="
                  t(`地区 ${index + 1} 排序`, `Region ${index + 1} sort order`)
                "
            /></label>
            <label class="taxonomy-enabled"
              ><input v-model="row.enabled" type="checkbox" />{{
                t("启用", "Enabled")
              }}</label
            >
            <button
              class="btn btn-ghost taxonomy-remove"
              :aria-label="
                t(
                  `移除地区 ${row.name || index + 1}`,
                  `Remove region ${row.name || index + 1}`,
                )
              "
              @click="remove(row.id)"
            >
              <Trash2 :size="16" />
            </button>
          </fieldset>
          <p v-if="!draft.regions.length" class="taxonomy-help">
            {{
              t(
                "为服务器类型添加可选地区。",
                "Add regions for your server types.",
              )
            }}
          </p>
        </div>
        <button
          class="btn btn-secondary taxonomy-add"
          :disabled="
            locked ||
            (active === 'regions' && !draft.types.length) ||
            (active === 'types'
              ? draft.types.length >= 128
              : draft.regions.length >= 512)
          "
          @click="add"
        >
          <Plus :size="16" />{{
            active === "types"
              ? t("新增类型", "Add type")
              : t("新增地区", "Add region")
          }}
        </button>
        <label class="form-group taxonomy-reason"
          ><span class="form-label">{{ t("操作原因", "Change reason") }}</span
          ><textarea
            v-model="reason"
            class="form-textarea"
            rows="2"
            :disabled="locked"
            :placeholder="
              t('说明本次分类调整的原因', 'Explain this category change')
            "
          />
        </label>
      </template>
      <p v-if="error" class="taxonomy-error" role="alert">{{ error }}</p>
      <button v-if="!loading && !draft" class="btn btn-secondary" @click="load">
        {{ t("重新读取", "Try again") }}
      </button>
      <button v-if="blocked" class="btn btn-secondary" @click="load">
        {{ t("丢弃草稿并读取最新分类", "Discard draft and reload") }}
      </button>
    </div>
    <template #footer>
      <button class="btn btn-secondary" :disabled="saving" @click="close">
        {{ t("取消", "Cancel") }}
      </button>
      <button
        class="btn btn-admin"
        :disabled="loading || !draft || locked || !dirty"
        :aria-busy="saving"
        @click="save"
      >
        <UiSpinner v-if="saving" :size="15" /><Check v-else :size="15" />{{
          saving ? t("保存中…", "Saving…") : t("保存分类", "Save categories")
        }}
      </button>
    </template>
  </OverlayPanel>
</template>

<style scoped>
.taxonomy-editor {
  min-width: 0;
}
.taxonomy-tabs,
.taxonomy-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.taxonomy-tabs {
  margin-bottom: 20px;
}
.taxonomy-tabs span {
  margin-left: 6px;
  font-size: 12px;
}
.taxonomy-help {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 18px;
}
.taxonomy-list {
  display: grid;
  gap: 18px;
}
.taxonomy-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 100px;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}
.taxonomy-row legend {
  color: var(--text-secondary);
  padding: 0 6px;
  font-size: 12px;
}
.taxonomy-name,
.taxonomy-parent {
  grid-column: 1 / -1;
}
.taxonomy-sort {
  min-width: 0;
}
.taxonomy-row .form-group {
  margin: 0;
}
.taxonomy-enabled {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 14px;
}
.taxonomy-enabled input {
  accent-color: var(--accent-admin);
  width: 18px;
  height: 18px;
}
.taxonomy-remove {
  grid-column: 2;
  justify-self: end;
  min-width: 44px;
  min-height: 44px;
}
.taxonomy-add {
  margin-top: 18px;
}
.taxonomy-reason {
  margin-top: 28px;
}
.taxonomy-error {
  color: var(--status-danger);
  line-height: 1.7;
  overflow-wrap: anywhere;
  margin-top: 18px;
}
.taxonomy-alert {
  background: var(--status-warning-bg);
  color: var(--status-warning);
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 20px;
}
.taxonomy-alert strong {
  display: block;
  margin-bottom: 12px;
}
</style>
