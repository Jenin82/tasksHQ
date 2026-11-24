import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import {
  addComment,
  archiveTask,
  createProject,
  createStatus,
  createTask,
  deleteStatus,
  getWorkSummaryData,
  moveTask,
  startTimer,
  transferTask,
} from "@tasks/core/domain";
import { createTeam } from "./helpers";
import { activity, teamMember, status, timeEntry, user } from "@tasks/core/schema";

const db = drizzle(env.DB);
const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

let userSeq = 0;
async function makeUser() {
  const id = `ws-user-${userSeq++}`;
  await db.insert(user).values({ id, name: id, email: `${id}@ws.test` });
  return id;
}
const ctx = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });

const ownerId = await makeUser();
const owner = ctx(ownerId);
const workspace = await createTeam(owner, { slug: "ws-space", name: "Summary" });
const otherWorkspace = await createTeam(owner, { slug: "ws-summary-other", name: "Other" });

async function makeMember(role: "member" | "admin" = "member", teamIds = [workspace.id]) {
  const id = await makeUser();
  await db.insert(teamMember).values(teamIds.map((teamId) => ({ teamId, userId: id, role, createdAt: new Date() })));
  return id;
}

let projectSeq = 0;
const makeProject = (teamId = workspace.id) =>
  createProject(owner, { teamId, slug: `ws-${projectSeq}`, key: `WS${projectSeq++}`, name: "P" });
async function makeTask(teamId = workspace.id, by = owner, projectId?: string) {
  return createTask(by, { projectId: projectId ?? (await makeProject(teamId)).id, title: "Summarize me" });
}
async function statusId(projectId: string, name: string) {
  const [row] = await db.select({ id: status.id }).from(status).where(and(eq(status.projectId, projectId), eq(status.name, name)));
  return row.id;
}
async function log(userId: string, taskId: string, startedAt: number, endedAt: number, note: string | null = null, teamId = workspace.id) {
  const now = new Date();
  await db.insert(timeEntry).values({
    id: crypto.randomUUID(), teamId, taskId, userId, startedAt: new Date(startedAt), endedAt: new Date(endedAt), note,
    kind: "manual", source: "web", createdAt: now, updatedAt: now,
  });
}

const now = Date.now();
const from = now - DAY_MS;
const range = { teamId: workspace.id, from: new Date(from), to: new Date(now + HOUR_MS) };
const summary = (userId: string, input: Parameters<typeof getWorkSummaryData>[1] = range) => getWorkSummaryData(ctx(userId), input);
const find = async (userId: string, key: string) => (await summary(userId)).tasks.find((t) => t.key === key);

describe("included", () => {
  it("clips a time-only task's minutes to the range and trims and de-duplicates its notes", async () => {
    const userId = await makeMember();
    const t = await makeTask();
    await log(userId, t.id, from - 30 * MIN_MS, from + 30 * MIN_MS, "  Fix bug ");
    await log(userId, t.id, from + HOUR_MS, from + HOUR_MS + 15 * MIN_MS, "Fix bug");
    await log(userId, t.id, from + 2 * HOUR_MS, from + 2 * HOUR_MS + 15 * MIN_MS, "   ");
    await log(userId, t.id, from + 3 * HOUR_MS, from + 3 * HOUR_MS + 15 * MIN_MS, "Review");
    const result = await summary(userId);
    expect(result.totalMinutes).toBe(75);
    expect(result.tasks).toEqual([{
      key: t.key, title: "Summarize me", project: expect.stringMatching(/^ws-\d+$/), projectName: "P", team: "ws-space", teamName: "Summary", status: "Todo", archived: false, minutes: 75,
      notes: ["Fix bug", "Review"], created: null, statusChanges: [], comments: [],
    }]);
  });

  it("lists a task created in range with its status name", async () => {
    const userId = await makeMember();
    const t = await makeTask(workspace.id, ctx(userId));
    expect(await find(userId, t.key)).toMatchObject({ minutes: 0, created: { at: expect.any(Date), status: "Todo" } });
  });

  it("lists a task created directly in a non-default status with that status name", async () => {
    const userId = await makeMember();
    const p = await makeProject();
    const t = await createTask(ctx(userId), { projectId: p.id, title: "Started", statusId: await statusId(p.id, "In Progress") });
    expect(await find(userId, t.key)).toMatchObject({ created: { at: expect.any(Date), status: "In Progress" } });
  });

  it("lists the caller's status change with from/to names", async () => {
    const userId = await makeMember();
    const t = await makeTask();
    await moveTask(ctx(userId), { taskId: t.id, statusId: await statusId(t.projectId, "In Progress"), afterTaskId: null });
    const found = await find(userId, t.key);
    expect(found?.statusChanges).toEqual([{ from: "Todo", to: "In Progress", at: expect.any(Date) }]);
    expect(found?.status).toBe("In Progress");
  });

  it("lists the caller's comment excerpt", async () => {
    const userId = await makeMember();
    const t = await makeTask();
    await addComment(ctx(userId), { taskId: t.id, body: "Looks good" });
    expect((await find(userId, t.key))?.comments).toEqual([{ at: expect.any(Date), excerpt: "Looks good" }]);
  });
});

