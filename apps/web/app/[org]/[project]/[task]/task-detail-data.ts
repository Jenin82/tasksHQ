import { asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { AccessError, canEditAnyTask, canEditTask } from "@tasks/core/access";
import { findMovedTaskByKey, getTaskByKey, listProjectTaskTypes, listTaskMoveProjects, type TaskTypeRef, type TaskWithHistory } from "@tasks/core/domain";
import { status as statusTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { organizationAssignablePeople } from "@/lib/organization-assignable-people";
import type { FieldPerson, FieldStatus, TaskFieldsIds } from "./task-fields";

export type TaskDetailData = {
  detail: TaskWithHistory;
  canEdit: boolean;
  statuses: FieldStatus[];
  taskTypes: TaskTypeRef[];
  assignable: FieldPerson[];
  detached: FieldPerson | null;
  ids: TaskFieldsIds;
  moveTargets: { id: string; name: string }[];
};

export async function readTaskDetail(
  orgSlug: string,
  projectSlug: string,
  taskKey: string,
  followMoved = true,
): Promise<TaskDetailData> {
  // Re-checked here, not inherited from the layout: a layout is not a
  // security boundary and every read re-proves reach independently (§4.6).
  const access = await getProjectContext(orgSlug, projectSlug);
  const { org, project, user } = access;
  const ctx = { db, actorUserId: user.id, source: "web" as const };

  let detail: TaskWithHistory;
  try {
    // §3 derives the key at read time, so resolving the URL parses it back.
    // An unparseable key, a key naming another project and a task that is not
    // there all arrive here as the same `AccessError` — so a 404 for a key
    // that cannot exist is indistinguishable from one for a task this caller
    // may not see, which is the contract the whole app keeps (§4.6).
    detail = await getTaskByKey(ctx, {
      projectId: project.id,
      key: taskKey,
    });
  } catch (error) {
    if (error instanceof AccessError && error.reason === "not_a_member") {
      if (followMoved) {
        const moved = await findMovedTaskByKey(ctx, { projectId: project.id, key: taskKey }).catch((cause) => {
          if (cause instanceof AccessError && cause.reason === "not_a_member") return null;
          throw cause;
        });
        if (moved) redirect(`/${org.slug}/${moved.projectSlug}/${moved.key}`);
      }
      notFound();
    }
    throw error;
  }

  const canEdit = canEditTask(canEditAnyTask(access), user.id, detail.createdBy.id, detail.assignee?.id);
  // Keep the organization roster available for comment mentions.
  const [statuses, assignable, taskTypes, moveTargets] = await Promise.all([
    canEdit ? db
      .select({ id: statusTable.id, name: statusTable.name, color: statusTable.color })
      .from(statusTable)
      .where(eq(statusTable.projectId, project.id))
      .orderBy(asc(statusTable.position), asc(statusTable.id)) : [],
    organizationAssignablePeople(org.id),
    canEdit ? listProjectTaskTypes(ctx, { projectId: project.id }) : [],
    canEdit ? listTaskMoveProjects(ctx, project.id) : [],
  ]);

  // Keep an existing assignment visible if its user is missing from the
  // current organization roster. That user cannot be selected again.
  const assignee = detail.assignee;
  const detached: FieldPerson | null =
    assignee && !assignable.some((p) => p.userId === assignee.id)
      ? { userId: assignee.id, name: assignee.displayName, image: assignee.image }
      : null;

  const ids = {
    orgSlug: org.slug,
    projectSlug: project.slug,
    taskId: detail.id,
  };

  return { detail, canEdit, statuses, taskTypes, assignable, detached, ids, moveTargets };
}
