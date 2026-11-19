import { and, eq, exists, inArray, notExists, sql } from "drizzle-orm";
import { AccessError, can, requireCapability, requireTeamMember, teamAccess } from "../access";
import type { DomainContext } from "../activity";
import { DomainError, isConstraintError } from "../errors";
import { teamMember, teamReportingLine } from "../schema/team";

export async function setReportingLead(
  { db, actorUserId }: DomainContext,
  { teamId, userId, leadUserId, expectedLeadUserId }: {
    teamId: string;
    userId: string;
    leadUserId: string | null;
    expectedLeadUserId?: string | null;
  },
) {
  const actor = await requireTeamMember(db, teamId, actorUserId);
  requireCapability(actor.role, "team:manage_members");

  const stillPermitted = inArray(
    teamAccess(teamId, actorUserId).role,
    teamMember.role.enumValues.filter((role) => can(role, "team:manage_members")),
  );

  if (leadUserId === null) {
    if (expectedLeadUserId === null) return;
    const result = await db.delete(teamReportingLine).where(and(
      eq(teamReportingLine.teamId, teamId),
      eq(teamReportingLine.userId, userId),
      typeof expectedLeadUserId === "string" ? eq(teamReportingLine.leadUserId, expectedLeadUserId) : undefined,
      stillPermitted,
    ));
    if (typeof expectedLeadUserId === "string" && result.meta.changes === 0) {
      const current = await requireTeamMember(db, teamId, actorUserId);
      requireCapability(current.role, "team:manage_members");
      throw new DomainError("This reporting line changed. Refresh the page and try again.");
    }
    return;
  }
  if (leadUserId === userId) throw new DomainError("A person cannot be their own lead.");

  const currentLine = db.select({ leadUserId: teamReportingLine.leadUserId }).from(teamReportingLine)
    .where(and(eq(teamReportingLine.teamId, teamId), eq(teamReportingLine.userId, userId)));
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
        from ${teamReportingLine} as line
        join reporting_chain on reporting_chain.id = line.user_id
        where line.team_id = ${teamId}
      )
      insert into ${teamReportingLine} (team_id, user_id, lead_user_id)
      select ${teamId}, ${userId}, ${leadUserId}
      where ${stillPermitted}
        and ${matchesExpectedLead}
        and not exists (select 1 from reporting_chain where id = ${userId})
      on conflict (team_id, user_id) do update set lead_user_id = excluded.lead_user_id
    `);
    if (result.meta.changes === 0) {
      const current = await requireTeamMember(db, teamId, actorUserId);
      if (!can(current.role, "team:manage_members")) {
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
      throw new DomainError("Both people must be members of this team.");
    }
    throw error;
  }
}
