import { and, eq, exists, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { AccessError, can, requireCapability, requireOrgMember, requireProjectMember } from "../access";
import type { DomainContext } from "../activity";
import { DomainError } from "../errors";
import { activity, comment, org, orgInvite, orgMember, project, projectMember, status, task } from "../schema";
import { taskKey } from "./task";

function stillOwner({ db, actorUserId }: DomainContext, orgId: string) {
  return exists(
    db.select({ userId: orgMember.userId }).from(orgMember).where(and(
      eq(orgMember.orgId, orgId),
      eq(orgMember.userId, actorUserId),
      eq(orgMember.role, "owner"),
    )),
  );
}

function projectDeletes({ db }: DomainContext, scope: SQL) {
  const projectIds = db.select({ id: project.id }).from(project).where(scope);
  const taskIds = db.select({ id: task.id }).from(task).where(inArray(task.projectId, projectIds));

  return [
    db.delete(comment).where(inArray(comment.taskId, taskIds)),
    db.delete(activity).where(inArray(activity.projectId, projectIds)),
    db.delete(task).where(inArray(task.projectId, projectIds)),
    db.delete(status).where(inArray(status.projectId, projectIds)),
    db.delete(projectMember).where(inArray(projectMember.projectId, projectIds)),
  ] as const;
}

function requireConfirmation(slug: string, confirmation: string) {
  if (confirmation !== slug) {
    throw new DomainError("Enter the slug exactly as shown to confirm deletion.");
  }
}

// Activity belongs to a project by foreign key. Hard deletion removes that
// history along with the project and leaves no project activity row behind.
export async function deleteProject(
  ctx: DomainContext,
  { projectId, confirmation }: { projectId: string; confirmation: string },
) {
  const { db, actorUserId } = ctx;
  const { project: row, member } = await requireProjectMember(db, projectId, actorUserId);
  requireCapability(member.role, "project:delete");
  requireConfirmation(row.slug, confirmation);

  const scope = and(eq(project.id, projectId), stillOwner(ctx, row.orgId))!;
  const [, , , , , deleted] = await db.batch([
    ...projectDeletes(ctx, scope),
    db.delete(project).where(scope).returning({ id: project.id }),
  ]);
  if (!deleted.length) throw new AccessError("forbidden", "The project could not be deleted.");
}

export async function deleteOrg(
  ctx: DomainContext,
  { orgId, confirmation }: { orgId: string; confirmation: string },
) {
  const { db, actorUserId } = ctx;
  const member = await requireOrgMember(db, orgId, actorUserId);
  requireCapability(member.role, "org:delete");
  const [row] = await db.select({ slug: org.slug }).from(org).where(eq(org.id, orgId));
  if (!row) throw new AccessError("not_a_member", "No such organization.");
  requireConfirmation(row.slug, confirmation);

  // Re-check ownership inside the batch. The final delete uses changes()
  // because the preceding statement has already removed the owner.
  const owner = stillOwner(ctx, orgId);
  const scope = and(eq(project.orgId, orgId), owner)!;
  const [, , , , , , , , , deleted] = await db.batch([
    ...projectDeletes(ctx, scope),
    db.delete(project).where(scope),
    db.delete(orgInvite).where(and(eq(orgInvite.orgId, orgId), owner)),
    db.delete(orgMember).where(and(
      eq(orgMember.orgId, orgId),
      ne(orgMember.userId, actorUserId),
      owner,
    )),
    db.delete(orgMember).where(and(
      eq(orgMember.orgId, orgId),
      eq(orgMember.userId, actorUserId),
      eq(orgMember.role, "owner"),
    )),
    db.delete(org).where(and(eq(org.id, orgId), sql`changes() > 0`)).returning({ id: org.id }),
  ]);
  if (!deleted.length) throw new AccessError("forbidden", "The organization could not be deleted.");
}

const TASK_DELETE_CAPABILITY = "task:delete_archived";

export async function deleteArchivedTask(
  ctx: DomainContext,
  { projectId, taskId, confirmation }: { projectId: string; taskId: string; confirmation: string },
) {
  const { db, actorUserId } = ctx;
  const { project: currentProject, member } = await requireProjectMember(db, projectId, actorUserId);
  requireCapability(member.role, TASK_DELETE_CAPABILITY);

  const identity = and(eq(task.id, taskId), eq(task.projectId, projectId));
  const [row] = await db.select({ number: task.number, archivedAt: task.archivedAt })
    .from(task).where(identity);
  if (!row) throw new AccessError("not_a_member", "No such task.");
  if (!row.archivedAt) throw new DomainError("Archive this task before deleting it permanently.");
  if (confirmation !== taskKey(currentProject.key, row.number)) {
    throw new DomainError("Enter the task key exactly as shown to confirm deletion.");
  }

  const permittedRoles = orgMember.role.enumValues.filter((role) => can(role, TASK_DELETE_CAPABILITY));
  const stillPermitted = exists(db.select({ userId: orgMember.userId }).from(orgMember).where(and(
    eq(orgMember.orgId, currentProject.orgId),
    eq(orgMember.userId, actorUserId),
    inArray(orgMember.role, permittedRoles),
  )));
  const scope = and(identity, eq(task.number, row.number), isNotNull(task.archivedAt), stillPermitted);
  const archivedTask = db.select({ id: task.id }).from(task).where(scope);

  // Repeat the guarded scope for all writes. A restore, transfer or role change before
  // the batch starts must leave the task, its comments, and its history intact.
  // Task history is removed with the task, like project history on deletion.
  const [, , deleted] = await db.batch([
    db.delete(comment).where(inArray(comment.taskId, archivedTask)),
    db.delete(activity).where(inArray(activity.taskId, archivedTask)),
    db.delete(task).where(scope).returning({ id: task.id }),
  ]);
  if (!deleted.length) {
    const { member: currentMember } = await requireProjectMember(db, projectId, actorUserId);
    requireCapability(currentMember.role, TASK_DELETE_CAPABILITY);
    throw new DomainError("This archived task is no longer available for deletion.");
  }
}
