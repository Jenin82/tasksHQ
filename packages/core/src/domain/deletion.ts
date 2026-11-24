import { and, eq, exists, inArray, isNotNull, type SQL } from "drizzle-orm";
import {
  AccessError, can, requireCapability, requireOrgCapability, requireOrgMember, requireTeamMember,
  requireProjectMember, teamAccess,
} from "../access";
import type { DomainContext } from "../activity";
import { DomainError } from "../errors";
import { activity, comment, orgMember, team, teamInvite, teamMember, project, projectMember, status, task } from "../schema";
import { taskKey } from "./task";

/** A real team admin, or an org owner/admin (implicit team admin). */
function stillTeamAdmin({ actorUserId }: DomainContext, teamId: string) {
  return eq(teamAccess(teamId, actorUserId).role, "admin");
}

/** Only org owners delete teams (`org:delete_team`). */
function stillOrgOwner({ db, actorUserId }: DomainContext) {
  return exists(db.select({ userId: orgMember.userId }).from(orgMember)
    .where(and(eq(orgMember.userId, actorUserId), eq(orgMember.role, "owner"))));
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

  const scope = and(eq(project.id, projectId), stillTeamAdmin(ctx, row.teamId))!;
  const [, , , , , deleted] = await db.batch([
    ...projectDeletes(ctx, scope),
    db.delete(project).where(scope).returning({ id: project.id }),
  ]);
  if (!deleted.length) throw new AccessError("forbidden", "The project could not be deleted.");
}

export async function deleteTeam(
  ctx: DomainContext,
  { teamId, confirmation }: { teamId: string; confirmation: string },
) {
  const { db, actorUserId } = ctx;
  // Team access first, so a team the caller cannot open stays not_a_member.
  await requireTeamMember(db, teamId, actorUserId);
  requireOrgCapability((await requireOrgMember(db, actorUserId)).role, "org:delete_team");
  const [row] = await db.select({ slug: team.slug }).from(team).where(eq(team.id, teamId));
  if (!row) throw new AccessError("not_a_member", "No such team.");
  requireConfirmation(row.slug, confirmation);

  // Re-check the org owner role inside the batch on every statement.
  const owner = stillOrgOwner(ctx);
  const scope = and(eq(project.teamId, teamId), owner)!;
  const [, , , , , , , , deleted] = await db.batch([
    ...projectDeletes(ctx, scope),
    db.delete(project).where(scope),
    db.delete(teamInvite).where(and(eq(teamInvite.teamId, teamId), owner)),
    db.delete(teamMember).where(and(eq(teamMember.teamId, teamId), owner)),
    db.delete(team).where(and(eq(team.id, teamId), owner)).returning({ id: team.id }),
  ]);
  if (!deleted.length) throw new AccessError("forbidden", "The team could not be deleted.");
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

  const permittedRoles = teamMember.role.enumValues.filter((role) => can(role, TASK_DELETE_CAPABILITY));
  const stillPermitted = inArray(teamAccess(currentProject.teamId, actorUserId).role, permittedRoles);
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
