import { env as workerEnv } from "cloudflare:workers";
import { OAuthResourceServer } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { drizzle } from "drizzle-orm/d1";
import { introspect, type Props } from "./auth";
import { AUTH_ISSUER, MCP_RESOURCE } from "./config";
import { buildServer, MAX_MCP_REQUEST_BYTES } from "./tools";

const db = drizzle(workerEnv.DB);

/**
 * Stateless streamable HTTP (§5.6, no Durable Object): the factory builds a
 * fresh server per request, bound to the caller the token proved. Modern
 * (2026-07-28) clients and 2025-era clients (stateless fallback) both work.
 */
const mcp = createMcpHandler(
  ({ authInfo }) => buildServer(db, authInfo?.extra?.props as Props, workerEnv),
  { maxRequestBodySize: MAX_MCP_REQUEST_BYTES },
);

export default new OAuthResourceServer<Env, Props>({
  resourceMetadata: {
    resource: MCP_RESOURCE,
    authorization_servers: [AUTH_ISSUER],
    resource_name: "TasksHQ",
  },
  validateToken: (env) => introspect(env),
  handler: {
    fetch(request, _env, ctx) {
      return mcp.fetch(request, {
        authInfo: {
          token: ctx.auth.token,
          clientId: ctx.props.clientId,
          scopes: ctx.auth.scope,
          expiresAt: ctx.auth.expiresAt,
          extra: { props: ctx.props },
        },
      });
    },
  },
});
