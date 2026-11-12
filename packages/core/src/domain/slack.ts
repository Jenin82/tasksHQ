import { and, eq, exists, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { AccessError, canProject, requireProjectMember } from "../access";
import type { DomainContext } from "../activity";
import { DomainError } from "../errors";
import { user } from "../schema/auth";
import { orgMember } from "../schema/org";
import { project, projectMember, status } from "../schema/project";
import { projectSlack, slackOutbox } from "../schema/slack";
import { task } from "../schema/task";

const manageCapability = "project:manage_members";

async function requireSlackManager(ctx: DomainContext, projectId: string) {
  const { member, projectRole } = await requireProjectMember(ctx.db, projectId, ctx.actorUserId);
  if (!canProject(member.role, projectRole, manageCapability)) {
    throw new AccessError("forbidden", "You cannot manage integrations for this project.");
  }
}

function stillManagesSlack(ctx: DomainContext, projectId: string) {
  const orgRoles = orgMember.role.enumValues.filter((role) => canProject(role, null, manageCapability));
  const directRoles = projectMember.role.enumValues.filter((role) => canProject("member", role, manageCapability));
  return exists(ctx.db.select({ id: project.id }).from(project).innerJoin(orgMember, and(
    eq(orgMember.orgId, project.orgId), eq(orgMember.userId, ctx.actorUserId),
  )).where(and(eq(project.id, projectId), or(
    inArray(orgMember.role, orgRoles),
    exists(ctx.db.select({ userId: projectMember.userId }).from(projectMember).where(and(
      eq(projectMember.projectId, project.id), eq(projectMember.orgId, project.orgId),
      eq(projectMember.userId, ctx.actorUserId), inArray(projectMember.role, directRoles),
    ))),
  ))));
}

export async function readProjectSlack(ctx: DomainContext, { projectId }: { projectId: string }) {
  await requireSlackManager(ctx, projectId);
  const [integration] = await ctx.db.select({ lastError: projectSlack.lastError })
    .from(projectSlack).where(eq(projectSlack.projectId, projectId));
  return { connected: !!integration, lastError: integration?.lastError ?? null };
}

export async function saveProjectSlack(
  ctx: DomainContext,
  { projectId, encryptedWebhook }: { projectId: string; encryptedWebhook: string },
) {
  await requireSlackManager(ctx, projectId);
  const revision = crypto.randomUUID();
  const settings = { revision, encryptedWebhook, lastError: null };
  const [saved] = await ctx.db.batch([
    ctx.db.insert(projectSlack).select(sql`
      select ${projectId}, ${revision}, ${encryptedWebhook}, null where ${stillManagesSlack(ctx, projectId)}
    `).onConflictDoUpdate({
      target: projectSlack.projectId,
      set: settings,
    }).returning({ revision: projectSlack.revision }),
    ctx.db.delete(slackOutbox).where(and(
      eq(slackOutbox.projectId, projectId), ne(slackOutbox.revision, revision),
      exists(ctx.db.select({ id: projectSlack.projectId }).from(projectSlack).where(and(
        eq(projectSlack.projectId, projectId), eq(projectSlack.revision, revision),
      ))),
    )),
  ]);
  if (!saved.length) throw new AccessError("forbidden", "You cannot manage integrations for this project.");
}

export async function disconnectProjectSlack(ctx: DomainContext, { projectId }: { projectId: string }) {
  await requireSlackManager(ctx, projectId);
  const [deleted] = await ctx.db.delete(projectSlack)
    .where(and(eq(projectSlack.projectId, projectId), stillManagesSlack(ctx, projectId)))
    .returning({ id: projectSlack.projectId });
  if (!deleted) await requireSlackManager(ctx, projectId);
}

export async function queueSlackTest(ctx: DomainContext, { projectId }: { projectId: string }) {
  await requireSlackManager(ctx, projectId);
  const [job] = await ctx.db.insert(slackOutbox).select(sql`
    select null, ${projectSlack.projectId}, ${projectSlack.revision},
      json_object('type', 'test'), ${Date.now()}, 0, null
    from ${projectSlack} where ${projectSlack.projectId} = ${projectId} and ${stillManagesSlack(ctx, projectId)}
  `).returning({ id: slackOutbox.id });
  if (!job) {
    await requireSlackManager(ctx, projectId);
    throw new DomainError("Connect a Slack webhook first.");
  }
}

/** Call after creating a task or immediately before updating its status in the same batch. */
export function queueSlackTaskEvent(
  ctx: DomainContext,
  taskId: string,
  move?: { statusId: string; title?: string; scope?: SQL; fromStatus?: string },
) {
  return ctx.db.insert(slackOutbox).select(sql`
    select null, ${projectSlack.projectId}, ${projectSlack.revision},
      json_object(
        'type', ${move ? "status_changed" : "created"},
        'taskKey', ${project.key} || '-' || ${task.number},
        'title', ${move?.title ?? task.title},
        'actor', ${user.name},
        'toStatus', ${status.name}
        ${move ? sql`, 'fromStatus', ${move.fromStatus ??
          sql`(select ${status.name} from ${status} where ${status.id} = ${task.statusId})`}` : sql.empty()}
      ), ${Date.now()}, 0, null
    from ${task}
    inner join ${projectSlack} on ${projectSlack.projectId} = ${task.projectId}
    inner join ${project} on ${project.id} = ${task.projectId}
    inner join ${status} on ${status.id} = ${move?.statusId ?? task.statusId}
    inner join ${user} on ${user.id} = ${ctx.actorUserId}
    where ${task.id} = ${taskId}
      ${move && move.fromStatus === undefined ? sql`and ${task.statusId} <> ${move.statusId}` : sql.empty()}
      ${move?.scope ? sql`and ${move.scope}` : sql.empty()}
  `);
}
