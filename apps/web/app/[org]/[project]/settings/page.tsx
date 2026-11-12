import { and, asc, count, eq } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { listProjectTaskTypes, readProjectSlack } from "@tasks/core/domain";
import { can, canProject } from "@tasks/core/access";
import {
  orgMember,
  projectMember,
  status as statusTable,
  task as taskTable,
  user as userTable,
} from "@tasks/core/schema";
import { DeleteSettingsSection } from "@/components/delete-settings-section";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { deleteProjectAction } from "./actions";
import { ProjectAdminList } from "./project-admin-list";
import { SlackIntegration } from "./slack-integration";
import { TaskEditingSettings } from "./task-editing-settings";
import { StatusList, type SettingsStatus } from "./status-list";
import { TaskTypeList } from "./task-type-list";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  // Re-checked here, not inherited from the layout: a layout is not a
  // security boundary and every read re-proves reach independently (§4.6).
  const { org, project, user, member, projectRole } = await getProjectContext(
    orgSlug,
    projectSlug,
  );

  if (!canProject(member.role, projectRole, "project:manage_statuses")) forbidden();
  const canManageRoles = can(member.role, "org:change_role");

  const statuses: SettingsStatus[] = await db
    .select({
      id: statusTable.id,
      name: statusTable.name,
      color: statusTable.color,
      // Archived tasks included: `deleteStatus` counts every row pointing at
      // the status, so this is the number that actually blocks a delete.
      taskCount: count(taskTable.id),
    })
    .from(statusTable)
    .leftJoin(taskTable, eq(taskTable.statusId, statusTable.id))
    .where(eq(statusTable.projectId, project.id))
    .groupBy(statusTable.id)
    .orderBy(asc(statusTable.position), asc(statusTable.id));

  const taskTypes = await listProjectTaskTypes({ db, actorUserId: user.id, source: "web" }, { projectId: project.id });

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
  const slack = await readProjectSlack({ db, actorUserId: user.id, source: "web" }, { projectId: project.id });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-10">
      <TaskEditingSettings orgSlug={org.slug} projectSlug={project.slug} restricted={project.restrictTaskEdits} />
      <section className="rounded-2xl bg-card p-6 shadow-subtle">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="text-xl">Statuses</h2>
          <span className="stutter numeral">{statuses.length}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Each status has its own board column. Click a dot to change its color.
        </p>

        <StatusList
          orgSlug={org.slug}
          projectSlug={project.slug}
          statuses={statuses}
          canManage
        />
      </section>

      <TaskTypeList orgSlug={org.slug} projectSlug={project.slug} types={taskTypes} canManage />

      <section className="mt-8 rounded-2xl bg-card p-6 shadow-subtle">
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
      {slack && <SlackIntegration orgSlug={org.slug} projectSlug={project.slug} {...slack} />}
      {can(member.role, "project:delete") && (
        <DeleteSettingsSection
          resource="project"
          name={project.name}
          slug={project.slug}
          description="All tasks, comments, and project history will also be deleted."
          action={deleteProjectAction.bind(null, org.slug, project.slug, project.id)}
        />
      )}
    </div>
  );
}
