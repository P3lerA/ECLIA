import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 说明：这里把 /api 代理到本地 SSE 示例服务（默认 8787）
// 真实项目里你可以改成你的 gateway / router / openai-compatible 服务
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
