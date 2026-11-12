import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { org, orgMember } from "./org";

export const STATUS_COLORS = ["gray", "blue", "green", "red", "yellow", "orange", "purple", "pink"] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];
export const TASK_TYPE_ICONS = ["task", "bug", "feature", "book", "wrench", "flag", "star", "lightning"] as const;
export type TaskTypeIconName = (typeof TASK_TYPE_ICONS)[number];

export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => org.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    // Immutable: the display key `ENG-42` is derived from it at read time.
    key: text("key").notNull(),
    taskCounter: integer("task_counter").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    restrictTaskEdits: integer("restrict_task_edits", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("project_org_id_slug_unique").on(t.orgId, t.slug),
    uniqueIndex("project_org_id_key_unique").on(t.orgId, t.key),
  ],
);

export const projectMember = sqliteTable(
  "project_member",
  {
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  },
  (t) => [
    uniqueIndex("project_member_project_id_user_id_unique").on(
      t.projectId,
      t.userId,
    ),
    foreignKey({
      columns: [t.orgId, t.userId],
      foreignColumns: [orgMember.orgId, orgMember.userId],
    }).onDelete("cascade"),
  ],
);

export const projectInvite = sqliteTable(
  "project_invite",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("project_invite_project_email_unique").on(t.projectId, t.email),
    index("project_invite_email_idx").on(t.email),
  ],
);

export const status = sqliteTable(
  "status",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id),
    name: text("name").notNull(),
    color: text("color", { enum: STATUS_COLORS }),
    // Fractional index.
    position: text("position").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("status_project_id_name_unique").on(t.projectId, t.name)],
);

export const projectTaskType = sqliteTable(
  "project_task_type",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color", { enum: STATUS_COLORS }).notNull().default("gray"),
    icon: text("icon", { enum: TASK_TYPE_ICONS }).notNull().default("task"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("project_task_type_project_name_unique").on(t.projectId, sql`lower(${t.name})`),
    uniqueIndex("project_task_type_default_unique").on(t.projectId).where(sql`${t.isDefault} = 1`),
  ],
);

export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
export type ProjectMember = typeof projectMember.$inferSelect;
export type ProjectRole = ProjectMember["role"];
export type NewProjectMember = typeof projectMember.$inferInsert;
export type Status = typeof status.$inferSelect;
export type NewStatus = typeof status.$inferInsert;
export type ProjectTaskType = typeof projectTaskType.$inferSelect;
