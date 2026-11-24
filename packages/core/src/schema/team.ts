import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const team = sqliteTable("team", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const teamMember = sqliteTable(
  "team_member",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    // Also the parent key of project_member's composite FK, so it must exist.
    uniqueIndex("team_member_team_id_user_id_unique").on(t.teamId, t.userId),
  ],
);

export const teamInvite = sqliteTable(
  "team_invite",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id),
    // Stored lowercased; lowercased on lookup too.
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("team_invite_team_id_email_unique").on(t.teamId, t.email),
    // claimInvites looks up by email alone on every session create. The unique
    // index above leads with teamId, so it cannot serve that lookup.
    index("team_invite_email_idx").on(t.email),
  ],
);

/**
 * @deprecated Unused since 0022 moved reporting lines to the org-wide
 * `reporting_line`. Kept so drizzle-kit emits no DROP; 0024 drops it.
 */
export const teamReportingLine = sqliteTable(
  "team_reporting_line",
  {
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    leadUserId: text("lead_user_id").notNull(),
  },
  (t) => [
    uniqueIndex("team_reporting_line_team_user_unique").on(t.teamId, t.userId),
    index("team_reporting_line_team_lead_idx").on(t.teamId, t.leadUserId),
    foreignKey({
      columns: [t.teamId, t.userId],
      foreignColumns: [teamMember.teamId, teamMember.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.teamId, t.leadUserId],
      foreignColumns: [teamMember.teamId, teamMember.userId],
    }).onDelete("cascade"),
  ],
);

export type Team = typeof team.$inferSelect;
export type NewTeam = typeof team.$inferInsert;
export type TeamMember = typeof teamMember.$inferSelect;
export type NewTeamMember = typeof teamMember.$inferInsert;
export type TeamInvite = typeof teamInvite.$inferSelect;
export type NewTeamInvite = typeof teamInvite.$inferInsert;
