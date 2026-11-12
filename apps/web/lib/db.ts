import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

/** The one D1 handle the route layer uses. Domain functions take it as `ctx.db`. */
export const db = drizzle(env.DB);
