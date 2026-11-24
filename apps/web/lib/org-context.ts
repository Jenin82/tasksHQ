import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { canOrg } from "@tasks/core/access";
import { org, orgMember, type OrgRole } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

/** The org's name and the user's org role, null outside the org. */
export const getOrgMembership = cache(async function getOrgMembership(userId: string) {
  const [[row], [member]] = await Promise.all([
    db.select({ name: org.name }).from(org).where(eq(org.id, "org")),
    db.select({ role: orgMember.role }).from(orgMember).where(eq(orgMember.userId, userId)),
  ]);
  const role: OrgRole | null = member?.role ?? null;
  return { name: row?.name ?? "", role, canManage: role !== null && canOrg(role, "org:manage_members") };
});

/**
 * For `/settings/*`: like getTeamContext, someone outside the org gets
 * notFound(), and capability denials are left to each page.
 */
export const getOrgContext = cache(async function getOrgContext() {
  const user = await requireUser();
  const membership = await getOrgMembership(user.id);
  if (!membership.role) notFound();
  return { user, org: { name: membership.name }, role: membership.role, canManage: membership.canManage };
});
