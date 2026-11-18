import { and, asc, eq } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { can, canProject } from "@tasks/core/access";
import { orgMember, projectMember, user as userTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { ProjectAdminList } from "../project-admin-list";

export default async function ProjectAdminsSettingsPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  // Re-checked here, not inherited from the layout: a layout is not a
  // security boundary and every read re-proves reach independently (§4.6).
  const { org, project, member, projectRole } = await getProjectContext(
    orgSlug,
    projectSlug,
  );

  if (!canProject(member.role, projectRole, "project:manage_statuses")) forbidden();
  const canManageRoles = can(member.role, "org:change_role");

  const people = await db.select({
    userId: orgMember.userId,
    name: userTable.name,
    email: userTable.email,
    projectRole: projectMember.role,
  })
    .from(orgMember)
    .innerJoin(userTable, eq(userTable.id, orgMember.userId))
    .leftJoin(projectMember, and(
      eq(projectMember.projectId, project.id),
      eq(projectMember.orgId, orgMember.orgId),
      eq(projectMember.userId, orgMember.userId),
      eq(projectMember.role, "admin"),
    ))
    .where(and(
      eq(orgMember.orgId, org.id),
      eq(orgMember.role, "member"),
      canManageRoles ? undefined : eq(projectMember.role, "admin"),
    ))
    .orderBy(asc(userTable.name), asc(orgMember.userId));
  const admins = people.filter(({ projectRole }) => projectRole === "admin");
  const candidates = canManageRoles ? people.filter(({ projectRole }) => projectRole === null) : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-10">
      <section className="rounded-2xl bg-card p-6 shadow-subtle">
        <h2 className="text-xl">Project admins</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Everyone in the organization can access this project. Project admins can manage its settings.
        </p>
        <ProjectAdminList
          orgSlug={org.slug}
          projectSlug={project.slug}
          admins={admins}
          candidates={candidates}
          canManage={canManageRoles}
        />
      </section>
    </div>
  );
}
