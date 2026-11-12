import { asc, eq } from "drizzle-orm";
import { canEditAnyTask, canEditTask, canProject } from "@tasks/core/access";
import { listTasks } from "@tasks/core/domain";
import { status as statusTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { shortDate } from "@/lib/format";
import { getProjectContext } from "@/lib/project-context";
import { Board, type BoardCard } from "./board";
import { NoStatuses } from "./no-statuses";

export default async function BoardPage({
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

  // `includeArchived` defaults false, and the rows arrive ordered
  // `(position, id)` — the board's order is the domain layer's order.
  const [statuses, tasks] = await Promise.all([
    db.select({ id: statusTable.id, name: statusTable.name, color: statusTable.color })
      .from(statusTable)
      .where(eq(statusTable.projectId, project.id))
      .orderBy(asc(statusTable.position), asc(statusTable.id)),
    listTasks({ db, actorUserId: user.id, source: "web" }, { projectId: project.id }),
  ]);

  const canEditAny = canEditAnyTask({ project, member, projectRole });
  const cards: BoardCard[] = tasks.map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    statusId: t.status.id,
    assignee: t.assignee,
    createdBy: t.createdBy,
    canEdit: canEditTask(canEditAny, user.id, t.createdBy.id, t.assignee?.id),
    dueDate: t.dueDate,
    priority: t.priority,
    type: t.type,
    updated: shortDate(t.updatedAt),
  }));

  if (statuses.length === 0) {
    // §3's one matrix, so the state names who can fix it.
    return <NoStatuses canManage={canProject(member.role, projectRole, "project:manage_statuses")} />;
  }

  return (
    <Board orgSlug={org.slug} projectSlug={project.slug} statuses={statuses} cards={cards} />
  );
}
