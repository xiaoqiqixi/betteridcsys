<script setup lang="ts">
import {
  computed,
  Fragment,
  isVNode,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  shallowRef,
  useAttrs,
  useId,
  useSlots,
  watch,
  type CSSProperties,
  type ComponentPublicInstance,
  type VNode,
} from "vue";

/** A single-value, select-only combobox. Slot <option> nodes are a declaration,
 * not a hidden native select; selection keeps the original scalar value. */
type Scalar = string | number | boolean | null;
interface Choice {
  value: Scalar;
  label: string;
  disabled?: boolean;
  group?: string;
}
const props = withDefaults(
  defineProps<{
    modelValue?: Scalar;
    value?: Scalar;
    options?: readonly Choice[];
    disabled?: boolean;
    readonly?: boolean;
    required?: boolean;
    id?: string;
    name?: string;
    placeholder?: string;
    emptyLabel?: string;
    modelModifiers?: { number?: boolean; trim?: boolean };
  }>(),
  {
    disabled: false,
    readonly: false,
    required: false,
    placeholder: "—",
    emptyLabel: "—",
  },
);
const emit = defineEmits<{
  "update:modelValue": [value: Scalar];
  change: [event: Event];
  blur: [event: FocusEvent];
  focus: [event: FocusEvent];
}>();
defineOptions({ inheritAttrs: false });
const attrs = useAttrs();
const slots = useSlots();
const generatedId = useId();
const triggerId = computed(() => props.id || `ui-select-${generatedId}`);
const listId = `ui-options-${generatedId}`;
const root = shallowRef<HTMLElement | null>(null);
const trigger = shallowRef<HTMLButtonElement | null>(null);
const listbox = shallowRef<HTMLElement | null>(null);
const expanded = shallowRef(false);
const activeIndex = shallowRef(-1);
const target = shallowRef<HTMLElement | null>(null);
const placement = shallowRef<CSSProperties>({});
const current = computed(() =>
  props.modelValue !== undefined ? props.modelValue : props.value,
);
let search = "";
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let repositionFrame = 0;

