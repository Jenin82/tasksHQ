import { cloudflare } from "@cloudflare/vite-plugin";
import { bindings } from "cf/config";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({
      // Share the web app's local D1, R2 and KV so both dev servers see the same data.
      persistState: { path: "../web/.cloudflare/state" },
      config(config) {
        if (command !== "serve" || !config.worker) return config;
        // Local dev never uses the deployed URLs from deploy.env.
        const workerEnv = config.worker.env ??= {};
        workerEnv.MCP_RESOURCE = bindings.text("http://localhost:8787/mcp");
        workerEnv.AUTH_ISSUER = bindings.text("http://localhost:5173");
        return config;
      },
    }),
  ],
  // `cf dev` runs Vite here; the web dev server listens on 5173.
  server: { port: 8787, strictPort: true },
}));
