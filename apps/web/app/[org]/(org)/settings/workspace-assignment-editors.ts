import { asc, eq } from "drizzle-orm";
import { canEditAnyTask, canProject, requireProjectMember } from "@tasks/core/access";
import { listProjectTaskTypes } from "@tasks/core/domain";
import { status } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { organizationAssignablePeople } from "@/lib/organization-assignable-people";
import type { AssignmentEditors } from "./workspace-assignment-table";

export async function readAssignmentEditors(
  orgId: string,
  actorUserId: string,
  tasks: { projectId: string }[],
): Promise<AssignmentEditors> {
  const projectIds = new Set(tasks.map(({ projectId }) => projectId));
  if (projectIds.size === 0) return {};
  const ctx = { db, actorUserId, source: "web" as const };
  const assignablePeople = organizationAssignablePeople(orgId).all();
  const entries = await Promise.all([...projectIds].map(async (projectId) => {
    const [statuses, people, taskTypes, access] = await Promise.all([
      db.select({ id: status.id, name: status.name, color: status.color })
        .from(status).where(eq(status.projectId, projectId)).orderBy(asc(status.position), asc(status.id)),
      assignablePeople,
      listProjectTaskTypes(ctx, { projectId }),
      requireProjectMember(db, projectId, actorUserId),
    ]);
    return [projectId, {
      statuses,
      people,
      taskTypes,
      canEditAnyTask: canEditAnyTask(access),
      canBulkEdit: canProject(access.member.role, access.projectRole, "project:manage_members"),
    }] as const;
  }));
  return Object.fromEntries(entries);
}
