import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The schema lives in packages/core, but drizzle-kit writes its migrations
// under apps/web (apps/web/drizzle.config.ts). Read them from there rather
// than keeping a copy that could drift.
const migrations = await readD1Migrations(
  path.join(import.meta.dirname, "../web/drizzle"),
);

// A fixture, not a secret: the stubbed AUTH_SERVER below checks for it.
const TEST_INTROSPECT_SECRET = "test-only-introspect-secret";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        // Must match cloudflare.config.ts.
        compatibilityDate: "2026-11-05",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["TASK_IMAGES"],
        images: { binding: "IMAGES" },
        bindings: {
          INTROSPECT_SECRET: TEST_INTROSPECT_SECRET,
          MCP_RESOURCE: "https://mcp.example.test/mcp",
          AUTH_ISSUER: "https://taskshq.example.test",
          MIGRATIONS: migrations,
        },
        serviceBindings: {
          /**
           * Stands in for the web Worker's `POST /internal/introspect`. A test
           * token is `ok:<userId>:<clientId>:<clientName>`; anything else is
           * an invalid token. Answers exactly what the real route must.
           */
          AUTH_SERVER: async (request) => {
            const url = new URL(request.url);
            if (
              request.method !== "POST" ||
              url.pathname !== "/internal/introspect" ||
              request.headers.get("X-Introspect-Secret") !==
                TEST_INTROSPECT_SECRET
            ) {
              return new Response(null, { status: 403 });
            }
            const { resource, token } = (await request.json()) as {
              resource: string;
              token: string;
            };
            const [kind, userId, clientId, clientName] = token.split(":");
            if (kind !== "ok") return Response.json(null);
            return Response.json({
              props: { userId, clientId, clientName: decodeURIComponent(clientName) },
              audience: resource,
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
              scope: [],
              userId,
              clientId,
            });
          },
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
