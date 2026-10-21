import { createRouter, createWebHashHistory } from "vue-router";
import HomePage from "./pages/HomePage.vue";
import CatalogPage from "./pages/CatalogPage.vue";
import AdminCatalogPage from "./pages/AdminCatalogPage.vue";
import OperationsPage from "./pages/OperationsPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
export const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior(to, from, saved) {
    return to.fullPath === from.fullPath ? false : saved || { left: 0, top: 0 };
  },
  routes: [
    { path: "/", redirect: "/home" },
    { path: "/home", component: HomePage },
    { path: "/catalog", component: CatalogPage },
    ...["orders", "invoices", "services", "account", "audit"].map(
      (section) => ({
        path: `/${section}`,
        component: OperationsPage,
        meta: { section },
      }),
    ),
    {
      path: "/orders/:id",
      component: OperationsPage,
      meta: { section: "order-detail" },
    },
    { path: "/admin/catalog", component: AdminCatalogPage },
    ...["orders", "invoices", "services", "customers", "audit", "finance"].map(
      (section) => ({
        path: `/admin/${section}`,
        component: OperationsPage,
        meta: { section },
      }),
    ),
    {
      path: "/admin/orders/:id",
      component: OperationsPage,
      meta: { section: "order-detail" },
    },
    { path: "/admin/settings", component: SettingsPage },
    { path: "/:pathMatch(.*)*", redirect: "/home" },
  ],
});
