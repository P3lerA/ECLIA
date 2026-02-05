import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { loadEcliaConfig } from "./server/ecliaConfig";

const { config } = loadEcliaConfig(process.cwd());

// Note: this is a dev-only console shell. In a real project you likely run a gateway/router
// and point the proxy to that service.
export default defineConfig({
  plugins: [react()],
  server: {
    host: config.console.host,
    port: config.console.port,
    proxy: {
      "/api": `http://localhost:${config.api.port}`
    }
  }
});
