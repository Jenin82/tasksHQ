import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { can } from "../access";
import { user } from "../schema/auth";
import { orgInvite, orgMember } from "../schema/org";

export function inviterStillManagesOrg(db: DrizzleD1Database) {
  const roles = orgMember.role.enumValues.filter((role) => can(role, "org:manage_members"));
  return exists(db.select({ userId: orgMember.userId }).from(orgMember).where(and(
    eq(orgMember.orgId, orgInvite.orgId),
    eq(orgMember.userId, orgInvite.invitedByUserId),
    inArray(orgMember.role, roles),
    or(eq(orgMember.role, "owner"), sql`${orgInvite.role} <> 'owner'`),
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
  const pending = await db.select({ id: orgInvite.orgId }).from(orgInvite).where(and(
    eq(orgInvite.email, email.trim().toLowerCase()),
    isNull(orgInvite.acceptedAt),
    inviterStillManagesOrg(db),
  )).get();
  return Boolean(pending);
}
