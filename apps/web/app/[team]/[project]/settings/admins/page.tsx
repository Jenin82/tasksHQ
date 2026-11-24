import { and, asc, eq } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { can, canProject } from "@tasks/core/access";
import { teamMember, projectMember, user as userTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { ProjectAdminList } from "../project-admin-list";

export default async function ProjectAdminsSettingsPage({
  params,
}: {
  params: Promise<{ team: string; project: string }>;
}) {
  const { team: teamSlug, project: projectSlug } = await params;
  // Re-checked here, not inherited from the layout: a layout is not a
  // security boundary and every read re-proves reach independently (§4.6).
  const { team, project, member, projectRole } = await getProjectContext(
    teamSlug,
    projectSlug,
  );

  if (!canProject(member.role, projectRole, "project:manage_statuses")) forbidden();
  const canManageRoles = can(member.role, "team:change_role");

  const people = await db.select({
    userId: teamMember.userId,
    name: userTable.name,
    email: userTable.email,
    projectRole: projectMember.role,
  })
    .from(teamMember)
    .innerJoin(userTable, eq(userTable.id, teamMember.userId))
    .leftJoin(projectMember, and(
      eq(projectMember.projectId, project.id),
      eq(projectMember.teamId, teamMember.teamId),
      eq(projectMember.userId, teamMember.userId),
      eq(projectMember.role, "admin"),
    ))
    .where(and(
      eq(teamMember.teamId, team.id),
      eq(teamMember.role, "member"),
      canManageRoles ? undefined : eq(projectMember.role, "admin"),
    ))
    .orderBy(asc(userTable.name), asc(teamMember.userId));
  const admins = people.filter(({ projectRole }) => projectRole === "admin");
  const candidates = canManageRoles ? people.filter(({ projectRole }) => projectRole === null) : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-10">
      <section className="rounded-2xl bg-card p-6 shadow-subtle">
        <h2 className="text-xl">Project admins</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Everyone in the team can access this project. Project admins can manage its settings.
        </p>
        <ProjectAdminList
          teamSlug={team.slug}
          projectSlug={project.slug}
          admins={admins}
          candidates={candidates}
          canManage={canManageRoles}
        />
      </section>
    </div>
  );
}
