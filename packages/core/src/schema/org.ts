import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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

export type Org = typeof org.$inferSelect;
export type OrgMember = typeof orgMember.$inferSelect;
export type OrgRole = OrgMember["role"];
export type OrgInvite = typeof orgInvite.$inferSelect;
