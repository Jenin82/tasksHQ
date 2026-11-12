import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import { AccessError, requireProjectMember } from "@tasks/core/access";
import { inviterStillManagesOrg, taskKey } from "@tasks/core/domain";
import { comment, mailOutbox, org, orgInvite, orgMember, project, task, user, type MailJob } from "@tasks/core/schema";
import type { MailMessage } from "./smtp";

const MAX_ATTEMPTS = 5;
const LEASE_TIME = 2 * 60_000;
const mentionRecipient = alias(user, "mention_recipient");

async function mailForJob(db: DrizzleD1Database, origin: string, job: MailJob): Promise<MailMessage | null> {
  // Older deployments may have queued these before invitations moved to the organization.
  if (job.kind === "project_invite" || job.kind === "project_added") return null;

  const app = new URL("/", origin).href;
  if (job.kind === "org_invite") {
    if (!job.inviteVersion) return null;
    const active = await db.select({ email: orgInvite.email }).from(orgInvite).where(and(
      eq(orgInvite.orgId, job.targetId), eq(orgInvite.email, job.recipient),
      eq(orgInvite.createdAt, job.inviteVersion), isNull(orgInvite.acceptedAt),
      inviterStillManagesOrg(db),
    )).get();
    return active ? {
      to: active.email,
      subject: "You’re invited to TasksHQ",
      text: `Open TasksHQ and sign in or sign up with this email address to accept your invitation.\n\n${app}`,
    } : null;
  }

  if (job.kind === "comment_mention") {
    const target = await db.select({
      body: comment.body, mentions: comment.mentions, author: user.name, title: task.title, email: mentionRecipient.email,
      number: task.number, projectKey: project.key, projectSlug: project.slug, orgSlug: org.slug,
    }).from(comment)
      .innerJoin(task, eq(task.id, comment.taskId))
      .innerJoin(project, eq(project.id, task.projectId))
      .innerJoin(org, eq(org.id, project.orgId))
      .innerJoin(user, eq(user.id, comment.userId))
      .innerJoin(orgMember, and(eq(orgMember.orgId, org.id), eq(orgMember.userId, job.recipient)))
      .innerJoin(mentionRecipient, and(eq(mentionRecipient.id, orgMember.userId), eq(mentionRecipient.emailVerified, true)))
      .where(eq(comment.id, job.targetId)).get();
    if (!target?.mentions?.some(({ userId }) => userId === job.recipient)) return null;

    const key = taskKey(target.projectKey, target.number);
    const href = new URL(`/${target.orgSlug}/${target.projectSlug}/${key}`, app).href;
    return {
      to: target.email,
      subject: `You were mentioned in ${key}`,
      text: `${target.author} mentioned you in a comment on ${key} · ${target.title}\n\n${target.body}\n\nOpen work item\n${href}`,
    };
  }

  const recipient = await db.select({ email: user.email }).from(user)
    .where(and(eq(user.id, job.recipient), eq(user.emailVerified, true))).get();
  if (!recipient) return null;

  const target = await db.select({
    title: task.title, number: task.number, projectId: project.id, projectKey: project.key,
    projectSlug: project.slug, orgSlug: org.slug, assignee: task.assigneeUserId,
  }).from(task).innerJoin(project, eq(task.projectId, project.id)).innerJoin(org, eq(project.orgId, org.id))
    .where(and(eq(task.id, job.targetId), isNull(task.archivedAt))).get();
  if (!target || (job.kind === "assignment" && target.assignee !== job.recipient)) return null;
  try {
    await requireProjectMember(db, target.projectId, job.recipient);
  } catch (error) {
    if (error instanceof AccessError) return null;
    throw error;
  }

  const key = taskKey(target.projectKey, target.number);
  const href = new URL(`/${target.orgSlug}/${target.projectSlug}/${key}`, app).href;
  const subject = job.kind === "assignment" ? `Assigned to you: ${key}` : `Task updated: ${key}`;
  return { to: recipient.email, subject, text: `${subject}\n${target.title}\n\n${href}` };
}

export async function drainMailOutbox(
  db: DrizzleD1Database,
  origin: string,
  send: (message: MailMessage) => Promise<void>,
) {
  const now = Date.now();
  const jobs = await db.select().from(mailOutbox).where(lte(mailOutbox.readyAt, now))
    .orderBy(asc(mailOutbox.readyAt)).limit(20);

  async function deliver(job: MailJob) {
    const leaseId = crypto.randomUUID();
    const [leased] = await db.update(mailOutbox)
      .set({ leaseId, readyAt: now + LEASE_TIME, attempts: job.attempts + 1 })
      .where(and(eq(mailOutbox.id, job.id), lte(mailOutbox.readyAt, now)))
      .returning({ id: mailOutbox.id });
    if (!leased) return;
    const lease = and(eq(mailOutbox.id, job.id), eq(mailOutbox.leaseId, leaseId));
    try {
      if (job.attempts >= MAX_ATTEMPTS) {
        console.error("Mail attempts exhausted", { id: job.id, kind: job.kind });
      } else {
        const message = await mailForJob(db, origin, job);
        if (message) await send({ ...message, messageId: job.id });
      }
    } catch {
      if (job.attempts + 1 < MAX_ATTEMPTS) {
        await db.update(mailOutbox)
          .set({ leaseId: null, readyAt: Date.now() + 60_000 * 2 ** job.attempts })
          .where(lease);
        return;
      }
      console.error("Mail delivery failed", { id: job.id, kind: job.kind });
    }
    await db.delete(mailOutbox).where(lease);
  }

  for (let start = 0; start < jobs.length; start += 4) {
    await Promise.all(jobs.slice(start, start + 4).map(deliver));
  }
}
