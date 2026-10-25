<script lang="ts">
let openPanelCount = 0;
let savedBodyOverflow = "";
</script>
<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  ref,
  useId,
  watch,
  type CSSProperties,
} from "vue";
import { X } from "@lucide/vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    kind?: "drawer" | "modal" | "popover";
    anchor?: HTMLElement | null;
    busy?: boolean;
    closeLabel?: string;
  }>(),
  { kind: "drawer", busy: false, closeLabel: "关闭" },
);
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);
const placement = ref<CSSProperties>({});
const titleId = useId();
const descriptionId = useId();
let token = "";
let trigger: HTMLElement | null = null;
let opened = false;

function position() {
  if (props.kind !== "popover" || !props.open) return;
  const rect =
      props.anchor?.isConnected && props.anchor.getClientRects().length
        ? props.anchor.getBoundingClientRect()
        : null,
    width = Math.min(328, window.innerWidth - 24),
    height = Math.min(
      panel.value?.offsetHeight || 360,
      window.innerHeight - 24,
    );
  const left = Math.max(
    12,
    Math.min(
      rect ? rect.right - width : window.innerWidth - width - 16,
      window.innerWidth - width - 12,
    ),
  );
  const below = rect ? rect.bottom + 8 : 72;
  const top =
    below + height <= window.innerHeight - 12
      ? below
      : Math.max(12, (rect?.top || window.innerHeight) - height - 8);
  placement.value = {
    position: "fixed",
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
  };
}

function close() {
  if (props.busy) return;
  if (history.state?.idcOverlay === token) history.back();
  else emit("close");
}
function keydown(event: KeyboardEvent) {
  if (
    !props.open ||
    [...document.querySelectorAll('[role="dialog"]')].at(-1) !== panel.value
  )
    return;
  if (event.key === "Escape") {
    // Let a select consume the first Escape; the next Escape closes the panel.
    if (
      event.target instanceof Element &&
      event.target.closest('[role="combobox"][aria-expanded="true"]')
    )
      return;
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const targets = [
    ...(panel.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
    ) ?? []),
  ].filter((el) => el.getClientRects().length && !el.closest("[hidden]"));
  if (!targets.length) {
    event.preventDefault();
    panel.value?.focus();
    return;
  }
  const first = targets[0],
    last = targets[targets.length - 1];
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
function popstate() {
  if (props.open && history.state?.idcOverlay !== token) {
    if (props.busy)
      history.pushState(
        { ...history.state, idcOverlay: token },
        "",
        location.href,
      );
    else {
      emit("close");
      nextTick(() => {
        if (props.open && history.state?.idcOverlay !== token)
          history.pushState(
            { ...history.state, idcOverlay: token },
            "",
            location.href,
          );
      });
    }
  }
}
function release() {
  if (!opened) return;
  opened = false;
  window.removeEventListener("keydown", keydown, true);
  window.removeEventListener("popstate", popstate);
  window.removeEventListener("resize", position);
  window.removeEventListener("scroll", position, true);
  if (history.state?.idcOverlay === token) {
    const state = { ...history.state };
    delete state.idcOverlay;
    history.replaceState(state, "", location.href);
  }
  openPanelCount = Math.max(0, openPanelCount - 1);
  if (!openPanelCount) {
    document.body.style.overflow = savedBodyOverflow;
    document.getElementById("workspace-shell")?.removeAttribute("inert");
  }
  nextTick(() => {
    if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus();
  });
}
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      release();
      return;
    }
    // useId is for accessible DOM IDs, not history identity: it repeats after reload.
    // Each opening gets a non-credential nonce so a stale marker cannot swallow the first Back/close.
    token = `panel-${crypto.randomUUID()}`;
    trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!openPanelCount) savedBodyOverflow = document.body.style.overflow;
    openPanelCount++;
    opened = true;
    history.pushState(
      { ...history.state, idcOverlay: token },
      "",
      location.href,
    );
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("popstate", popstate);
    document.body.style.overflow = "hidden";
    document.getElementById("workspace-shell")?.setAttribute("inert", "");
    await nextTick();
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    panel.value?.focus();
  },
  { immediate: true },
);
onBeforeUnmount(() => release());
</script>

