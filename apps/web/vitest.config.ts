import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  path.join(import.meta.dirname, "drizzle"),
);

// Values the suite needs present but whose contents it does not care about.
// Tests must run on a fresh clone and in CI, where .dev.vars (gitignored) is
// absent. These are fixtures, not secrets — nothing here reaches Google.
const testDefaults = {
  BETTER_AUTH_SECRET: "test-only-secret-not-used-outside-vitest-0123456789",
  // test/auth.test.ts asserts the Google redirect_uri is built from this.
  BETTER_AUTH_URL: "http://localhost:5173",
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  CONSENT_SECRET: "test-only-mcp-consent-secret-0123456789",
  INTROSPECT_SECRET: "test-only-mcp-introspection-secret-0123456789",
  MCP_RESOURCE: "https://mcp.example.test/mcp",
};

export default defineConfig({
  plugins: [
    // tsconfig.json carries Next's `jsx: "preserve"`, so Vite refuses to
    // transform a `.tsx` module on its own. The vinext plugin does this during
    // dev and build and is not in this config, so the suite needs its own.
    react(),
    cloudflareTest({
      miniflare: {
        // Must match cloudflare.config.ts so tests and production run on the
        // same runtime date.
        compatibilityDate: "2026-11-05",
        compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
        d1Databases: ["DB"],
        kvNamespaces: ["OAUTH_KV"],
        r2Buckets: ["TASK_IMAGES"],
        images: { binding: "IMAGES" },
        bindings: { ...testDefaults, MIGRATIONS: migrations },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // The vinext plugin aliases `next/*` to its shims during dev and build,
      // and it is not in this config, so the suite has to do the same for any
      // module it imports that reaches for them. The react-server build is the
      // one route handlers, layouts, pages and Server Actions run against.
      "next/link": "vinext/shims/link",
      "next/navigation": "vinext/shims/navigation.react-server",
      "next/headers": "vinext/shims/headers",
      "next/cache": "vinext/shims/cache",
    },
  },
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
