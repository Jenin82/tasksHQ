import { and, eq, exists, inArray, notExists, sql } from "drizzle-orm";
import { AccessError, can, requireCapability, requireOrgMember } from "../access";
import type { DomainContext } from "../activity";
import { DomainError, isConstraintError } from "../errors";
import { orgMember, orgReportingLine } from "../schema/org";

export async function setReportingLead(
  { db, actorUserId }: DomainContext,
  { orgId, userId, leadUserId, expectedLeadUserId }: {
    orgId: string;
    userId: string;
    leadUserId: string | null;
    expectedLeadUserId?: string | null;
  },
) {
  const actor = await requireOrgMember(db, orgId, actorUserId);
  requireCapability(actor.role, "org:manage_members");

  const stillPermitted = exists(db.select({ userId: orgMember.userId }).from(orgMember)
    .where(and(
      eq(orgMember.orgId, orgId),
      eq(orgMember.userId, actorUserId),
      inArray(orgMember.role, orgMember.role.enumValues.filter((role) => can(role, "org:manage_members"))),
    )));

  if (leadUserId === null) {
    if (expectedLeadUserId === null) return;
    const result = await db.delete(orgReportingLine).where(and(
      eq(orgReportingLine.orgId, orgId),
      eq(orgReportingLine.userId, userId),
      typeof expectedLeadUserId === "string" ? eq(orgReportingLine.leadUserId, expectedLeadUserId) : undefined,
      stillPermitted,
    ));
    if (typeof expectedLeadUserId === "string" && result.meta.changes === 0) {
      const current = await requireOrgMember(db, orgId, actorUserId);
      requireCapability(current.role, "org:manage_members");
      throw new DomainError("This reporting line changed. Refresh the page and try again.");
    }
    return;
  }
  if (leadUserId === userId) throw new DomainError("A person cannot be their own lead.");

  const currentLine = db.select({ leadUserId: orgReportingLine.leadUserId }).from(orgReportingLine)
    .where(and(eq(orgReportingLine.orgId, orgId), eq(orgReportingLine.userId, userId)));
  const matchesExpectedLead = expectedLeadUserId === undefined
    ? sql`1`
    : expectedLeadUserId === null
      ? notExists(currentLine)
      : sql`${currentLine} = ${expectedLeadUserId}`;

  try {
    // Check and write in one statement so concurrent edits cannot form a
    // cycle. UNION also bounds traversal if legacy data ever contains one.
    const result = await db.run(sql`
      with recursive reporting_chain(id) as (
        select ${leadUserId}
        union
        select line.lead_user_id
        from ${orgReportingLine} as line
        join reporting_chain on reporting_chain.id = line.user_id
        where line.org_id = ${orgId}
      )
      insert into ${orgReportingLine} (org_id, user_id, lead_user_id)
      select ${orgId}, ${userId}, ${leadUserId}
      where ${stillPermitted}
        and ${matchesExpectedLead}
        and not exists (select 1 from reporting_chain where id = ${userId})
      on conflict (org_id, user_id) do update set lead_user_id = excluded.lead_user_id
    `);
    if (result.meta.changes === 0) {
      const current = await requireOrgMember(db, orgId, actorUserId);
      if (!can(current.role, "org:manage_members")) {
        throw new AccessError("forbidden", "You cannot manage reporting lines.");
      }
      if (expectedLeadUserId !== undefined) {
        const [line] = await currentLine;
        if ((line?.leadUserId ?? null) !== expectedLeadUserId) {
          throw new DomainError("This reporting line changed. Refresh the page and try again.");
        }
      }
      throw new DomainError("This reporting line would create a cycle.");
    }
  } catch (error) {
    if (isConstraintError(error, "FOREIGN KEY")) {
      throw new DomainError("Both people must be members of this organization.");
    }
    throw error;
  }
}
