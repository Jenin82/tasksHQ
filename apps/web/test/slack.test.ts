import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, expect, it, vi } from "vitest";
import {
  addProjectMember,
  createOrg,
  createProject,
  createStatus,
  createTask,
  disconnectProjectSlack,
  moveTask,
  queueSlackTest,
  readProjectSlack,
  saveProjectSlack,
  setProjectMemberRole,
  transferTask,
  updateTask,
} from "@tasks/core/domain";
import { mailOutbox, orgMember, projectSlack, slackOutbox, status, user } from "@tasks/core/schema";
import { drainSlackOutbox, encryptSlackWebhook } from "@/lib/slack";

const db = drizzle(env.DB);
const origin = "https://tasks.example.test";
const secret = "test-only-slack-encryption-secret";
const webhook = "https://hooks.slack.com/services/T00000000/B00000000/fixtureKey000000000000000";
const replacement = "https://hooks.slack.com/services/T00000000/B00000001/fixtureKey000000000000001";
const owner = { db, actorUserId: "slack-owner", source: "web" as const };
const member = { db, actorUserId: "slack-member", source: "mcp" as const };

await db.insert(user).values([
  { id: owner.actorUserId, email: "owner@slack.test", name: "Alice" },
  { id: member.actorUserId, email: "member@slack.test", name: "Bob" },
]);

beforeEach(async () => {
  await db.delete(slackOutbox);
});

async function fixture(slug: string) {
  const org = await createOrg(owner, { slug, name: "Slack test workspace" });
  await db.insert(orgMember).values({ orgId: org.id, userId: member.actorUserId, role: "member", createdAt: new Date() });
  const project = await createProject(owner, { orgId: org.id, slug: "work", name: "Slack test project", key: "SLK" });
  await addProjectMember(owner, { projectId: project.id, userId: member.actorUserId });
  const statuses = await db.select().from(status).where(eq(status.projectId, project.id)).orderBy(asc(status.position));
  return { org, project, todo: statuses[0], doing: statuses[1], done: statuses[2] };
}

async function connect(projectId: string, url = webhook, actor = owner) {
  const encryptedWebhook = await encryptSlackWebhook(secret, projectId, url);
  await saveProjectSlack(actor, { projectId, encryptedWebhook });
}

function jobs(projectId: string) {
  return db.select().from(slackOutbox).where(eq(slackOutbox.projectId, projectId)).orderBy(asc(slackOutbox.id));
}

it("records creation and real moves for the connected project from web and MCP", async () => {
  const connected = await fixture("slack-events");
  const unconnected = await fixture("slack-unconnected");
  await createTask(owner, { projectId: connected.project.id, title: "Created before setup" });
  await connect(connected.project.id);

  const task = await createTask(owner, { projectId: connected.project.id, title: "Initial title" });
  await createTask(member, { projectId: unconnected.project.id, title: "Private to the other project" });
  await moveTask(owner, { taskId: task.id, statusId: connected.todo.id, afterTaskId: null });
  // A creator's setup move can be omitted from task activity. Slack still records it.
  await moveTask(owner, { taskId: task.id, statusId: connected.doing.id, afterTaskId: null });
  await updateTask(member, { taskId: task.id, title: "Updated title", statusId: connected.done.id });
  await updateTask(member, { taskId: task.id, statusId: connected.done.id, priority: "high" });

  expect((await jobs(connected.project.id)).map(({ payload }) => payload)).toEqual([
    { type: "created", taskKey: task.key, title: "Initial title", actor: "Alice", toStatus: connected.todo.name },
    {
      type: "status_changed", taskKey: task.key, title: "Initial title", actor: "Alice",
      fromStatus: connected.todo.name, toStatus: connected.doing.name,
    },
    {
      type: "status_changed", taskKey: task.key, title: "Updated title", actor: "Bob",
      fromStatus: connected.doing.name, toStatus: connected.done.name,
    },
  ]);
  expect(await jobs(unconnected.project.id)).toEqual([]);
});

it("queues a transfer's status change for the destination project only", async () => {
  const { org, project: source } = await fixture("slack-task-transfer");
  const target = await createProject(owner, { orgId: org.id, slug: "next", name: "Next project", key: "NXT" });
  const waiting = await createStatus(owner, { projectId: source.id, name: "Waiting for review" });
  await addProjectMember(owner, { projectId: target.id, userId: member.actorUserId });
  const task = await createTask(member, { projectId: source.id, title: "Transfer this task", statusId: waiting.id });
  await connect(source.id);
  await connect(target.id, replacement);

  const moved = await transferTask({ ...owner, emailNotifications: true }, {
    taskId: task.id, sourceProjectId: source.id, destinationProjectId: target.id,
  });
  expect(await jobs(source.id)).toEqual([]);
  expect((await jobs(target.id)).map(({ payload }) => payload)).toEqual([{
    type: "status_changed", taskKey: moved.key, title: task.title, actor: "Alice",
    fromStatus: waiting.name, toStatus: "Todo",
  }]);
  expect(await db.select().from(mailOutbox).where(eq(mailOutbox.targetId, task.id))).toMatchObject([
    { kind: "task_update", recipient: member.actorUserId },
  ]);
});

