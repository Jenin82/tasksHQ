import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { project } from "./project";
import { task } from "./task";

export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id),
  taskId: text("task_id").references(() => task.id),
  actorUserId: text("actor_user_id")
    .notNull()
    .references(() => user.id),
  source: text("source", { enum: ["web", "mcp"] }).notNull(),
  clientId: text("client_id"),
  clientName: text("client_name"),
  type: text("type").notNull(),
  // JSON text; payload shape is pinned per `type` in PLAN.md §3.
  data: text("data").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
