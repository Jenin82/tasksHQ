import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import { cache, env, exports as workerExports, tracing, waitUntil } from "cloudflare:workers";

export const oauthEnv = env;
export const AUTH_ISSUER = new URL(env.BETTER_AUTH_URL).origin;
export const MCP_RESOURCE = env.MCP_RESOURCE;
export const OAUTH_SCOPES: readonly string[] = [];

export const authorizationServer = new OAuthAuthorizationServer({
  issuer: AUTH_ISSUER,
  resources: [MCP_RESOURCE],
  defaultResource: MCP_RESOURCE,
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [...OAUTH_SCOPES],
  onError: ({ status, code }) => console.warn("MCP OAuth request failed", { status, code }),
});

// Route handlers have no fetch context argument. The protocol routes only
// need the Worker lifetime hook. An unsupported host operation fails closed.
const context: ExecutionContext = {
  waitUntil,
  exports: workerExports,
  cache,
  tracing,
  props: undefined,
  passThroughOnException() {
    throw new Error("OAuth routes do not pass through to an origin.");
  },
  mapVirtualHost() {
    throw new Error("OAuth routes do not map virtual hosts.");
  },
  abort(reason) {
    throw reason ?? new Error("OAuth request aborted.");
  },
};

export function serveOAuthProtocol(request: Request) {
  return authorizationServer.fetch(request, oauthEnv, context);
}
