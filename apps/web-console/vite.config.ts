import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { loadEcliaConfig } from "@eclia/config";

// Note: Vite executes this config in Node.
// We load the canonical TOML config (base + local overrides) via @eclia/config
// so the console and gateway stay in sync.
const { config } = loadEcliaConfig(process.cwd());

const consoleHost = config.console.host;
const consolePort = config.console.port;
const apiPort = config.api.port;
const loopbackHost = "127.0.0.1";

export default defineConfig({
  plugins: [react()],
  server: {
    host: consoleHost,
    port: consolePort,
    strictPort: true,
    proxy: {
      "/api/symphony": {
        target: `http://${loopbackHost}:8800`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/symphony/, "")
      },
      "/api": {
        target: `http://${loopbackHost}:${apiPort}`,
        changeOrigin: true
      }
    }
  }
});
