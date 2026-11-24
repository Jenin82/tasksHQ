import { asc, count, eq } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { listProjectTaskTypes } from "@tasks/core/domain";
import { canProject } from "@tasks/core/access";
import { status as statusTable, task as taskTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { StatusList, type SettingsStatus } from "../status-list";
import { TaskTypeList } from "../task-type-list";

export default async function ProjectWorkflowSettingsPage({
  params,
}: {
  params: Promise<{ team: string; project: string }>;
}) {
  const { team: teamSlug, project: projectSlug } = await params;
  // Re-checked here, not inherited from the layout: a layout is not a
  // security boundary and every read re-proves reach independently (§4.6).
  const { team, project, user, member, projectRole } = await getProjectContext(
    teamSlug,
    projectSlug,
  );

  if (!canProject(member.role, projectRole, "project:manage_statuses")) forbidden();

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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-10">
      <section className="rounded-2xl bg-card p-6 shadow-subtle">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="text-xl">Statuses</h2>
          <span className="stutter numeral">{statuses.length}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Each status has its own board column. Click a dot to change its color.
        </p>

        <StatusList
          teamSlug={team.slug}
          projectSlug={project.slug}
          statuses={statuses}
          canManage
        />
      </section>

      <TaskTypeList teamSlug={team.slug} projectSlug={project.slug} types={taskTypes} canManage />
    </div>
  );
}
