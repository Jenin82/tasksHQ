import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import app from "vinext/server/fetch-handler";
import { drainMailOutbox } from "../lib/mail-outbox";
import { drainSlackOutbox } from "../lib/slack";
import { emailEnabled, sendMail } from "../lib/smtp";
import { renderCanonicalTaskShare } from "../lib/task-share-page";

export * from "vinext/server/fetch-handler";

async function deliverSlack(db: DrizzleD1Database, env: Env) {
  for (let pass = 0; pass < 5; pass++) {
    if (pass > 0) await scheduler.wait(1_000);
    const processed = await drainSlackOutbox(db, env.BETTER_AUTH_URL, env.BETTER_AUTH_SECRET);
    if (!processed) return;
  }
}

export default {
  ...app,
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return (await renderCanonicalTaskShare(request)) ?? app.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledController, env: Env) {
    const db = drizzle(env.DB);
    const results = await Promise.allSettled([
      deliverSlack(db, env),
      emailEnabled ? drainMailOutbox(db, env.BETTER_AUTH_URL, sendMail) : undefined,
    ]);
    if (results.some(({ status }) => status === "rejected")) {
      throw new Error("A notification outbox could not be processed.");
    }
  },
};
