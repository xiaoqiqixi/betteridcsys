import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import InstancesPage from "./pages/InstancesPage.vue";
import InstanceDetailPage from "./pages/InstanceDetailPage.vue";
import NodesPage from "./pages/NodesPage.vue";
import OperationsPage from "./pages/OperationsPage.vue";
import OperationDetailPage from "./pages/OperationDetailPage.vue";
import AuditPage from "./pages/AuditPage.vue";
import UsersPage from "./pages/UsersPage.vue";
import "./style.css";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/instances" },
    {
      path: "/instances",
      component: InstancesPage,
      meta: { permission: "instances.read" },
    },
    {
      path: "/instances/:id",
      component: InstanceDetailPage,
      meta: { permission: "instances.read" },
    },
    {
      path: "/nodes",
      component: NodesPage,
      meta: { permission: "nodes.read" },
    },
    {
      path: "/operations",
      component: OperationsPage,
      meta: { permission: "instances.read" },
    },
    {
      path: "/operations/:id",
      component: OperationDetailPage,
      meta: { permission: "instances.read" },
    },
    {
      path: "/audit",
      component: AuditPage,
      meta: { permission: "audit.read" },
    },
    {
      path: "/users",
      component: UsersPage,
      meta: { permission: "users.manage" },
    },
    { path: "/:pathMatch(.*)*", redirect: "/instances" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
createApp(App).use(router).mount("#app");
