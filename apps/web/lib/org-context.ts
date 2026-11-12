import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AccessError, requireOrgMember } from "@tasks/core/access";
import type { Org, OrgMember } from "@tasks/core/schema";
import { org, orgMember } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/session";

export type OrgContext = {
  user: SessionUser;
  org: Org;
  member: OrgMember;
};

export const listUserOrganizations = cache(async function listUserOrganizations(userId: string) {
  return db.select({ id: org.id, slug: org.slug, name: org.name, role: orgMember.role })
    .from(orgMember)
    .innerJoin(org, eq(org.id, orgMember.orgId))
    .where(eq(orgMember.userId, userId))
    .orderBy(asc(org.name), asc(org.id));
});

/**
 * Resolves an org slug to the org and the caller's membership, for the
 * `/[org]` layout and every page under it.
 *
 * PLAN §4.6: a non-member gets `notFound()`, not 403, so org slugs are not
 * enumerable — an unknown slug and a slug the caller cannot reach are the same
 * response. Capability denials (403) come from the domain layer instead, where
 * the caller is already known to be a member.
 */
export const getOrgContext = cache(async function getOrgContext(slug: string): Promise<OrgContext> {
  const user = await requireUser();

  const [row] = await db.select().from(org).where(eq(org.slug, slug));
  if (!row) notFound();

  try {
    const member = await requireOrgMember(db, row.id, user.id);
    return { user, org: row, member };
  } catch (error) {
    if (error instanceof AccessError && error.reason === "not_a_member") {
      notFound();
    }
    throw error;
  }
});
