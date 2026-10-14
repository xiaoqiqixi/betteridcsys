import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
const apiTarget = process.env.API_PROXY_TARGET || "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false,
      },
      "/healthz": apiTarget,
      "/readyz": apiTarget,
    },
  },
});
