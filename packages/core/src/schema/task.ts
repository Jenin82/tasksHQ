import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { project, projectTaskType, status } from "./project";

export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const task = sqliteTable(
  "task",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    // Display key `ENG-42` is derived from project.key and this at read time.
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    // A calendar date (YYYY-MM-DD) without a timezone or time of day.
    dueDate: text("due_date"),
    priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("medium"),
    // Nullable for older Workers during rollout. The insert trigger supplies the project's default.
    typeId: text("type_id").references(() => projectTaskType.id),
    statusId: text("status_id")
      .notNull()
      .references(() => status.id),
    assigneeUserId: text("assignee_user_id").references(() => user.id),
    // Nullable for older Workers during rollout. The insert trigger supplies the creator.
    reporterUserId: text("reporter_user_id").references(() => user.id),
    // Fractional index, scoped to (projectId, statusId).
    position: text("position").notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("task_project_id_number_unique").on(t.projectId, t.number),
    index("task_type_id_idx").on(t.typeId),
  ],
);

export const taskProjectAlias = sqliteTable("task_project_alias", {
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.projectId, t.number] }),
  index("task_project_alias_task_id_idx").on(t.taskId),
]);

export const taskShare = sqliteTable("task_share", {
  code: text("code").primaryKey().notNull(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  canonicalPreview: integer("canonical_preview", { mode: "boolean" }).notNull().default(false),
}, (t) => [
  uniqueIndex("task_share_location_idx").on(t.taskId, t.projectId, t.number),
  index("task_share_project_id_idx").on(t.projectId),
]);

export type CommentMention = { userId: string; start: number; end: number };

export const comment = sqliteTable("comment", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => task.id),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  body: text("body").notNull(),
  // Deliberately duplicates the activity row's source, so rendering a
  // comment's badge needs no join.
  source: text("source", { enum: ["web", "mcp"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  mentions: text("mentions", { mode: "json" }).$type<CommentMention[]>(),
});

export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;
export type Comment = typeof comment.$inferSelect;
export type NewComment = typeof comment.$inferInsert;
