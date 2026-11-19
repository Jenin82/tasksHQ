import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { team } from "./team";
import { task } from "./task";

/**
 * A running timer older than this is stopped at this length and flagged
 * `auto_stopped`. Here rather than in the domain so client code can cap a
 * ticking clock without importing it.
 */
export const STALE_MS = 12 * 60 * 60 * 1000;

/** A span of time a user spent on a task. `endedAt` null means the timer is running. */
export const timeEntry = sqliteTable(
  "time_entry",
  {
    id: text("id").primaryKey(),
    // No cascade: deleteTeam removes tasks (and so entries) first.
    teamId: text("team_id").notNull().references(() => team.id),
    taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    note: text("note"),
    kind: text("kind", { enum: ["timer", "manual"] }).notNull(),
    source: text("source", { enum: ["web", "mcp"] }).notNull(),
    autoStopped: integer("auto_stopped", { mode: "boolean" }).notNull().default(false),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    // One running timer per user, across every team.
    uniqueIndex("time_entry_running_user_unique").on(t.userId).where(sql`${t.endedAt} is null`),
    index("time_entry_team_id_started_at_idx").on(t.teamId, t.startedAt),
    index("time_entry_user_id_started_at_idx").on(t.userId, t.startedAt),
    index("time_entry_task_id_idx").on(t.taskId),
    check("time_entry_ended_after_started", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export type TimeEntry = typeof timeEntry.$inferSelect;
