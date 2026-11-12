import { env } from "cloudflare:workers";

/**
 * PLAN §15's origins, set per deployment in cloudflare.config.ts.
 * `MCP_RESOURCE` must equal, byte for byte, the entry in apps/web's
 * `OAuthAuthorizationServer({ resources })`: tokens are audience-bound to it,
 * and OAuthResourceServer serves only this origin.
 */
export const AUTH_ISSUER = env.AUTH_ISSUER;
export const MCP_RESOURCE = env.MCP_RESOURCE;

/**
 * The service binding ignores the host, so the origin here only has to be
 * one apps/web's router accepts; the path is the contract.
 */
export const INTROSPECT_URL = `${AUTH_ISSUER}/internal/introspect`;
export const INTROSPECT_SECRET_HEADER = "X-Introspect-Secret";
