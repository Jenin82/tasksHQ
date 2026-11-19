import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import {
  addComment,
  claimInvites,
  createProject,
  createTask,
  inviteToTeam,
  moveTask,
  removeTeamMember,
  revokeTeamInvite,
  setReportingLead,
  updateTask,
} from "@tasks/core/domain";
import { createTeam } from "./helpers";
import { mailOutbox, teamMember, projectInvite, projectMember, status, user } from "@tasks/core/schema";
import { drainMailOutbox } from "@/lib/mail-outbox";

const db = drizzle(env.DB);
const ownerId = "outbox-owner";
const reportId = "outbox-report";
const leadId = "outbox-lead";
const editorId = "outbox-editor";

await db.insert(user).values([ownerId, reportId, leadId, editorId].map((id) => ({
  id,
  name: id,
  email: `${id}@outbox.test`,
  emailVerified: true,
})));

function context(actorUserId = ownerId, emailNotifications = true, source: "web" | "mcp" = "web") {
  return { db, actorUserId, source, emailNotifications };
}

async function freshProject(slug: string) {
  const setup = context(ownerId, false);
  const team = await createTeam(setup, { slug, name: "Outbox workspace" });
  const project = await createProject(setup, { teamId: team.id, slug: "project", name: "Outbox project", key: "OUT" });
  const members = [reportId, leadId, editorId];
  await db.insert(teamMember).values(members.map((userId) => ({ teamId: team.id, userId, role: "member" as const, createdAt: new Date() })));
  const [todo, doing] = await db.select().from(status).where(eq(status.projectId, project.id)).orderBy(asc(status.position));
  return { team, project, todo, doing };
}

async function jobsFor(targetId: string) {
  return db.select().from(mailOutbox).where(eq(mailOutbox.targetId, targetId));
}

async function recipientsFor(targetId: string) {
  return (await jobsFor(targetId)).map(({ kind, recipient }) => `${kind}:${recipient}`).sort();
}

function taggedComment(recipients: string[]) {
  let body = "  👋 ";
  const mentions = recipients.map((userId) => {
    const start = body.length;
    body += `@${userId}`;
    const end = body.length;
    body += " ";
    return { userId, start, end };
  });
  return { body: `${body}Please review.`, mentions };
}

it("queues assignments from web creation and MCP reassignment, skipping duplicate and self-assignment", async () => {
  const { project } = await freshProject("outbox-assignments");
  const created = await createTask(context(), { projectId: project.id, title: "Assigned at creation", assigneeUserId: reportId });
  expect(await recipientsFor(created.id)).toEqual([`assignment:${reportId}`]);

  await updateTask(context(ownerId, true, "mcp"), { taskId: created.id, assigneeUserId: leadId });
  await updateTask(context(ownerId, true, "mcp"), { taskId: created.id, assigneeUserId: leadId });
  await updateTask(context(), { taskId: created.id, assigneeUserId: ownerId });
  expect(await recipientsFor(created.id)).toEqual([`assignment:${leadId}`, `assignment:${reportId}`]);
});

