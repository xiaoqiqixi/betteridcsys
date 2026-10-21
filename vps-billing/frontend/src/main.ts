import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import "./completion.css";
import "./controls.css";
import "./shell.css";
import { router } from "./router";
createApp(App).use(router).mount("#app");