<template>
  <Teleport to="body">
    <Transition name="panel">
      <div
        v-if="open"
        class="overlay-backdrop"
        :class="{
          'is-drawer': kind === 'drawer',
          'is-popover': kind === 'popover',
        }"
        @click.self="close"
      >
        <section
          ref="panel"
          :class="
            kind === 'drawer'
              ? 'drawer-panel'
              : kind === 'popover'
                ? 'popover-panel'
                : 'modal-panel'
          "
          :style="kind === 'popover' ? placement : undefined"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="description ? descriptionId : undefined"
          :aria-busy="busy"
          tabindex="-1"
        >
          <header class="panel-header">
            <div>
              <h2 :id="titleId">{{ title }}</h2>
              <p
                v-if="description"
                :id="descriptionId"
                class="panel-description"
              >
                {{ description }}
              </p>
            </div>
            <button
              class="icon-button"
              type="button"
              :disabled="busy"
              :aria-label="closeLabel"
              @click="close"
            >
              <X :size="20" />
            </button>
          </header>
          <div class="panel-body"><slot /></div>
          <footer v-if="$slots.footer" class="panel-footer">
            <slot name="footer" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay-backdrop {
  padding: 24px;
  z-index: 100;
  backdrop-filter: blur(8px);
}
.overlay-backdrop.is-drawer {
  padding: 12px;
  align-items: stretch;
}
.drawer-panel {
  height: auto;
  max-height: calc(100dvh - 24px);
  border: 1px solid var(--border-strong);
  border-radius: 20px;
  max-width: 580px;
}
.modal-panel {
  max-height: calc(100dvh - 48px);
  border-radius: 20px;
  max-width: 520px;
}
.overlay-backdrop.is-popover {
  padding: 0;
  background: transparent;
  backdrop-filter: none;
}
.popover-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: calc(100dvh - 24px);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-popover);
  overflow: visible;
}
.popover-panel .panel-header {
  padding: 16px 20px 12px;
  border: 0;
  background: transparent;
  align-items: center;
}
.popover-panel .panel-header h2 {
  font-size: 17px;
  letter-spacing: 0;
}
.popover-panel .panel-header .icon-button {
  min-height: 36px;
  min-width: 36px;
}
.popover-panel .panel-body {
  padding: 0 20px 20px;
  overflow: auto;
}
.popover-panel .panel-footer {
  padding: 12px 20px;
  background: transparent;
}
.panel-header {
  align-items: flex-start;
  padding: 24px;
  background: var(--bg-surface);
  gap: 16px;
}
.panel-eyebrow {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--accent-primary);
  font-weight: 700;
  margin-bottom: 10px;
}
h2 {
  font-size: 23px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.03em;
  overflow-wrap: anywhere;
}
.panel-description {
  color: var(--text-secondary);
  font-size: 13px;
  margin-top: 9px;
  line-height: 1.7;
}
.panel-body {
  padding: 24px;
  min-height: 0;
  overscroll-behavior: contain;
}
.panel-footer {
  padding: 18px 24px;
  flex-wrap: wrap;
  background: var(--bg-surface);
  flex-shrink: 0;
  padding-bottom: max(18px, env(safe-area-inset-bottom));
}
.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.18s ease;
}
.panel-enter-active section,
.panel-leave-active section {
  transition: transform 0.22s ease;
}
.panel-enter-from,
.panel-leave-to {
  opacity: 0;
}
.panel-enter-from .drawer-panel,
.panel-leave-to .drawer-panel {
  transform: translateX(32px);
}
.panel-enter-from .modal-panel,
.panel-leave-to .modal-panel {
  transform: translateY(12px) scale(0.98);
}
@media (max-width: 600px) {
  .overlay-backdrop {
    padding: 12px;
    align-items: center;
  }
  .overlay-backdrop.is-drawer {
    padding: 8px;
  }
  .drawer-panel {
    max-height: calc(100dvh - 16px);
    border-radius: 18px;
    width: 100%;
  }
  .modal-panel {
    max-height: calc(100dvh - 24px);
  }
  .panel-header,
  .panel-body {
    padding: 20px;
  }
  .panel-footer {
    padding: 16px 20px;
    padding-bottom: max(16px, env(safe-area-inset-bottom));
  }
  h2 {
    font-size: 22px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .panel-enter-active,
  .panel-leave-active,
  .panel-enter-active section,
  .panel-leave-active section {
    transition: none;
  }
}
@media (max-width: 960px) {
  .is-popover .popover-panel {
    position: fixed !important;
    left: 8px !important;
    right: 8px !important;
    top: auto !important;
    bottom: max(8px, env(safe-area-inset-bottom)) !important;
    width: auto !important;
    max-width: 440px;
    margin-inline: auto;
    max-height: calc(100dvh - 32px);
    border-radius: 20px;
  }
  .overlay-backdrop.is-popover {
    background: rgba(0, 0, 0, 0.32);
  }
  .popover-panel .panel-header {
    padding: 18px 20px 12px;
  }
  .popover-panel .panel-body {
    padding-bottom: 24px;
  }
}
</style>