it("groups edits for creator and direct lead and skips card ordering and non-content edits", async () => {
  const { team, project, todo, doing } = await freshProject("outbox-task-edits");
  await setReportingLead(context(), { teamId: team.id, userId: reportId, leadUserId: leadId });
  const created = await createTask(context(ownerId, false), { projectId: project.id, title: "Title", assigneeUserId: reportId });
  const editor = context(editorId);

  await moveTask(editor, { taskId: created.id, statusId: todo.id, afterTaskId: null });
  await updateTask(editor, { taskId: created.id, priority: "high" });
  expect(await jobsFor(created.id)).toEqual([]);

  const changedAt = new Date((Math.floor(Date.now() / 300_000) + 1) * 300_000 + 60_000);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(changedAt);
    await moveTask(editor, { taskId: created.id, statusId: doing.id, afterTaskId: null });
    await updateTask(context(editorId, true, "mcp"), { taskId: created.id, description: "First edit" });
    await updateTask(editor, { taskId: created.id, title: "Another title", description: "Next edit" });
    expect(await recipientsFor(created.id)).toEqual([`task_update:${leadId}`, `task_update:${ownerId}`]);
    expect((await jobsFor(created.id)).every(({ readyAt }) => readyAt > +changedAt)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("sends task update mail to the reporter instead of the creator, and to a reporter set in the same edit", async () => {
  const { project } = await freshProject("outbox-reporter");
  const created = await createTask(context(ownerId, false), { projectId: project.id, title: "Reported", reporterUserId: reportId });
  const editor = context(editorId);

  await updateTask(editor, { taskId: created.id, title: "Reporter hears about this" });
  expect(await recipientsFor(created.id)).toEqual([`task_update:${reportId}`]);

  await db.delete(mailOutbox).where(eq(mailOutbox.targetId, created.id));
  await updateTask(editor, { taskId: created.id, title: "New reporter hears about this", reporterUserId: leadId });
  expect(await recipientsFor(created.id)).toEqual([`task_update:${leadId}`]);
});

it("retries failed SMTP submissions and gives overlapping dispatches a single lease", async () => {
  const { team } = await freshProject("outbox-retry");
  const email = "retry@outbox.test";
  await inviteToTeam(context(), { teamId: team.id, email, role: "member" });
  const send = vi.fn(async ({ to }: { to: string }) => {
    if (to === email) throw new Error("Temporary SMTP failure");
  });

  await Promise.all([
    drainMailOutbox(db, "https://tasks.example", send),
    drainMailOutbox(db, "https://tasks.example", send),
  ]);
  expect(send.mock.calls.filter(([{ to }]) => to === email)).toHaveLength(1);
  const [pending] = await jobsFor(team.id);
  expect(pending).toMatchObject({ attempts: 1, leaseId: null });
  expect(pending.readyAt).toBeGreaterThan(Date.now());

  await db.update(mailOutbox).set({ readyAt: Date.now() }).where(eq(mailOutbox.id, pending.id));
  const recovered = vi.fn(async (_message: { to: string; messageId?: string }) => {});
  await drainMailOutbox(db, "https://tasks.example", recovered);
  expect(recovered).toHaveBeenCalledWith(expect.objectContaining({ to: email, messageId: pending.id }));
  expect(await jobsFor(team.id)).toEqual([]);
});

it("deduplicates overlapping creator and lead roles and skips the actor and self-assigned creator", async () => {
  const { team, project } = await freshProject("outbox-role-overlap");
  await setReportingLead(context(), { teamId: team.id, userId: reportId, leadUserId: ownerId });
  await setReportingLead(context(), { teamId: team.id, userId: ownerId, leadUserId: leadId });
  const created = await createTask(context(ownerId, false), { projectId: project.id, title: "Both roles", assigneeUserId: reportId });
  await updateTask(context(), { taskId: created.id, title: "Lead's own edit" });
  expect(await jobsFor(created.id)).toEqual([]);

  await updateTask(context(reportId), { taskId: created.id, description: "Report's edit" });
  expect(await recipientsFor(created.id)).toEqual([`task_update:${ownerId}`]);

  const selfAssigned = await createTask(context(), { projectId: project.id, title: "Owner's task", assigneeUserId: ownerId });
  await updateTask(context(editorId), { taskId: selfAssigned.id, description: "Another editor" });
  expect(await recipientsFor(selfAssigned.id)).toEqual([`task_update:${leadId}`]);
});

it("creates no mail jobs for invite or task mutations when SMTP is disabled", async () => {
  const { team, project, doing } = await freshProject("outbox-disabled");
  const web = context(ownerId, false);
  const mcp = context(editorId, false, "mcp");
  await inviteToTeam(web, { teamId: team.id, email: "disabled-team@outbox.test", role: "member" });
  const created = await createTask(web, { projectId: project.id, title: "Created", assigneeUserId: reportId });
  await updateTask(mcp, { taskId: created.id, title: "Edited", assigneeUserId: leadId, statusId: doing.id });
  const comment = await addComment(web, { taskId: created.id, ...taggedComment([reportId]) });

  expect(await jobsFor(team.id)).toEqual([]);
  expect(await jobsFor(created.id)).toEqual([]);
  expect(await jobsFor(comment.id)).toEqual([]);
});

it("queues one email for a pending team invite and sends no email after it is claimed", async () => {
  const { team } = await freshProject("outbox-invites");
  const teamEmail = "new-team@outbox.test";
  const invitedId = "outbox-invited-user";
  await db.insert(user).values({ id: invitedId, email: teamEmail, name: "Invited", emailVerified: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await inviteToTeam(context(), { teamId: team.id, email: teamEmail, role: "member" });
  }
  expect(await recipientsFor(team.id)).toEqual([`team_invite:${teamEmail}`]);

  await claimInvites(db, invitedId, teamEmail);
  const send = vi.fn(async (_message: { to: string }) => {});
  await drainMailOutbox(db, "https://tasks.example", send);
  expect(send.mock.calls.some(([{ to }]) => to === teamEmail)).toBe(false);
  expect(await jobsFor(team.id)).toEqual([]);
});

it("discards queued legacy project invitation and project-added email", async () => {
  const { team, project } = await freshProject("outbox-legacy-invites");
  const email = "legacy-invite@outbox.test";
  const now = new Date();
  await db.batch([
    db.insert(projectInvite).values({ projectId: project.id, email, invitedByUserId: ownerId, createdAt: now }),
    db.insert(projectMember).values({ projectId: project.id, teamId: team.id, userId: reportId }),
    db.insert(mailOutbox).values([
      { id: "outbox-legacy-invite", kind: "project_invite", targetId: project.id, recipient: email, inviteVersion: now, readyAt: 0 },
      { id: "outbox-legacy-add", kind: "project_added", targetId: project.id, recipient: reportId, readyAt: 0 },
    ]),
  ]);

  const send = vi.fn(async (_message: { messageId?: string }) => {});
  await drainMailOutbox(db, "https://tasks.example", send);
  expect(send.mock.calls.some(([{ messageId }]) => messageId?.startsWith("outbox-legacy-"))).toBe(false);
  expect(await jobsFor(project.id)).toEqual([]);
});

it("checks membership and invite validity again before sending queued email", async () => {
  const { team, project } = await freshProject("outbox-dispatch");
  const inviteEmail = "canonical-link@outbox.test";
  const revokedEmail = "revoked-invite@outbox.test";
  await inviteToTeam(context(), { teamId: team.id, email: inviteEmail, role: "member" });
  await inviteToTeam(context(), { teamId: team.id, email: revokedEmail, role: "member" });
  await revokeTeamInvite(context(), { teamId: team.id, email: revokedEmail });
  const created = await createTask(context(), { projectId: project.id, title: "Access removed", assigneeUserId: reportId });
  await removeTeamMember(context(), { teamId: team.id, userId: reportId });

  const send = vi.fn(async (_message: { to: string; text: string }) => {});
  await drainMailOutbox(db, "https://tasks.example", send);
  const sent = send.mock.calls.map(([message]) => message);
  const invite = sent.find(({ to }) => to === inviteEmail);
  expect(invite?.text.match(/https?:\/\/\S+/g)).toEqual(["https://tasks.example/"]);
  expect(sent.some(({ to }) => to === revokedEmail)).toBe(false);
  expect(sent.some(({ text }) => text.includes("Access removed"))).toBe(false);
  expect(await jobsFor(team.id)).toEqual([]);
  expect(await jobsFor(created.id)).toEqual([]);
});

it("deduplicates comment mentions, skips the author, and checks recipient access at delivery", async () => {
  const { team, project } = await freshProject("outbox-comment-mentions");
  const created = await createTask(context(), { projectId: project.id, title: "Review requested" });
  const comment = await addComment(context(), {
    taskId: created.id,
    ...taggedComment([reportId, reportId, ownerId, leadId, editorId]),
  });
  expect(await recipientsFor(comment.id)).toEqual([
    `comment_mention:${editorId}`, `comment_mention:${leadId}`, `comment_mention:${reportId}`,
  ]);

  await removeTeamMember(context(), { teamId: team.id, userId: leadId });
  await db.update(user).set({ emailVerified: false }).where(eq(user.id, editorId));
  const send = vi.fn(async (_message: { to: string; text: string; messageId?: string }) => {});
  try {
    await drainMailOutbox(db, "https://tasks.example", send);
  } finally {
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, editorId));
  }

  const sent = send.mock.calls.map(([message]) => message)
    .filter(({ messageId }) => messageId?.startsWith(`mention:${comment.id}:`));
  expect(sent.map(({ to }) => to)).toEqual([`${reportId}@outbox.test`]);
  expect(sent[0].text).toContain(comment.body);
  expect(sent[0].text).toContain(`https://tasks.example/${team.slug}/${project.slug}/${created.key}`);
  expect(await jobsFor(comment.id)).toEqual([]);
});
