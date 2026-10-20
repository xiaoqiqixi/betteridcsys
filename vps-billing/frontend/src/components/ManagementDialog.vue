<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { X } from "@lucide/vue";
import { tr } from "../lib/i18n";
const props = defineProps<{ open: boolean; busy: boolean; title: string }>();
const emit = defineEmits<{ close: []; submit: [] }>();
const dialog = ref<HTMLDialogElement>();
const titleID = useId();
function close() {
  if (!props.busy) emit("close");
}
function keydown(event: KeyboardEvent) {
  if (event.key !== "Tab" || !dialog.value) return;
  const controls = [
    ...dialog.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.getClientRects().length > 0);
  const first = controls[0],
    last = controls.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dialog.value.focus();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      !dialog.value.contains(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last ||
      !dialog.value.contains(document.activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
}
async function sync() {
  await nextTick();
  if (props.open && !dialog.value?.open) dialog.value?.showModal();
  else if (!props.open && dialog.value?.open) dialog.value.close();
}
watch(() => props.open, sync);
onMounted(sync);
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <dialog
    ref="dialog"
    class="modal management-dialog"
    :aria-labelledby="titleID"
    @keydown="keydown"
    @cancel.prevent="close"
    @click="$event.target === $event.currentTarget && close()"
  >
    <form @submit.prevent="emit('submit')">
      <div class="modal-heading">
        <h2 :id="titleID">{{ title }}</h2>
        <button
          type="button"
          class="icon-button"
          :aria-label="tr('关闭', 'Close')"
          :disabled="busy"
          @click="close"
        >
          <X :size="20" />
        </button>
      </div>
      <div class="modal-body"><slot /></div>
      <div class="modal-actions"><slot name="actions" /></div>
    </form>
  </dialog>
</template>
