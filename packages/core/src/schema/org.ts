import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const org = sqliteTable("org", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const orgMember = sqliteTable(
  "org_member",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => org.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    // Also the parent key of project_member's composite FK, so it must exist.
    uniqueIndex("org_member_org_id_user_id_unique").on(t.orgId, t.userId),
  ],
);

export const orgInvite = sqliteTable(
  "org_invite",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => org.id),
    // Stored lowercased; lowercased on lookup too.
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("org_invite_org_id_email_unique").on(t.orgId, t.email),
    // claimInvites looks up by email alone on every session create. The unique
    // index above leads with orgId, so it cannot serve that lookup.
    index("org_invite_email_idx").on(t.email),
  ],
);

export const orgReportingLine = sqliteTable(
  "org_reporting_line",
  {
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    leadUserId: text("lead_user_id").notNull(),
  },
  (t) => [
    uniqueIndex("org_reporting_line_org_user_unique").on(t.orgId, t.userId),
    index("org_reporting_line_org_lead_idx").on(t.orgId, t.leadUserId),
    foreignKey({
      columns: [t.orgId, t.userId],
      foreignColumns: [orgMember.orgId, orgMember.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.orgId, t.leadUserId],
      foreignColumns: [orgMember.orgId, orgMember.userId],
    }).onDelete("cascade"),
  ],
);

export type Org = typeof org.$inferSelect;
export type NewOrg = typeof org.$inferInsert;
export type OrgMember = typeof orgMember.$inferSelect;
export type NewOrgMember = typeof orgMember.$inferInsert;
export type OrgInvite = typeof orgInvite.$inferSelect;
export type NewOrgInvite = typeof orgInvite.$inferInsert;
