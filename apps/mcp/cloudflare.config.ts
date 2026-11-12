import { resolve } from "node:path";
import { bindings, defineConfig, defineWorker } from "cf/config";

// Deployment settings live in gitignored files at the repo root (see
// deploy.env.example and secrets.env.example); scripts/deploy-mcp.mjs
// passes only INTROSPECT_SECRET from secrets.env to `cf deploy`. Tests and
// type generation work without them. Local D1 needs TASKSHQ_D1_ID (any UUID works locally).
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../deploy.env"));
} catch {}

const env = process.env;
const origin = (url: string | undefined, fallback: string) => (url || fallback).replace(/\/+$/, "");
const webWorker = env.TASKSHQ_WEB_WORKER || "taskshq-web";

export default defineConfig({
  worker: defineWorker({
    name: env.TASKSHQ_MCP_WORKER || "taskshq-mcp",
    entrypoint: "./src/index.ts",
    // Must match apps/web so both Workers run on the same runtime date.
    compatibilityDate: "2026-11-05",
    compatibilityFlags: ["nodejs_compat"],
    observability: {
      enabled: true,
      redactQueryString: true,
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
    // PLAN §15: the resource origin. Must equal the origin of `MCP_RESOURCE`
    // below — OAuthResourceServer 404s any other origin. Without
    // TASKSHQ_MCP_DOMAIN the Worker is served on workers.dev.
    ...(env.TASKSHQ_MCP_DOMAIN ? { domains: [env.TASKSHQ_MCP_DOMAIN] } : {}),
    env: {
      // Its own binding to the same database apps/web uses (PLAN §5.6).
      DB: bindings.d1({
        name: env.TASKSHQ_D1_NAME || "taskshq-db",
        id: env.TASKSHQ_D1_ID || undefined,
      }),
      TASK_IMAGES: bindings.r2({ name: env.TASKSHQ_R2_BUCKET || "taskshq-images" }),
      IMAGES: bindings.images(),
      // PLAN §1: only the authorization server (in the web Worker) can
      // validate a token, so this Worker asks it over a service binding.
      AUTH_SERVER: bindings.worker({ worker: webWorker }),
      // Must equal, byte for byte, the web Worker's MCP_RESOURCE.
      MCP_RESOURCE: bindings.text(`${origin(env.TASKSHQ_MCP_URL, "http://localhost:8787")}/mcp`),
      AUTH_ISSUER: bindings.text(origin(env.TASKSHQ_WEB_URL, "http://localhost:5173")),
      // Shared with the web Worker; sent on every POST /internal/introspect.
      INTROSPECT_SECRET: bindings.secret(),
    },
  }),
});
