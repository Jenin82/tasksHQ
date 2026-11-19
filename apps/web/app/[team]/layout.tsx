import { and, asc, eq } from "drizzle-orm";
import { can, canProject } from "@tasks/core/access";
import { getRunningTimer } from "@tasks/core/domain";
import { teamReportingLine, project, projectMember } from "@tasks/core/schema";
import { TopBar } from "@/components/top-bar";
import { WorkspaceShell } from "@/components/workspace-shell";
import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/org-context";
import { getTeamContext, listUserTeams } from "@/lib/team-context";

export default async function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ team: string }>;
}) {
  const { team: slug } = await params;
  const { team, member, user } = await getTeamContext(slug);

  const [teams, orgMembership, projectRows, reports, runningTimer] = await Promise.all([
    listUserTeams(user.id),
    getOrgMembership(user.id),
    db.select({ slug: project.slug, name: project.name, key: project.key, role: projectMember.role })
      .from(project)
      .leftJoin(projectMember, and(
        eq(projectMember.projectId, project.id),
        eq(projectMember.teamId, team.id),
        eq(projectMember.userId, user.id),
        eq(projectMember.role, "admin"),
      ))
      .where(eq(project.teamId, team.id))
      .orderBy(asc(project.name)),
    db.select({ userId: teamReportingLine.userId })
      .from(teamReportingLine)
      .where(and(eq(teamReportingLine.teamId, team.id), eq(teamReportingLine.leadUserId, user.id)))
      .limit(1),
    getRunningTimer({ db, actorUserId: user.id, source: "web" }),
  ]);
  const projects = projectRows.map(({ role, ...item }) => ({
    ...item,
    canManageSettings: canProject(member.role, role, "project:manage_statuses"),
  }));

  return (
    <WorkspaceShell
      key={team.slug}
      team={team.slug}
      org={{ canManage: orgMembership.canManage }}
      projects={projects}
      canManageWorkspace={can(member.role, "team:manage_members")}
      teams={teams.map(({ slug, name, implicit }) => ({ slug, name, member: !implicit }))}
      hasReports={reports.length > 0}
      canViewTimeReports={!member.implicit && can(member.role, "team:view_time_reports")}
      header={
        <TopBar
          team={{ slug: team.slug, name: team.name }}
          role={member.role}
          projects={projects}
          user={{ name: user.name, email: user.email, image: user.image }}
          runningTimer={runningTimer}
        />
      }
    >
      {children}
    </WorkspaceShell>
  );
}