describe("across teams", () => {
  it("spans every team the caller can open without teamId, keeps same keys apart, and drops a team they left", async () => {
    const userId = await makeMember("member", [workspace.id, otherWorkspace.id]);
    const here = await makeTask();
    const there = await makeTask(otherWorkspace.id);
    await log(userId, here.id, from + HOUR_MS, from + 2 * HOUR_MS);
    await log(userId, there.id, from + HOUR_MS, from + 2 * HOUR_MS, null, otherWorkspace.id);
    const all = { from: range.from, to: range.to };
    const result = await summary(userId, all);
    expect(result.tasks.map((t) => [t.team, t.key]).sort()).toEqual([
      ["ws-space", here.key], ["ws-summary-other", there.key],
    ].sort());
    expect(result.totalMinutes).toBe(120);

    await db.delete(teamMember).where(and(eq(teamMember.teamId, otherWorkspace.id), eq(teamMember.userId, userId)));
    const after = await summary(userId, all);
    expect(after.tasks.map((t) => t.key)).toEqual([here.key]);
    expect(after.totalMinutes).toBe(60);
    await expect(summary(userId, { ...all, teamId: otherWorkspace.id })).rejects.toMatchObject({ reason: "not_a_member" });
  });
});

describe("excluded", () => {
  it("leaves out other users' activity, another team and activity before the range", async () => {
    const userId = await makeMember("member", [workspace.id, otherWorkspace.id]);
    const othersOnly = await makeTask();
    await addComment(owner, { taskId: othersOnly.id, body: "Not yours" });

    const elsewhere = await makeTask(otherWorkspace.id, ctx(userId));
    await log(userId, elsewhere.id, from + HOUR_MS, from + 2 * HOUR_MS, null, otherWorkspace.id);

    const old = await makeTask();
    await addComment(ctx(userId), { taskId: old.id, body: "Long ago" });
    await db.update(activity).set({ createdAt: new Date(from - HOUR_MS) })
      .where(and(eq(activity.taskId, old.id), eq(activity.actorUserId, userId)));

    const keys = (await summary(userId)).tasks.map((t) => t.key);
    for (const key of [othersOnly.key, elsewhere.key, old.key]) expect(keys).not.toContain(key);
    expect((await summary(userId, { ...range, teamId: otherWorkspace.id })).tasks.map((t) => t.key)).toEqual([elsewhere.key]);
  });

  it("leaves out activity at or after `to`", async () => {
    const userId = await makeMember();
    const t = await makeTask();
    await addComment(ctx(userId), { taskId: t.id, body: "At the end" });
    const to = new Date(from + HOUR_MS);
    await db.update(activity).set({ createdAt: to })
      .where(and(eq(activity.taskId, t.id), eq(activity.actorUserId, userId)));
    expect((await summary(userId, { ...range, to })).tasks.map((x) => x.key)).not.toContain(t.key);
  });

  it("leaves out the caller's own comment in another team", async () => {
    const userId = await makeMember("member", [workspace.id, otherWorkspace.id]);
    const elsewhere = await makeTask(otherWorkspace.id);
    await addComment(ctx(userId), { taskId: elsewhere.id, body: "Other team" });
    expect((await summary(userId)).tasks.map((t) => t.key)).not.toContain(elsewhere.key);
    expect((await summary(userId, { ...range, teamId: otherWorkspace.id })).tasks.map((t) => t.key)).toEqual([elsewhere.key]);
  });

  it("keeps a member's own move from a status an admin later deletes, and drops the admin's remap", async () => {
    const userId = await makeMember();
    const adminId = await makeMember("admin");
    const p = await makeProject();
    const review = await createStatus(owner, { projectId: p.id, name: "Review" });
    const todo = await statusId(p.id, "Todo");
    const moved = await createTask(owner, { projectId: p.id, title: "Moved by A", statusId: review.id });
    const remapped = await createTask(owner, { projectId: p.id, title: "Remapped", statusId: review.id });
    await moveTask(ctx(userId), { taskId: moved.id, statusId: todo, afterTaskId: null });
    await deleteStatus(ctx(adminId), { statusId: review.id, moveTasksToStatusId: todo });

    expect((await find(userId, moved.key))?.statusChanges).toEqual([{ from: "Review", to: "Todo", at: expect.any(Date) }]);
    // The admin's only activity on it is the remap, with no time, so it is dropped.
    expect((await summary(adminId)).tasks.map((t) => t.key)).not.toContain(remapped.key);
  });

  it("keeps the caller's own earlier move from a status they later delete", async () => {
    const adminId = await makeMember("admin");
    const p = await makeProject();
    const review = await createStatus(owner, { projectId: p.id, name: "Review" });
    const todo = await statusId(p.id, "Todo");
    const moved = await createTask(owner, { projectId: p.id, title: "Moved by admin", statusId: review.id });
    const remapped = await createTask(owner, { projectId: p.id, title: "Remapped", statusId: review.id });
    await moveTask(ctx(adminId), { taskId: moved.id, statusId: todo, afterTaskId: null });
    // A minute before the deletion: outside the same-batch window, so it is real work.
    await db.update(activity).set({ createdAt: new Date(Date.now() - 60_000) })
      .where(and(eq(activity.taskId, moved.id), eq(activity.type, "task.moved")));
    await deleteStatus(ctx(adminId), { statusId: review.id, moveTasksToStatusId: todo });

    const tasks = (await summary(adminId)).tasks;
    expect(tasks.find((t) => t.key === moved.key)?.statusChanges).toEqual([{ from: "Review", to: "Todo", at: expect.any(Date) }]);
    expect(tasks.map((t) => t.key)).not.toContain(remapped.key);
  });

  it("does not count a deleteStatus remap as the caller's status change, even after a transfer", async () => {
    const adminId = await makeMember("admin");
    const p = await makeProject();
    const review = await createStatus(owner, { projectId: p.id, name: "Review" });
    const stays = await createTask(owner, { projectId: p.id, title: "Stays", statusId: review.id });
    const moves = await createTask(owner, { projectId: p.id, title: "Moves", statusId: review.id });
    for (const t of [stays, moves]) await log(adminId, t.id, from + HOUR_MS, from + 2 * HOUR_MS);
    await deleteStatus(ctx(adminId), { statusId: review.id, moveTasksToStatusId: await statusId(p.id, "Todo") });

    const dest = await makeProject();
    const { key } = await transferTask(ctx(adminId), { taskId: moves.id, sourceProjectId: p.id, destinationProjectId: dest.id });

    // The remap logged a `task.moved` per task as the admin; only the filter keeps them out.
    const remaps = await db.select({ id: activity.id }).from(activity)
      .where(and(eq(activity.type, "task.moved"), eq(activity.actorUserId, adminId)));
    expect(remaps).toHaveLength(2);
    const tasks = (await summary(adminId)).tasks;
    expect(tasks.find((t) => t.key === stays.key)).toMatchObject({ status: "Todo", minutes: 60, statusChanges: [] });
    expect(tasks.find((t) => t.key === key)).toMatchObject({ status: "Todo", minutes: 60, statusChanges: [] });
  });
});

