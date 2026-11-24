import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import { can, canOrg, teamAccess } from "../access";
import { user } from "../schema/auth";
import { orgInvite, orgMember } from "../schema/org";
import { teamInvite, teamMember } from "../schema/team";

/** The inviter still manages the team (really or as org owner/admin). */
export function inviterStillManagesTeam() {
  const roles = teamMember.role.enumValues.filter((role) => can(role, "team:manage_members"));
  return inArray(teamAccess(teamInvite.teamId, teamInvite.invitedByUserId).role, roles);
}

const inviterOrgMember = alias(orgMember, "inviter_org_member");

/** The inviter is still an org owner/admin, and only an org owner grants org owner. */
export function inviterStillManagesOrg() {
  const roles = orgMember.role.enumValues.filter((role) => canOrg(role, "org:manage_members"));
  // Aliased, so it also nests in statements that write org_member.
  const role = sql`(select ${inviterOrgMember.role} from ${orgMember} ${sql.identifier("inviter_org_member")}
    where ${eq(inviterOrgMember.userId, orgInvite.invitedByUserId)})`;
  return and(
    inArray(role, roles),
    or(eq(role, "owner"), sql`${orgInvite.role} <> 'owner'`),
  )!;
}

export function verifiedInviteRecipient(db: DrizzleD1Database, userId: string, email: string) {
  return exists(db.select({ id: user.id }).from(user).where(and(
    eq(user.id, userId),
    eq(user.emailVerified, true),
    sql`lower(${user.email}) = ${email}`,
  )));
}

export async function hasEligibleInvite(db: DrizzleD1Database, email: string) {
  const normalized = email.trim().toLowerCase();
  const [team, org] = await db.batch([
    db.select({ id: teamInvite.teamId }).from(teamInvite).where(and(
      eq(teamInvite.email, normalized),
      isNull(teamInvite.acceptedAt),
      inviterStillManagesTeam(),
    )).limit(1),
    db.select({ email: orgInvite.email }).from(orgInvite).where(and(
      eq(orgInvite.email, normalized),
      isNull(orgInvite.acceptedAt),
      inviterStillManagesOrg(),
    )),
  ]);
  return team.length > 0 || org.length > 0;
}
