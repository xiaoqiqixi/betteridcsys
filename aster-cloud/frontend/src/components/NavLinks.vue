<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { Server, Network, ListChecks, ShieldCheck, Users } from "@lucide/vue";
import { useConsole } from "../context";
const emit = defineEmits<{ navigate: [] }>();
const {
  session,
  prefs: { tr },
} = useConsole();
const links = computed(() =>
  [
    {
      path: "/instances",
      label: tr("实例", "Instances"),
      icon: Server,
      permission: "instances.read",
    },
    {
      path: "/nodes",
      label: tr("节点", "Nodes"),
      icon: Network,
      permission: "nodes.read",
    },
    {
      path: "/operations",
      label: tr("操作任务", "Tasks"),
      icon: ListChecks,
      permission: "instances.read",
    },
    {
      path: "/audit",
      label: tr("审计记录", "Audit log"),
      icon: ShieldCheck,
      permission: "audit.read",
    },
    {
      path: "/users",
      label: tr("成员与权限", "Members & access"),
      icon: Users,
      permission: "users.manage",
    },
  ].filter((item) => session.can(item.permission)),
);
</script>
<template>
  <nav class="nav-links" :aria-label="tr('主导航', 'Main navigation')">
    <RouterLink
      v-for="link in links"
      :key="link.path"
      :to="link.path"
      active-class="is-current"
      @click="emit('navigate')"
      ><component :is="link.icon" :size="19" aria-hidden="true" /><span>{{
        link.label
      }}</span></RouterLink
    >
  </nav>
</template>
<style scoped>
.nav-links {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nav-links a {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 12px 14px;
  border-radius: 10px;
  color: var(--sidebar-secondary);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition:
    background 0.12s,
    color 0.12s;
}
.nav-links a:hover {
  background: var(--sidebar-hover);
  color: var(--sidebar-text);
}
.nav-links .is-current {
  color: var(--sidebar-text);
  background: var(--sidebar-selected);
}
.nav-links svg {
  flex-shrink: 0;
}
.nav-links span {
  overflow-wrap: anywhere;
}
</style>
