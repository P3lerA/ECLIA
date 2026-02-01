import { defineConfig } from "vite";

const VLLM_TARGET = "http://192.168.1.156:8000"; 

export default defineConfig({
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: VLLM_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