function textOf(children: unknown): string {
  if (typeof children === "string" || typeof children === "number")
    return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (isVNode(children)) return textOf(children.children);
  return "";
}
function slotChoices(
  nodes: VNode[],
  inheritedDisabled = false,
  group?: string,
): Choice[] {
  return nodes.flatMap((node) => {
    if (!isVNode(node)) return [];
    if (node.type === Fragment || node.type === "template")
      return slotChoices(
        Array.isArray(node.children) ? (node.children as VNode[]) : [],
        inheritedDisabled,
        group,
      );
    if (node.type === "optgroup")
      return slotChoices(
        Array.isArray(node.children) ? (node.children as VNode[]) : [],
        inheritedDisabled ||
          node.props?.disabled === "" ||
          node.props?.disabled === true,
        String(node.props?.label ?? ""),
      );
    if (node.type !== "option") return [];
    const label = textOf(node.children).trim();
    const disabled =
      inheritedDisabled ||
      node.props?.disabled === "" ||
      node.props?.disabled === true;
    return [
      {
        value:
          node.props && "value" in node.props
            ? (node.props.value as Scalar)
            : label,
        label,
        disabled,
        group,
      },
    ];
  });
}
// Called by the template, so dynamic slot expressions are tracked during render.
// Caching slots in a setup computed would miss parent v-if/v-for slot updates.
function choices(): Choice[] {
  return props.options
    ? props.options.map((option) => ({ ...option }))
    : slotChoices(slots.default?.() ?? []);
}
function selectedIndex(items: Choice[]): number {
  const exact = items.findIndex((item) => Object.is(item.value, current.value));
  return exact >= 0
    ? exact
    : items.findIndex(
        (item) =>
          item.value != null &&
          current.value != null &&
          String(item.value) === String(current.value),
      );
}
function selectedLabel(items: Choice[]): string {
  return items[selectedIndex(items)]?.label ?? props.placeholder;
}
function blocked(): boolean {
  return (
    props.disabled || props.readonly || !!trigger.value?.matches(":disabled")
  );
}
function setTrigger(element: Element | ComponentPublicInstance | null) {
  trigger.value = element instanceof HTMLButtonElement ? element : null;
}
function setListbox(element: Element | ComponentPublicInstance | null) {
  listbox.value = element instanceof HTMLElement ? element : null;
}
function selectedId(): string | undefined {
  return expanded.value && activeIndex.value >= 0
    ? `${listId}-${activeIndex.value}`
    : undefined;
}
function scrollActive() {
  nextTick(() => {
    const option = listbox.value?.querySelector<HTMLElement>(
      `[data-index="${activeIndex.value}"]`,
    );
    const box = listbox.value;
    if (!box || !option) return;
    // Scroll only the list, never a page or the surrounding modal.
    if (option.offsetTop < box.scrollTop) box.scrollTop = option.offsetTop;
    else if (
      option.offsetTop + option.offsetHeight >
      box.scrollTop + box.clientHeight
    )
      box.scrollTop = option.offsetTop + option.offsetHeight - box.clientHeight;
  });
}
function position() {
  const button = trigger.value;
  if (!button || !expanded.value) return;
  const rect = button.getBoundingClientRect();
  const viewport = window.visualViewport;
  const leftBound = (viewport?.offsetLeft ?? 0) + 12;
  const topBound = (viewport?.offsetTop ?? 0) + 12;
  const rightBound = leftBound + (viewport?.width ?? window.innerWidth) - 24;
  const bottomBound = topBound + (viewport?.height ?? window.innerHeight) - 24;
  const below = bottomBound - rect.bottom - 6;
  const above = rect.top - topBound - 6;
  const opensUp = below < 180 && above > below;
  const maxHeight = Math.max(44, Math.min(300, opensUp ? above : below));
  const width = Math.min(Math.max(rect.width, 156), rightBound - leftBound);
  placement.value = {
    position: "fixed",
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    left: `${Math.max(leftBound, Math.min(rect.left, rightBound - width))}px`,
    top: opensUp ? undefined : `${rect.bottom + 6}px`,
    bottom: opensUp ? `${window.innerHeight - rect.top + 6}px` : undefined,
  };
}
function reposition() {
  cancelAnimationFrame(repositionFrame);
  repositionFrame = requestAnimationFrame(position);
}
function open(items: Choice[], direction: 1 | -1 = 1) {
  if (blocked()) return;
  target.value =
    trigger.value?.closest<HTMLElement>('[role="dialog"]') ?? document.body;
  const selected = selectedIndex(items);
  const enabled = items
    .map((item, i) => (item.disabled ? -1 : i))
    .filter((i) => i >= 0);
  activeIndex.value =
    selected >= 0 && !items[selected]?.disabled
      ? selected
      : ((direction === 1 ? enabled[0] : enabled.at(-1)) ?? -1);
  expanded.value = true;
  nextTick(() => {
    position();
    scrollActive();
  });
}
function close() {
  expanded.value = false;
  search = "";
  if (searchTimer) clearTimeout(searchTimer);
}
function toggle(items: Choice[]) {
  if (expanded.value) close();
  else open(items);
}
function choose(item: Choice) {
  if (blocked() || item.disabled) return;
  let value = item.value;
  if (
    props.modelModifiers?.number &&
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    const number = Number(value);
    if (!Number.isNaN(number)) value = number;
  }
  if (props.modelModifiers?.trim && typeof value === "string")
    value = value.trim();
  const changed = !Object.is(value, current.value);
  close();
  if (changed) {
    emit("update:modelValue", value);
    // Compatibility for existing @change="handler($event.target.value)".
    // Snapshot the string value, so deferred legacy handlers do not observe a
    // later parent render/reconciliation replacing the button's current value.
    const changeTarget = {
      value: String(value ?? ""),
      name: props.name ?? "",
      id: triggerId.value,
    };
    const event = new Event("change");
    Object.defineProperties(event, {
      target: { value: changeTarget },
      currentTarget: { value: changeTarget },
    });
    emit("change", event);
  }
  nextTick(() => trigger.value?.focus());
}
function step(items: Choice[], delta: 1 | -1) {
  const enabled = items
    .map((item, i) => (item.disabled ? -1 : i))
    .filter((i) => i >= 0);
  const offset = enabled.indexOf(activeIndex.value);
  activeIndex.value =
    enabled[(offset + delta + enabled.length) % enabled.length] ?? -1;
  scrollActive();
}
function keydown(event: KeyboardEvent, items: Choice[]) {
  if (blocked()) return;
  const key = event.key;
  if (key === "Tab") {
    close();
    return;
  }
  if (key === "Escape") {
    if (expanded.value) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    return;
  }
  if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(key)) {
    event.preventDefault();
    if (!expanded.value) {
      open(items, key === "ArrowUp" || key === "End" ? -1 : 1);
      if (key !== "Home" && key !== "End") return;
    } else if (key === "Enter" || key === " ") {
      const item = items[activeIndex.value];
      if (item) choose(item);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp")
      step(items, key === "ArrowDown" ? 1 : -1);
    if (key === "Home" || key === "End") {
      const enabled = items
        .map((item, i) => (item.disabled ? -1 : i))
        .filter((i) => i >= 0);
      activeIndex.value = (key === "Home" ? enabled[0] : enabled.at(-1)) ?? -1;
      scrollActive();
    }
    return;
  }
  if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    if (!expanded.value) open(items);
    search += key.toLocaleLowerCase();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = "";
    }, 650);
    // Repeated letters cycle instead of requiring a literal repeated prefix.
    const term = [...search].every((letter) => letter === search[0])
      ? search[0]!
      : search;
    const start = term.length === 1 ? activeIndex.value + 1 : activeIndex.value;
    for (let n = 0; n < items.length; n++) {
      const index = (Math.max(0, start) + n) % items.length;
      const item = items[index]!;
      if (!item.disabled && item.label.toLocaleLowerCase().startsWith(term)) {
        activeIndex.value = index;
        scrollActive();
        break;
      }
    }
  }
}
function outside(event: PointerEvent) {
  if (
    expanded.value &&
    !root.value?.contains(event.target as Node) &&
    !listbox.value?.contains(event.target as Node)
  )
    close();
}
function blur(event: FocusEvent) {
  close();
  emit("blur", event);
}
onUpdated(() => {
  if (!expanded.value || !listbox.value) return;
  const active = listbox.value.querySelector(
    `[data-index="${activeIndex.value}"]:not([aria-disabled="true"])`,
  );
  if (!active) {
    const first = listbox.value.querySelector<HTMLElement>(
      '[data-index]:not([aria-disabled="true"])',
    );
    const index = first ? Number(first.dataset.index) : -1;
    if (activeIndex.value !== index) activeIndex.value = index;
  }
});
watch(
  () => [props.disabled, props.readonly],
  () => {
    if (props.disabled || props.readonly) close();
  },
);
onMounted(() => {
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  window.visualViewport?.addEventListener("resize", reposition);
  window.visualViewport?.addEventListener("scroll", reposition);
});
onBeforeUnmount(() => {
  close();
  cancelAnimationFrame(repositionFrame);
  document.removeEventListener("pointerdown", outside, true);
  window.removeEventListener("resize", reposition);
  window.removeEventListener("scroll", reposition, true);
  window.visualViewport?.removeEventListener("resize", reposition);
  window.visualViewport?.removeEventListener("scroll", reposition);
});
defineExpose({
  focus: () => trigger.value?.focus(),
  get value() {
    return current.value;
  },
});
</script>

