import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  autoArchiveDoneTasks,
  createOrg,
  createProject,
  createStatus,
  createTask,
  deleteStatus,
  setProjectAutoArchive,
  SYSTEM_USER_ID,
  unarchiveTask,
  updateTask,
} from "@tasks/core/domain";
import { activity, orgMember, project, status, task, user } from "@tasks/core/schema";

const db = drizzle(env.DB);
const DAY_MS = 86_400_000;

const ownerId = "aa-owner";
const memberId = "aa-member";
await db.insert(user).values([ownerId, memberId].map((id) => ({ id, name: id, email: `${id}@aa.test` })));

const ctx = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });
const owner = ctx(ownerId);
const workspace = await createOrg(owner, { slug: "aa-space", name: "Auto archive" });
await db.insert(orgMember).values({ orgId: workspace.id, userId: memberId, role: "member", createdAt: new Date() });

let seq = 0;
const makeProject = () => createProject(owner, { orgId: workspace.id, slug: `aa-${seq}`, key: `AA${seq++}`, name: "P" });

async function doneStatusId(projectId: string) {
  const [row] = await db.select({ id: status.id }).from(status)
    .where(and(eq(status.projectId, projectId), eq(status.name, "Done")));
  return row.id;
}
async function backdateStatus(taskId: string, ms: number) {
  await db.update(task).set({ statusChangedAt: new Date(ms) }).where(eq(task.id, taskId));
}
async function taskRow(taskId: string) {
  const [row] = await db.select().from(task).where(eq(task.id, taskId));
  return row;
}

it("createProject defaults the policy to the Done status at 14 days", async () => {
  const p = await makeProject();
  const [row] = await db.select().from(project).where(eq(project.id, p.id));
  expect(row.autoArchiveStatusId).toBe(await doneStatusId(p.id));
  expect(row.autoArchiveDays).toBe(14);
});

it("archives a Done task past the window, attributed to the system user", async () => {
  const p = await makeProject();
  const done = await doneStatusId(p.id);
  const t = await createTask(owner, { projectId: p.id, title: "Old done", statusId: done });
  const now = Date.now();
  await backdateStatus(t.id, now - 15 * DAY_MS);

  const archived = await autoArchiveDoneTasks(db, { now });
  expect(archived).toBe(1);

  const row = await taskRow(t.id);
  expect(row.archivedAt).not.toBeNull();

  const acts = await db.select().from(activity)
    .where(and(eq(activity.taskId, t.id), eq(activity.type, "task.auto_archived")));
  expect(acts).toHaveLength(1);
  expect(acts[0].actorUserId).toBe(SYSTEM_USER_ID);
});

it("leaves a Done task that is still within the window", async () => {
  const p = await makeProject();
  const done = await doneStatusId(p.id);
  const t = await createTask(owner, { projectId: p.id, title: "Fresh done", statusId: done });
  const now = Date.now();
  await backdateStatus(t.id, now - 3 * DAY_MS);

  expect(await autoArchiveDoneTasks(db, { now })).toBe(0);
  expect((await taskRow(t.id)).archivedAt).toBeNull();
});

it("ignores tasks in a status other than the configured one", async () => {
  const p = await makeProject();
  // The task stays in the default first column (Todo), not Done.
  const t = await createTask(owner, { projectId: p.id, title: "Old todo" });
  const now = Date.now();
  await backdateStatus(t.id, now - 30 * DAY_MS);

  expect(await autoArchiveDoneTasks(db, { now })).toBe(0);
  expect((await taskRow(t.id)).archivedAt).toBeNull();
});

it("does nothing when the project turns auto-archive off", async () => {
  const p = await makeProject();
  const done = await doneStatusId(p.id);
  const t = await createTask(owner, { projectId: p.id, title: "Done but off", statusId: done });
  await backdateStatus(t.id, Date.now() - 40 * DAY_MS);
  await setProjectAutoArchive(owner, { projectId: p.id, statusId: null, days: 14 });

  expect(await autoArchiveDoneTasks(db, { now: Date.now() })).toBe(0);
  expect((await taskRow(t.id)).archivedAt).toBeNull();
});

it("respects the project's own day count", async () => {
  const p = await makeProject();
  const done = await doneStatusId(p.id);
  await setProjectAutoArchive(owner, { projectId: p.id, statusId: done, days: 7 });
  const t = await createTask(owner, { projectId: p.id, title: "8 days done", statusId: done });
  const now = Date.now();
  await backdateStatus(t.id, now - 8 * DAY_MS);

  expect(await autoArchiveDoneTasks(db, { now })).toBe(1);
  expect((await taskRow(t.id)).archivedAt).not.toBeNull();
});

