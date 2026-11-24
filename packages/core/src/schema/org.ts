import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

// One deployment is one organization, so `org` holds a single row and the
// member and invite tables carry no org_id.
export const org = sqliteTable("org", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const orgMember = sqliteTable("org_member", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const orgInvite = sqliteTable("org_invite", {
  // Stored lowercased; lowercased on lookup too.
  email: text("email").primaryKey(),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
  invitedByUserId: text("invited_by_user_id")
    .notNull()
    .references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
});

// One lead per person across the whole org. Leaving the org drops lines on
// both sides through the cascades.
export const reportingLine = sqliteTable(
  "reporting_line",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => orgMember.userId, { onDelete: "cascade" }),
    leadUserId: text("lead_user_id")
      .notNull()
      .references(() => orgMember.userId, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("reporting_line_lead_user_id_idx").on(t.leadUserId),
    check("reporting_line_not_self", sql`${t.userId} <> ${t.leadUserId}`),
  ],
);

export type Org = typeof org.$inferSelect;
export type OrgMember = typeof orgMember.$inferSelect;
export type OrgRole = OrgMember["role"];
export type OrgInvite = typeof orgInvite.$inferSelect;
