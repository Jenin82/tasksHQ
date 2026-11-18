import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { autoArchiveDoneTasks, stopStaleTimers } from "@tasks/core/domain";
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
    const share = await renderCanonicalTaskShare(request);
    if (share) return share;
    // `REQUEST_PATH_HEADER` in lib/project-context.ts, so the redirect from a
    // former project slug keeps the rest of the path and the query. Set only
    // here, so a client-sent value never survives.
    const headers = new Headers(request.headers);
    headers.delete("x-taskshq-path");
    if (request.method === "GET" || request.method === "HEAD") {
      const url = new URL(request.url);
      headers.set("x-taskshq-path", url.pathname + url.search);
    }
    return app.fetch(new Request(request, { headers }), env, ctx);
  },
  async scheduled(_event: ScheduledController, env: Env) {
    const db = drizzle(env.DB);
    const results = await Promise.allSettled([
      deliverSlack(db, env),
      emailEnabled ? drainMailOutbox(db, env.BETTER_AUTH_URL, sendMail) : undefined,
      autoArchiveDoneTasks(db),
      stopStaleTimers(db),
    ]);
    if (results.some(({ status }) => status === "rejected")) {
      throw new Error("A scheduled job failed.");
    }
  },
};
