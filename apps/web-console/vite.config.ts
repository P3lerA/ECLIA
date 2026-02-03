import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Note: proxy /api to the local SSE demo server (default 8787).
// In a real project, point this to your gateway/router/openai-compatible service.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
