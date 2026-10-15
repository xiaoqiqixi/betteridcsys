import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import "./style.css";
let scrollGeneration = 0;
const router = createRouter({
  history: createWebHistory(),
  async scrollBehavior(_to, _from, savedPosition) {
    const generation = ++scrollGeneration;
    if (!savedPosition) return { left: 0, top: 0 };
    // A returning settings page can fetch its content after navigation. Wait
    // briefly for enough document height instead of clamping history to zero.
    const deadline = performance.now() + 2000;
    await new Promise<void>((resolve) => {
      const ready = () => {
        if (
          generation !== scrollGeneration ||
          document.documentElement.scrollHeight - window.innerHeight >=
            savedPosition.top ||
          performance.now() >= deadline
        ) {
          resolve();
        } else requestAnimationFrame(ready);
      };
      ready();
    });
    return generation === scrollGeneration ? savedPosition : false;
  },
  routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
});
createApp(App).use(router).mount("#app");
