import { and, asc, eq } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { can } from "@tasks/core/access";
import { teamMember, teamReportingLine, user as userTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getTeamContext } from "@/lib/team-context";
import { ReportingLines } from "./reporting-lines";

export default async function ReportingLinesPage({ params }: { params: Promise<{ team: string }> }) {
  const { team: slug } = await params;
  const { team, member } = await getTeamContext(slug);
  if (!can(member.role, "team:manage_members")) forbidden();

  const people = await db
    .select({
      userId: teamMember.userId,
      name: userTable.name,
      email: userTable.email,
      leadUserId: teamReportingLine.leadUserId,
    })
    .from(teamMember)
    .innerJoin(userTable, eq(userTable.id, teamMember.userId))
    .leftJoin(teamReportingLine, and(
      eq(teamReportingLine.teamId, teamMember.teamId),
      eq(teamReportingLine.userId, teamMember.userId),
    ))
    .where(eq(teamMember.teamId, team.id))
    .orderBy(asc(userTable.name), asc(userTable.email));

  return <ReportingLines teamSlug={team.slug} people={people} />;
}
