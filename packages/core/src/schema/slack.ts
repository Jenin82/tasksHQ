import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { project } from "./project";

type SlackTaskEvent = { taskKey: string; title: string; actor: string; toStatus: string };

export type SlackEvent = { type: "test" }
  | (SlackTaskEvent & { type: "created" })
  | (SlackTaskEvent & { type: "status_changed"; fromStatus: string });

export const projectSlack = sqliteTable("project_slack", {
  projectId: text("project_id").primaryKey().references(() => project.id, { onDelete: "cascade" }),
  revision: text("revision").notNull(),
  encryptedWebhook: text("encrypted_webhook").notNull(),
  lastError: text("last_error"),
});

export const slackOutbox = sqliteTable("slack_outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull().references(() => projectSlack.projectId, { onDelete: "cascade" }),
  revision: text("revision").notNull(),
  payload: text("payload", { mode: "json" }).$type<SlackEvent>().notNull(),
  readyAt: integer("ready_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  leaseId: text("lease_id"),
}, (t) => [
  index("slack_outbox_project_order_idx").on(t.projectId, t.revision, t.id),
  index("slack_outbox_ready_idx").on(t.readyAt),
]);
