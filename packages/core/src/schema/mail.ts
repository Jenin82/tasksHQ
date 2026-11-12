import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mailOutbox = sqliteTable("mail_outbox", {
  id: text("id").primaryKey(),
  kind: text("kind", {
    enum: ["assignment", "task_update", "org_invite", "project_invite", "project_added", "comment_mention"],
  }).notNull(),
  targetId: text("target_id").notNull(),
  recipient: text("recipient").notNull(),
  inviteVersion: integer("invite_version", { mode: "timestamp_ms" }),
  readyAt: integer("ready_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  leaseId: text("lease_id"),
}, (t) => [index("mail_outbox_ready_idx").on(t.readyAt)]);

export type MailJob = typeof mailOutbox.$inferSelect;
