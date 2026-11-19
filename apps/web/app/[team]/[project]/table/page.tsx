import { asc, eq } from "drizzle-orm";
import { canEditAnyTask, canEditTask, canProject } from "@tasks/core/access";
import { listTasks } from "@tasks/core/domain";
import { status as statusTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { teamAssignablePeople } from "@/lib/team-assignable-people";
import { NoStatuses } from "../no-statuses";
import { toRows } from "./rows";
import { TaskTable } from "./task-table";

export default async function TablePage({
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

  const [statuses, tasks, people] = await Promise.all([
    db.select({ id: statusTable.id, name: statusTable.name, color: statusTable.color })
      .from(statusTable)
      .where(eq(statusTable.projectId, project.id))
      .orderBy(asc(statusTable.position), asc(statusTable.id)),
    listTasks({ db, actorUserId: user.id, source: "web" }, { projectId: project.id }),
    teamAssignablePeople(team.id),
  ]);

  if (statuses.length === 0) {
    // The same state the board renders, in the same words (§4.12's one voice).
    return <NoStatuses canManage={canProject(member.role, projectRole, "project:manage_statuses")} />;
  }

  const base = `/${team.slug}/${project.slug}`;
  const canEditAny = canEditAnyTask({ project, member, projectRole });
  const rows = toRows(tasks, statuses, base, (task) =>
    canEditTask(canEditAny, user.id, task.createdBy.id, task.assignee?.id, task.reportedBy.id),
  );
  return (
    <TaskTable canBulkEdit={canProject(member.role, projectRole, "project:manage_members")} statuses={statuses} people={people} rows={rows} boardHref={base} />
  );
}