it("skips rows with no status_changed_at (older-Worker rollout)", async () => {
  const p = await makeProject();
  const done = await doneStatusId(p.id);
  const t = await createTask(owner, { projectId: p.id, title: "Null ts", statusId: done });
  await db.update(task).set({ statusChangedAt: null }).where(eq(task.id, t.id));

  expect(await autoArchiveDoneTasks(db, { now: Date.now() })).toBe(0);
  expect((await taskRow(t.id)).archivedAt).toBeNull();
});

it("restarts the clock when a task moves into the configured status", async () => {
  const p = await makeProject();
  const done = await doneStatusId(p.id);
  const t = await createTask(owner, { projectId: p.id, title: "Moved into done" });
  // Pretend it has been sitting elsewhere for a long time.
  await backdateStatus(t.id, Date.now() - 60 * DAY_MS);

  await updateTask(owner, { taskId: t.id, projectId: p.id, number: t.number, statusId: done });

  const row = await taskRow(t.id);
  expect(row.statusChangedAt!.getTime()).toBeGreaterThan(Date.now() - DAY_MS);
  // So a sweep right now must not archive it.
  expect(await autoArchiveDoneTasks(db, { now: Date.now() })).toBe(0);
});

it("restamps tasks remapped by deleteStatus so they do not archive immediately", async () => {
  const p = await makeProject();
  const extra = await createStatus(owner, { projectId: p.id, name: "Review", color: "blue" });
  const t = await createTask(owner, { projectId: p.id, title: "In review", statusId: extra.id });
  await backdateStatus(t.id, Date.now() - 90 * DAY_MS);
  const done = await doneStatusId(p.id);

  await deleteStatus(owner, { statusId: extra.id, moveTasksToStatusId: done });

  const row = await taskRow(t.id);
  expect(row.statusId).toBe(done);
  expect(row.statusChangedAt!.getTime()).toBeGreaterThan(Date.now() - DAY_MS);
  expect(await autoArchiveDoneTasks(db, { now: Date.now() })).toBe(0);
});

it("does not re-archive a task restored after auto-archiving", async () => {
  const p = await makeProject();
  const done = await doneStatusId(p.id);
  const t = await createTask(owner, { projectId: p.id, title: "Round trip", statusId: done });
  const now = Date.now();
  await backdateStatus(t.id, now - 20 * DAY_MS);
  expect(await autoArchiveDoneTasks(db, { now })).toBe(1);

  await unarchiveTask(owner, { taskId: t.id, projectId: p.id, number: t.number });
  const restored = await taskRow(t.id);
  expect(restored.archivedAt).toBeNull();
  expect(restored.statusChangedAt!.getTime()).toBeGreaterThan(now - DAY_MS);

  // A sweep right away must leave the restored task alone.
  expect(await autoArchiveDoneTasks(db, { now: Date.now() })).toBe(0);
  expect((await taskRow(t.id)).archivedAt).toBeNull();
});

it("turns the policy off when the configured status is deleted", async () => {
  const p = await makeProject();
  const done = await doneStatusId(p.id);
  await deleteStatus(owner, { statusId: done, moveTasksToStatusId: null });
  const [row] = await db.select().from(project).where(eq(project.id, p.id));
  expect(row.autoArchiveStatusId).toBeNull();
});

it("validates the day count and the chosen status, and gates on capability", async () => {
  const p = await makeProject();
  const done = await doneStatusId(p.id);
  const other = await makeProject();
  const otherDone = await doneStatusId(other.id);

  await expect(setProjectAutoArchive(owner, { projectId: p.id, statusId: done, days: 0 }))
    .rejects.toThrow();
  await expect(setProjectAutoArchive(owner, { projectId: p.id, statusId: done, days: 400 }))
    .rejects.toThrow();
  await expect(setProjectAutoArchive(owner, { projectId: p.id, statusId: otherDone, days: 14 }))
    .rejects.toThrow();
  await expect(setProjectAutoArchive(ctx(memberId), { projectId: p.id, statusId: done, days: 14 }))
    .rejects.toMatchObject({ reason: "forbidden" });

  // A valid change sticks.
  await setProjectAutoArchive(owner, { projectId: p.id, statusId: done, days: 30 });
  const [row] = await db.select().from(project).where(eq(project.id, p.id));
  expect(row.autoArchiveDays).toBe(30);
});
