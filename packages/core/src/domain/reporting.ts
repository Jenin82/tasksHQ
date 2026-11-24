import { eq, sql } from "drizzle-orm";
import { AccessError, canOrg, requireOrgMember } from "../access";
import type { DomainContext } from "../activity";
import { DomainError, isConstraintError } from "../errors";
import { orgMember, reportingLine } from "../schema/org";

const orgManagerRoles = sql.join(
  orgMember.role.enumValues.filter((role) => canOrg(role, "org:manage_members")).map((role) => sql`${role}`),
  sql`, `,
);

/**
 * Set or clear a person's one org-wide lead. Only org owners/admins manage
 * lines; the role is rechecked inside the write, so a demotion or concurrent
 * edit refuses it.
 */
export async function setReportingLead(
  { db, actorUserId }: DomainContext,
  { userId, leadUserId, expectedLeadUserId }: {
    userId: string;
    leadUserId: string | null;
    expectedLeadUserId?: string | null;
  },
) {
  await requireOrgMember(db, actorUserId);
  if (leadUserId === userId) throw new DomainError("A person cannot be their own lead.");

  const currentLead = sql<string | null>`(select lead_user_id from ${reportingLine} where user_id = ${userId})`;
  const isOrgManager = sql`exists (
    select 1 from ${orgMember} where user_id = ${actorUserId} and role in (${orgManagerRoles})
  )`;
  const matchesExpectedLead = expectedLeadUserId === undefined
    ? sql`1`
    : expectedLeadUserId === null
      ? sql`${currentLead} is null`
      : sql`${currentLead} = ${expectedLeadUserId}`;

  const changed = () => new DomainError("This reporting line changed. Refresh the page and try again.");
  // Explains a refused write, in the order the guard's reasons matter.
  const diagnose = async () => {
    const [row] = await db.select({ role: orgMember.role, currentLead })
      .from(orgMember).where(eq(orgMember.userId, actorUserId));
    if (!row) throw new AccessError("not_a_member", "No such organization.");
    if (!canOrg(row.role, "org:manage_members")) {
      throw new AccessError("forbidden", "You cannot manage reporting lines.");
    }
    // Clearing a line that is already gone is done.
    if (leadUserId === null && row.currentLead === null) return;
    if (expectedLeadUserId !== undefined && row.currentLead !== expectedLeadUserId) throw changed();
    if (leadUserId === null) throw changed();
    throw new DomainError("This reporting line would create a cycle.");
  };

  if (leadUserId === null) {
    const result = await db.run(sql`
      delete from ${reportingLine}
      where user_id = ${userId} and ${matchesExpectedLead} and ${isOrgManager}
    `);
    if (result.meta.changes === 0) await diagnose();
    return;
  }

  try {
    // Check and write in one statement so concurrent edits cannot form a
    // cycle. UNION also bounds traversal if stored data ever contains one.
    const result = await db.run(sql`
      with recursive reporting_chain(id) as (
        select ${leadUserId}
        union
        select line.lead_user_id
        from ${reportingLine} as line
        join reporting_chain on reporting_chain.id = line.user_id
      )
      insert into ${reportingLine} (user_id, lead_user_id, created_at)
      select ${userId}, ${leadUserId}, ${Date.now()}
      where ${isOrgManager}
        and ${matchesExpectedLead}
        and not exists (select 1 from reporting_chain where id = ${userId})
      on conflict (user_id) do update set lead_user_id = excluded.lead_user_id
    `);
    if (result.meta.changes === 0) await diagnose();
  } catch (error) {
    if (isConstraintError(error, "FOREIGN KEY")) {
      throw new DomainError("Both people must be members of this organization.");
    }
    throw error;
  }
}
