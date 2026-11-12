import { env } from "cloudflare:workers";

// Public addresses for pages that must not load the Worker-only OAuth modules.
export const MCP_URL = env.MCP_RESOURCE;
// Falls back to the local dev origin so a missing BETTER_AUTH_URL fails at sign-in, not at module load.
export const APP_URL = env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).origin : "http://localhost:5173";
