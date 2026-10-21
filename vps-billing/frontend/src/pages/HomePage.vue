<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import GeminiHome from "../components/GeminiHome.vue";
import { useWorkspace } from "../composables/useWorkspace";
import { ApiError } from "../services/api";
import type { Locale, Mode, Overview, Role, Service } from "../types/idc";

const props = defineProps<{
  locale: Locale;
  currency: string;
  mode: Mode;
  role: Role;
}>();
const emit = defineEmits<{ navigate: [path: string] }>();
const { read, generation, session } = useWorkspace();
const overview = ref<Overview | null>(null);
const services = ref<Service[]>([]);
const error = ref("");
const loading = ref(true);
let request = 0;
let dataScope = "";
const scope = () =>
  `${props.mode}|${session.value?.user?.id ?? ""}|${session.value?.user?.role ?? ""}|${props.currency}`;

async function load() {
  const current = ++request,
    currentScope = scope(),
    currentGeneration = generation.value;
  if (dataScope !== currentScope) {
    overview.value = null;
    services.value = [];
  }
  dataScope = currentScope;
  loading.value = true;
  error.value = "";
  try {
    // Customer-scope data, even when an administrator visits the customer workspace.
    const [summary, ownServices] = await Promise.all([
      read<Overview>("/overview", { currency: props.currency }),
      read<Service[]>("/services"),
    ]);
    if (
      current !== request ||
      currentScope !== scope() ||
      currentGeneration !== generation.value
    )
      return;
    overview.value = summary;
    services.value = ownServices;
  } catch (failure) {
    if (
      current !== request ||
      currentScope !== scope() ||
      currentGeneration !== generation.value
    )
      return;
    const fallback =
      props.locale === "en"
        ? "Home could not load. Refresh or sign in again."
        : "首页暂时无法加载，请刷新或重新登录。";
    error.value =
      failure instanceof ApiError
        ? `${failure.message}${failure.requestId ? ` · ${failure.requestId}` : ""}`
        : fallback;
  } finally {
    if (
      current === request &&
      currentScope === scope() &&
      currentGeneration === generation.value
    )
      loading.value = false;
  }
}
watch(
  () => [
    props.currency,
    props.mode,
    props.role,
    generation.value,
    session.value?.user?.id,
    session.value?.user?.role,
  ],
  load,
  { immediate: true },
);
onBeforeUnmount(() => {
  request++;
});
</script>

<template>
  <GeminiHome
    :locale="locale"
    :currency="currency"
    :user="session?.user ?? null"
    :loading="loading"
    :error="error"
    :overview="overview"
    :services="services"
    @navigate="emit('navigate', $event)"
    @retry="load"
  />
</template>
