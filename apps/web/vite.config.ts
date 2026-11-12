import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { defineConfig, loadEnv } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { bindings } from "cf/config";

// Same keys as the optionalSecret() entries in cloudflare.config.ts.
const optionalEmailBindings = [
  "SMTP_HOST", "SMTP_PORT", "SMTP_TLS", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SIGNUP_EMAIL_ALLOWLIST",
];

export default defineConfig(({ command, mode }) => ({
  // Local fixtures can share node_modules. Each app root needs its own
  // optimized bundles so the browser loads a single React runtime.
  cacheDir: ".vinext/dev/vite-cache",
  // Matches BETTER_AUTH_URL in .dev.vars and the MCP Worker's local AUTH_ISSUER.
  server: { port: 5173, strictPort: true },
  plugins: [
    vinext({
      // No `prerender` option: every route in this app renders per-user
      // authenticated data, so none of it may be baked at build time.
      //
      // vinext's `prerender` accepts only `true` or `{ routes: "*" }` —
      // `normalizeVinextPrerenderConfig` in vinext/dist/config/prerender.js
      // throws on any other `routes` value, so there is no narrower setting to
      // pick. Omitting the option is the only way to turn it off. Should a
      // genuinely static route ever appear, it can opt in with
      // `export const dynamic = "force-static"` on that route alone.
      //
      // Note `vinext-cloudflare deploy --prerender-all` overrides this, and
      // `output: "export"` in next.config.ts would too. Neither is used here.
    }),
    cloudflare({
      config(config) {
        if (command !== "serve" || !config.worker) return config;
        // The dev runtime only reads declared secrets from .dev.vars, so
        // optional keys follow .dev.vars here rather than the deploy secrets.
        const envFile = [`.dev.vars.${mode}`, ".dev.vars"].map((file) => resolve(import.meta.dirname, file)).find(existsSync);
        const local = envFile ? parseEnv(readFileSync(envFile, "utf8")) : loadEnv(mode, import.meta.dirname, "");
        const workerEnv = config.worker.env ??= {};
        // Local dev never uses the deployed URLs from deploy.env.
        workerEnv.MCP_RESOURCE = bindings.text("http://localhost:8787/mcp");
        for (const key of optionalEmailBindings) {
          if (local[key]?.trim()) workerEnv[key] = bindings.secret();
          else delete workerEnv[key];
        }
        return config;
      },
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
}));
