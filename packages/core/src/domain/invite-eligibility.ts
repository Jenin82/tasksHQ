import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { can } from "../access";
import { user } from "../schema/auth";
import { teamInvite, teamMember } from "../schema/team";

export function inviterStillManagesTeam(db: DrizzleD1Database) {
  const roles = teamMember.role.enumValues.filter((role) => can(role, "team:manage_members"));
  return exists(db.select({ userId: teamMember.userId }).from(teamMember).where(and(
    eq(teamMember.teamId, teamInvite.teamId),
    eq(teamMember.userId, teamInvite.invitedByUserId),
    inArray(teamMember.role, roles),
    or(eq(teamMember.role, "owner"), sql`${teamInvite.role} <> 'owner'`),
  )));
}

export function verifiedInviteRecipient(db: DrizzleD1Database, userId: string, email: string) {
  return exists(db.select({ id: user.id }).from(user).where(and(
    eq(user.id, userId),
    eq(user.emailVerified, true),
    sql`lower(${user.email}) = ${email}`,
  )));
}

export async function hasEligibleInvite(db: DrizzleD1Database, email: string) {
  const pending = await db.select({ id: teamInvite.teamId }).from(teamInvite).where(and(
    eq(teamInvite.email, email.trim().toLowerCase()),
    isNull(teamInvite.acceptedAt),
    inviterStillManagesTeam(db),
  )).get();
  return Boolean(pending);
}