<template>
  <div
    ref="root"
    class="ui-select"
    :class="{
      'is-open': expanded,
      'is-disabled': disabled,
      'is-readonly': readonly,
    }"
  >
    <template v-for="items in [choices()]" :key="'choices'">
      <button
        :ref="setTrigger"
        v-bind="attrs"
        :id="triggerId"
        class="ui-select-trigger"
        type="button"
        role="combobox"
        :value="String(current ?? '')"
        :disabled="disabled"
        :aria-disabled="disabled || undefined"
        :aria-readonly="readonly || undefined"
        :aria-required="required || undefined"
        :aria-expanded="expanded"
        aria-haspopup="listbox"
        :aria-controls="expanded ? listId : undefined"
        :aria-activedescendant="selectedId()"
        @click.prevent="toggle(items)"
        @keydown="keydown($event, items)"
        @blur="blur"
        @focus="emit('focus', $event)"
      >
        <span
          class="ui-select-value"
          :class="{ 'is-placeholder': selectedIndex(items) < 0 }"
          >{{ selectedLabel(items) }}</span
        >
        <svg
          class="ui-select-chevron"
          viewBox="0 0 20 20"
          width="18"
          height="18"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m6 8 4 4 4-4"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <input
        v-if="name"
        type="hidden"
        :name="name"
        :value="String(current ?? '')"
        :disabled="disabled"
      />
      <Teleport v-if="expanded && target" :to="target">
        <ul
          :id="listId"
          :ref="setListbox"
          class="ui-select-list"
          role="listbox"
          :aria-label="String(attrs['aria-label'] ?? selectedLabel(items))"
          :style="placement"
          @mousedown.prevent
          @click.stop
        >
          <li
            v-for="(item, index) in items"
            :id="`${listId}-${index}`"
            :key="`${typeof item.value}-${String(item.value)}-${index}`"
            class="ui-select-option"
            :class="{
              'is-active': activeIndex === index,
              'is-selected': selectedIndex(items) === index,
              'is-option-disabled': item.disabled,
            }"
            :data-index="index"
            role="option"
            :aria-selected="selectedIndex(items) === index"
            :aria-disabled="item.disabled || undefined"
            @pointermove="!item.disabled && (activeIndex = index)"
            @click.stop="choose(item)"
          >
            <span class="ui-select-option-copy"
              ><small v-if="item.group" class="ui-select-group">{{
                item.group
              }}</small
              ><span>{{ item.label }}</span></span
            >
            <svg
              v-if="selectedIndex(items) === index"
              class="ui-select-check"
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m4.5 10 3.5 3.5 7.5-7.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </li>
          <li v-if="!items.length" class="ui-select-empty" role="presentation">
            {{ emptyLabel }}
          </li>
        </ul>
      </Teleport>
    </template>
  </div>
</template>