it("counts a running timer up to now, clipped to the range", async () => {
  const userId = await makeMember();
  const t = await makeTask();
  const timer = await startTimer(ctx(userId), { taskId: t.id, projectId: t.projectId });
  const start = Date.now();
  await db.update(timeEntry).set({ startedAt: new Date(start - 2 * HOUR_MS) }).where(eq(timeEntry.id, timer.id));
  const result = await summary(userId, { teamId: workspace.id, from: new Date(start - HOUR_MS), to: new Date(start + HOUR_MS) });
  expect(result.tasks.find((x) => x.key === t.key)?.minutes).toBe(60);
});

it("includes an archived task and shows a transferred task under its new key", async () => {
  const userId = await makeMember();
  const archived = await makeTask();
  const moved = await makeTask();
  for (const t of [archived, moved]) await log(userId, t.id, from + HOUR_MS, from + 2 * HOUR_MS);
  await archiveTask(owner, { taskId: archived.id });
  const dest = await makeProject();
  const { key } = await transferTask(owner, { taskId: moved.id, sourceProjectId: moved.projectId, destinationProjectId: dest.id });

  const tasks = (await summary(userId)).tasks;
  expect(tasks.find((t) => t.key === archived.key)).toMatchObject({ archived: true, minutes: 60 });
  expect(tasks.find((t) => t.key === key)).toMatchObject({ archived: false, minutes: 60 });
  expect(tasks.some((t) => t.key === moved.key)).toBe(false);
});

it("sorts by minutes descending, then key", async () => {
  const userId = await makeMember();
  const p = await makeProject();
  const tasks = [];
  for (let i = 0; i < 4; i++) tasks.push(await makeTask(workspace.id, owner, p.id));
  await log(userId, tasks[0].id, from + HOUR_MS, from + HOUR_MS + 30 * MIN_MS);
  await log(userId, tasks[1].id, from + 2 * HOUR_MS, from + 3 * HOUR_MS);
  await log(userId, tasks[2].id, from + 4 * HOUR_MS, from + 4 * HOUR_MS + 30 * MIN_MS);
  await addComment(ctx(userId), { taskId: tasks[3].id, body: "Only a comment" });
  expect((await summary(userId)).tasks.map((t) => [t.key, t.minutes])).toEqual([
    [tasks[1].key, 60], [tasks[0].key, 30], [tasks[2].key, 30], [tasks[3].key, 0],
  ]);
});

it("rejects a non-member", async () => {
  await expect(summary(await makeUser())).rejects.toMatchObject({ reason: "not_a_member" });
});