it("restricts integration management and discards pending jobs for the previous destination", async () => {
  const { project } = await fixture("slack-management");
  const input = { projectId: project.id };
  const encryptedWebhook = await encryptSlackWebhook(secret, project.id, webhook);
  await expect(saveProjectSlack(member, { ...input, encryptedWebhook })).rejects.toMatchObject({ reason: "forbidden" });
  await expect(queueSlackTest(owner, input)).rejects.toThrow(/connect/i);
  await connect(project.id);
  const old = await db.select().from(projectSlack).where(eq(projectSlack.projectId, project.id)).get();
  expect(old?.encryptedWebhook).not.toContain(webhook);

  await expect(queueSlackTest(member, input)).rejects.toMatchObject({ reason: "forbidden" });
  await expect(disconnectProjectSlack(member, input)).rejects.toMatchObject({ reason: "forbidden" });
  await setProjectMemberRole(owner, { ...input, userId: member.actorUserId, role: "admin" });
  await queueSlackTest(member, input);
  expect((await jobs(project.id))[0]).toMatchObject({ revision: old?.revision, payload: { type: "test" } });

  const admin = { ...member, source: "web" as const };
  await connect(project.id, replacement, admin);
  await queueSlackTest(admin, input);
  const [newJob] = await jobs(project.id);
  expect(newJob.revision).not.toBe(old?.revision);
  expect(await jobs(project.id)).toHaveLength(1);
  expect(await readProjectSlack(admin, input)).toEqual({ connected: true, lastError: null });
  await disconnectProjectSlack(admin, input);
  expect(await jobs(project.id)).toEqual([]);
  expect(await readProjectSlack(owner, input)).toEqual({ connected: false, lastError: null });
});

it("honors Retry-After without letting a later status event overtake creation", async () => {
  const { org, project, doing } = await fixture("slack-ordered");
  await connect(project.id);
  const task = await createTask(owner, { projectId: project.id, title: "<!channel> & fixture" });
  await updateTask(member, { taskId: task.id, statusId: doing.id });
  const [first, second] = await jobs(project.id);
  const throttle = vi.fn(async (_url: string, _init: RequestInit) => new Response("slow down", {
    status: 429, headers: { "Retry-After": "120" },
  }));

  const earliestRetry = Date.now() + 120_000;
  await Promise.all([
    drainSlackOutbox(db, origin, secret, throttle),
    drainSlackOutbox(db, origin, secret, throttle),
  ]);
  expect(throttle).toHaveBeenCalledOnce();
  const [url, request] = throttle.mock.calls[0];
  expect(url).toBe(webhook);
  expect(request).toMatchObject({ method: "POST", redirect: "manual" });
  const message = JSON.parse(String(request.body));
  expect(message).toMatchObject({ unfurl_links: false, unfurl_media: false });
  expect(message.text).not.toContain("<!channel>");
  expect(JSON.stringify(message.blocks)).toContain("plain_text");
  expect(JSON.stringify(message.blocks)).toContain(`${origin}/${org.slug}/${project.slug}/${task.key}`);

  const [retry, waiting] = await jobs(project.id);
  expect(retry).toMatchObject({ id: first.id, attempts: 1, leaseId: null });
  expect(retry.readyAt).toBeGreaterThanOrEqual(earliestRetry);
  expect(waiting).toMatchObject({ id: second.id, attempts: 0 });
  await drainSlackOutbox(db, origin, secret, throttle);
  expect(throttle).toHaveBeenCalledOnce();

  await db.update(slackOutbox).set({ readyAt: Date.now() - 1 }).where(eq(slackOutbox.id, first.id));
  const send = vi.fn(async (_url: string, _init: RequestInit) => new Response("ok"));
  await drainSlackOutbox(db, origin, secret, send);
  expect(send).toHaveBeenCalledOnce();
  expect((await jobs(project.id)).map(({ id }) => id)).toEqual([second.id]);
  await drainSlackOutbox(db, origin, secret, send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(await jobs(project.id)).toEqual([]);
});

it("discards Slack redirects without exposing the webhook or redirect location to settings", async () => {
  const { project } = await fixture("slack-redirect");
  await connect(project.id);
  await queueSlackTest(owner, { projectId: project.id });
  const redirect = "https://example.test/never-follow";
  const send = vi.fn(async (_url: string, _init: RequestInit) => new Response(webhook, {
    status: 302, headers: { Location: redirect },
  }));

  await drainSlackOutbox(db, origin, secret, send);
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(webhook, expect.objectContaining({ redirect: "manual" }));
  expect(await jobs(project.id)).toEqual([]);
  const integration = await readProjectSlack(owner, { projectId: project.id });
  expect(integration.lastError).toEqual(expect.any(String));
  expect(integration.lastError).not.toContain(webhook);
  expect(integration.lastError).not.toContain(redirect);
});

it.each([
  webhook.replace("https://", "http://"),
  webhook.replace("hooks.slack.com", "hooks.slack.com.example.test"),
  webhook.replace("hooks.slack.com", "example.test@hooks.slack.com"),
  webhook.replace("hooks.slack.com", "hooks.slack.com:8443"),
  `${webhook}?redirect=elsewhere`,
  `${webhook}#fragment`,
])("rejects a webhook outside the permitted Slack URL format", async (invalidUrl) => {
  await expect(encryptSlackWebhook(secret, "slack-invalid", invalidUrl)).rejects.toThrow();
});
