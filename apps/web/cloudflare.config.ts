import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

// Deployment settings live in gitignored files at the repo root (see
// deploy.env.example and secrets.env.example). Tests and type generation work
// without them. Local D1 needs TASKSHQ_D1_ID (any UUID works locally).
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../deploy.env"));
} catch {}
// secrets.env stays out of process.env: `cf deploy --secrets-file` is its only
// parser. It is read here just to see which optional secrets are set.
const secretsFile = resolve(import.meta.dirname, "../../secrets.env");
const secrets = existsSync(secretsFile) ? parseEnv(readFileSync(secretsFile, "utf8")) : {};

const env = process.env;
const origin = (url: string | undefined, fallback: string) => (url || fallback).replace(/\/+$/, "");
// Optional secrets are declared only when set, so `cf deploy --secrets-file`
// uploads them without requiring them on every deployment. Keep this list in
// sync with optionalEmailBindings in vite.config.ts.
const optionalSecret = (key: string) => (secrets[key]?.trim() ? bindings.secret() : undefined);

export default defineConfig({
  worker: defineWorker({
    name: env.TASKSHQ_WEB_WORKER || "taskshq-web",
    entrypoint: "./worker/index.ts",
    triggers: [triggers.scheduled({ schedule: "* * * * *" })],
    compatibilityDate: "2026-11-05",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    observability: {
      enabled: true,
      redactQueryString: true,
      // Short share codes are in the path. Keep automatic request URLs out of logs.
      logs: { enabled: true, invocationLogs: false },
      // Automatic outbound fetch spans record the Slack webhook secret in the URL path.
      traces: { enabled: false },
    },
    // Source of truth for the custom domain; domain settings are applied on
    // deploy. Without TASKSHQ_WEB_DOMAIN the Worker is served on workers.dev.
    ...(env.TASKSHQ_WEB_DOMAIN ? { domains: [env.TASKSHQ_WEB_DOMAIN] } : {}),
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*", "!/favicon.svg", "!/taskshq-social.png"],
    },
    env: {
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      TASK_IMAGES: bindings.r2({ name: env.TASKSHQ_R2_BUCKET || "taskshq-images" }),
      DB: bindings.d1({
        name: env.TASKSHQ_D1_NAME || "taskshq-db",
        id: env.TASKSHQ_D1_ID || undefined,
      }),
      OAUTH_KV: bindings.kv({ id: env.TASKSHQ_KV_ID || undefined }),
      // The MCP Worker's resource URL. Tokens are audience-bound to it.
      MCP_RESOURCE: bindings.text(`${origin(env.TASKSHQ_MCP_URL, "http://localhost:8787")}/mcp`),
      CONSENT_SECRET: bindings.secret(),
      INTROSPECT_SECRET: bindings.secret(),
      BETTER_AUTH_SECRET: bindings.secret(),
      BETTER_AUTH_URL: bindings.secret(),
      GOOGLE_CLIENT_ID: bindings.secret(),
      GOOGLE_CLIENT_SECRET: bindings.secret(),
      SMTP_HOST: optionalSecret("SMTP_HOST"),
      SMTP_PORT: optionalSecret("SMTP_PORT"),
      SMTP_TLS: optionalSecret("SMTP_TLS"),
      SMTP_USERNAME: optionalSecret("SMTP_USERNAME"),
      SMTP_PASSWORD: optionalSecret("SMTP_PASSWORD"),
      SMTP_FROM: optionalSecret("SMTP_FROM"),
      SIGNUP_EMAIL_ALLOWLIST: optionalSecret("SIGNUP_EMAIL_ALLOWLIST"),
    },
  }),
});
