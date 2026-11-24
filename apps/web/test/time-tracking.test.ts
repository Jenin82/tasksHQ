import { env } from "cloudflare:test";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  archiveTask,
  autoArchiveDoneTasks,
  createProject,
  createTask,
  createTimeEntry,
  deleteArchivedTask,
  deleteTeam,
  deleteProject,
  deleteTimeEntry,
  getTaskTimeTotals,
  listMyTimeEntries,
  removeTeamMember,
  setProjectTaskEditRestriction,
  setUserTimezone,
  startTimer,
  stopStaleTimers,
  stopTimer,
  transferTask,
  updateTask,
  updateTimeEntry,
} from "@tasks/core/domain";
import { createTeam } from "./helpers";
import { activity, orgMember, teamMember, status, task, timeEntry, user } from "@tasks/core/schema";
import { zonedDate, zonedMidnight, zonedTime } from "@/lib/time-zone";

const db = drizzle(env.DB);
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

let userSeq = 0;
async function makeUser() {
  const id = `tt-user-${userSeq++}`;
  await db.insert(user).values({ id, name: id, email: `${id}@tt.test` });
  return id;
}

const ctx = (actorUserId: string, source: "web" | "mcp" = "web") => ({ db, actorUserId, source });
const ownerId = await makeUser();
const owner = ctx(ownerId);
const workspace = await createTeam(owner, { slug: "tt-space", name: "Time tracking" });
const otherWorkspace = await createTeam(owner, { slug: "tt-other", name: "Other" });

async function makeMember(teamIds = [workspace.id]) {
  const id = await makeUser();
  await db.insert(teamMember).values(teamIds.map((teamId) => ({ teamId, userId: id, role: "member" as const, createdAt: new Date() })));
  return id;
}

let projectSeq = 0;
const makeProject = (teamId = workspace.id) =>
  createProject(owner, { teamId, slug: `tt-${projectSeq}`, key: `TT${projectSeq++}`, name: "P" });
async function makeTask(teamId = workspace.id) {
  const p = await makeProject(teamId);
  const t = await createTask(owner, { projectId: p.id, title: "Track me" });
  return { p, t, target: { taskId: t.id, projectId: p.id } };
}
async function entry(id: string) {
  const [row] = await db.select().from(timeEntry).where(eq(timeEntry.id, id));
  return row;
}
async function running(userId: string) {
  return db.select().from(timeEntry).where(and(eq(timeEntry.userId, userId), isNull(timeEntry.endedAt)));
}
async function backdate(id: string, startedAt: number) {
  await db.update(timeEntry).set({ startedAt: new Date(startedAt) }).where(eq(timeEntry.id, id));
}

it("startTimer creates a running timer entry and keeps one running entry per user across teams", async () => {
  const userId = await makeMember([workspace.id, otherWorkspace.id]);
  const a = await makeTask();
  const b = await makeTask();
  const c = await makeTask(otherWorkspace.id);

  const first = await startTimer(ctx(userId, "mcp"), a.target);
  expect(first).toMatchObject({ kind: "timer", source: "mcp", endedAt: null, taskId: a.t.id, teamId: workspace.id });

  const second = await startTimer(ctx(userId), b.target);
  expect((await entry(first.id)).endedAt).not.toBeNull();
  expect((await running(userId)).map((r) => r.id)).toEqual([second.id]);

  const third = await startTimer(ctx(userId), c.target);
  expect(third.teamId).toBe(otherWorkspace.id);
  expect((await entry(second.id)).endedAt).not.toBeNull();
  expect((await running(userId)).map((r) => r.id)).toEqual([third.id]);
});

it("startTimer rejects an archived task without stopping the running timer, and rejects non-members", async () => {
  const userId = await makeMember();
  const live = await makeTask();
  const archived = await makeTask();
  await archiveTask(owner, archived.target);

  const current = await startTimer(ctx(userId), live.target);
  await expect(startTimer(ctx(userId), archived.target)).rejects.toThrow(/archived/i);
  expect((await running(userId)).map((r) => r.id)).toEqual([current.id]);

  const outsiderId = await makeUser();
  await expect(startTimer(ctx(outsiderId), live.target)).rejects.toMatchObject({ reason: "not_a_member" });
  expect(await running(outsiderId)).toEqual([]);
});

it("lets a member without edit rights track time on a restricted project", async () => {
  const userId = await makeMember();
  const { p, t, target } = await makeTask();
  await setProjectTaskEditRestriction(owner, { projectId: p.id, restricted: true });
  await expect(updateTask(ctx(userId), { ...target, number: t.number, title: "Nope" }))
    .rejects.toMatchObject({ reason: "forbidden" });

  const timer = await startTimer(ctx(userId), target);
  expect(timer.kind).toBe("timer");
  const now = Date.now();
  const manual = await createTimeEntry(ctx(userId), { ...target, startedAt: new Date(now - 2 * HOUR_MS), endedAt: new Date(now - HOUR_MS) });
  expect(manual.kind).toBe("manual");
});

it("stopTimer errors with nothing running and caps a stale timer at 12 hours", async () => {
  const userId = await makeMember();
  await expect(stopTimer(ctx(userId))).rejects.toThrow(/no timer/i);

  const { target } = await makeTask();
  const timer = await startTimer(ctx(userId), target);
  const startedAt = Date.now() - 13 * HOUR_MS;
  await backdate(timer.id, startedAt);

  const stopped = await stopTimer(ctx(userId));
  expect(stopped.endedAt!.getTime()).toBe(startedAt + 12 * HOUR_MS);
  expect(stopped.autoStopped).toBe(true);
});

it("createTimeEntry validates the span and stores a manual entry", async () => {
  const userId = await makeMember();
  const { target } = await makeTask();
  const now = Date.now();
  const log = (startedAt: number, endedAt: number) =>
    createTimeEntry(ctx(userId), { ...target, startedAt: new Date(startedAt), endedAt: new Date(endedAt) });

  await expect(log(now - HOUR_MS, now - 2 * HOUR_MS)).rejects.toThrow(/after the start/i);
  await expect(log(now - HOUR_MS, now + HOUR_MS)).rejects.toThrow(/future/i);
  await expect(log(now - 26 * HOUR_MS, now - HOUR_MS)).rejects.toThrow(/24 hours/i);

  const created = await log(now - 3 * HOUR_MS, now - HOUR_MS);
  expect(created).toMatchObject({ kind: "manual", source: "web", autoStopped: false, editedAt: null });
  expect(created.endedAt!.getTime() - created.startedAt.getTime()).toBe(2 * HOUR_MS);
});

it("updateTimeEntry edits only own entries, marks time edits, and keeps running entries open", async () => {
  const userId = await makeMember();
  const otherId = await makeMember();
  const { target } = await makeTask();
  const now = Date.now();
  const created = await createTimeEntry(ctx(userId), { ...target, startedAt: new Date(now - 3 * HOUR_MS), endedAt: new Date(now - HOUR_MS) });

  await expect(updateTimeEntry(ctx(otherId), { id: created.id, note: "mine now" }))
    .rejects.toThrow(/no longer exists/i);

  const noted = await updateTimeEntry(ctx(userId), { id: created.id, note: "  Notes only  " });
  expect(noted.note).toBe("Notes only");
  expect(noted.editedAt).toBeNull();

  const retimed = await updateTimeEntry(ctx(userId), { id: created.id, endedAt: new Date(now - 2 * HOUR_MS) });
  expect(retimed.endedAt!.getTime()).toBe(now - 2 * HOUR_MS);
  expect(retimed.editedAt).not.toBeNull();

  const timer = await startTimer(ctx(userId), target);
  await expect(updateTimeEntry(ctx(userId), { id: timer.id, endedAt: new Date(now) }))
    .rejects.toThrow(/stop the timer/i);
  expect((await entry(timer.id)).endedAt).toBeNull();
});

it("updateTimeEntry lets a stale running timer take a note without the 12-hour start check", async () => {
  const userId = await makeMember();
  const { target } = await makeTask();
  const timer = await startTimer(ctx(userId), target);
  const startedAt = Date.now() - 13 * HOUR_MS;
  await backdate(timer.id, startedAt);

  const noted = await updateTimeEntry(ctx(userId), { id: timer.id, note: "Still on it" });
  expect(noted).toMatchObject({ note: "Still on it", endedAt: null, editedAt: null });
  expect(noted.startedAt.getTime()).toBe(startedAt);
  await expect(updateTimeEntry(ctx(userId), { id: timer.id, startedAt: new Date(startedAt - 60_000) }))
    .rejects.toThrow(/12 hours/i);
});

it("deleteTimeEntry deletes only own entries", async () => {
  const userId = await makeMember();
  const otherId = await makeMember();
  const { target } = await makeTask();
  const now = Date.now();
  const created = await createTimeEntry(ctx(userId), { ...target, startedAt: new Date(now - 2 * HOUR_MS), endedAt: new Date(now - HOUR_MS) });

  await expect(deleteTimeEntry(ctx(otherId), { id: created.id })).rejects.toThrow(/no longer exists/i);
  expect(await entry(created.id)).toBeDefined();

  await deleteTimeEntry(ctx(userId), { id: created.id });
  expect(await entry(created.id)).toBeUndefined();
});

it("listMyTimeEntries returns the actor's overlapping entries in one team", async () => {
  const userId = await makeMember([workspace.id, otherWorkspace.id]);
  const otherId = await makeMember();
  const here = await makeTask();
  const there = await makeTask(otherWorkspace.id);
  const now = Date.now();
  const from = new Date(now - 10 * HOUR_MS);
  const to = new Date(now);
  const log = (actor: string, target: { taskId: string; projectId: string }, start: number, end: number) =>
    createTimeEntry(ctx(actor), { ...target, startedAt: new Date(now - start * HOUR_MS), endedAt: new Date(now - end * HOUR_MS) });

  const straddling = await log(userId, here.target, 12, 9);
  const inside = await log(userId, here.target, 5, 4);
  await log(userId, here.target, 20, 11); // ends before `from`
  await log(userId, there.target, 5, 4); // other team
  await log(otherId, here.target, 5, 4); // other user

  const listed = await listMyTimeEntries(ctx(userId), { teamId: workspace.id, from, to });
  expect(listed.map((e) => e.id)).toEqual([inside.id, straddling.id]);
  expect(listed[0]).toMatchObject({ taskId: here.t.id, projectId: here.p.id, key: here.t.key });
});

it("listMyTimeEntries spans teams the actor can open, drops teams they left, and marks implicit-only teams read-only", async () => {
  const userId = await makeMember([workspace.id, otherWorkspace.id]);
  const left = await createTeam(owner, { slug: "tt-left", name: "Left" });
  await db.insert(teamMember).values({ teamId: left.id, userId, role: "member", createdAt: new Date() });
  const here = await makeTask();
  const there = await makeTask(otherWorkspace.id);
  const gone = await makeTask(left.id);
  const now = Date.now();
  const from = new Date(now - 10 * HOUR_MS);
  const to = new Date(now);
  const log = (target: { taskId: string; projectId: string }, start: number) =>
    createTimeEntry(ctx(userId), { ...target, startedAt: new Date(now - start * HOUR_MS), endedAt: new Date(now - (start - 1) * HOUR_MS) });
  const a = await log(here.target, 3);
  const b = await log(there.target, 4);
  const c = await log(gone.target, 5);
  await db.delete(teamMember).where(and(eq(teamMember.teamId, left.id), eq(teamMember.userId, userId)));

  const listed = await listMyTimeEntries(ctx(userId), { from, to });
  expect(listed.map((e) => [e.id, e.teamSlug, e.editable])).toEqual([[a.id, "tt-space", true], [b.id, "tt-other", true]]);
  expect(listed[1]).toMatchObject({ teamId: otherWorkspace.id, teamName: "Other", projectId: there.p.id });
  await expect(listMyTimeEntries(ctx(userId), { teamId: left.id, from, to })).rejects.toMatchObject({ reason: "not_a_member" });

  // As an org admin they can open the team again, but only read their entries there.
  await db.update(orgMember).set({ role: "admin" }).where(eq(orgMember.userId, userId));
  const asAdmin = await listMyTimeEntries(ctx(userId), { from, to });
  expect(asAdmin.map((e) => [e.id, e.editable])).toEqual([[a.id, true], [b.id, true], [c.id, false]]);
  expect(await listMyTimeEntries(ctx(userId), { teamId: left.id, from, to })).toMatchObject([{ id: c.id, editable: false }]);
});

it("getTaskTimeTotals sums everyone's time and the actor's own, counting running timers", async () => {
  const userId = await makeMember();
  const otherId = await makeMember();
  const { target } = await makeTask();
  const now = Date.now();
  await createTimeEntry(ctx(userId), { ...target, startedAt: new Date(now - 3 * HOUR_MS), endedAt: new Date(now - 2 * HOUR_MS) });
  await createTimeEntry(ctx(otherId), { ...target, startedAt: new Date(now - 5 * HOUR_MS), endedAt: new Date(now - 3 * HOUR_MS) });
  const timer = await startTimer(ctx(userId), target);
  await backdate(timer.id, now - HOUR_MS / 2);

  const totals = await getTaskTimeTotals(ctx(userId), target);
  expect(totals.mineMs).toBeGreaterThanOrEqual(1.5 * HOUR_MS);
  expect(totals.mineMs).toBeLessThan(1.5 * HOUR_MS + 60_000);
  expect(totals.totalMs - totals.mineMs).toBe(2 * HOUR_MS);
  expect(totals.myEntries).toHaveLength(2);
});

it("archiveTask stops running timers on the task and writes one task.archived row", async () => {
  const aId = await makeMember();
  const bId = await makeMember();
  const { target } = await makeTask();
  const a = await startTimer(ctx(aId), target);
  const b = await startTimer(ctx(bId), target);

  await archiveTask(owner, target);
  expect((await entry(a.id)).endedAt).not.toBeNull();
  expect((await entry(b.id)).endedAt).not.toBeNull();
  const rows = await db.select().from(activity)
    .where(and(eq(activity.taskId, target.taskId), eq(activity.type, "task.archived")));
  expect(rows).toHaveLength(1);
});

it("autoArchiveDoneTasks stops timers on swept tasks and returns the archived count", async () => {
  const userId = await makeMember();
  const otherId = await makeMember();
  const p = await makeProject();
  const [done] = await db.select({ id: status.id }).from(status)
    .where(and(eq(status.projectId, p.id), eq(status.name, "Done")));
  const old = await createTask(owner, { projectId: p.id, title: "Old done", statusId: done.id });
  const fresh = await createTask(owner, { projectId: p.id, title: "Still active" });
  const now = Date.now();
  await db.update(task).set({ statusChangedAt: new Date(now - 30 * DAY_MS) }).where(eq(task.id, old.id));
  const swept = await startTimer(ctx(userId), { taskId: old.id, projectId: p.id });
  const kept = await startTimer(ctx(otherId), { taskId: fresh.id, projectId: p.id });

  expect(await autoArchiveDoneTasks(db, { now })).toBe(1);
  expect((await entry(swept.id)).endedAt).not.toBeNull();
  expect((await entry(kept.id)).endedAt).toBeNull();
});

it("removeTeamMember stops the member's running timer in that team only", async () => {
  const leaverId = await makeMember();
  const stayerId = await makeMember();
  const { target } = await makeTask();
  const leaving = await startTimer(ctx(leaverId), target);
  const staying = await startTimer(ctx(stayerId), target);

  await removeTeamMember(owner, { teamId: workspace.id, userId: leaverId });
  expect((await entry(leaving.id)).endedAt).not.toBeNull();
  expect((await entry(staying.id)).endedAt).toBeNull();

  // A running timer in another team survives removal from this one.
  const travellerId = await makeMember([workspace.id, otherWorkspace.id]);
  const elsewhere = await makeTask(otherWorkspace.id);
  const away = await startTimer(ctx(travellerId), elsewhere.target);
  await removeTeamMember(owner, { teamId: workspace.id, userId: travellerId });
  expect((await entry(away.id)).endedAt).toBeNull();
});

it("removeTeamMember of the last owner (allowed, P5) stops that owner's timer", async () => {
  const soleId = await makeUser();
  const space = await createTeam(ctx(soleId), { slug: "tt-sole", name: "Sole admin" });
  const p = await createProject(ctx(soleId), { teamId: space.id, slug: "tt-sole-p", key: "TTS", name: "P" });
  const t = await createTask(ctx(soleId), { projectId: p.id, title: "Mine" });
  const timer = await startTimer(ctx(soleId), { taskId: t.id, projectId: p.id });

  await removeTeamMember(ctx(soleId), { teamId: space.id, userId: soleId });
  expect((await entry(timer.id)).endedAt).not.toBeNull();
});

it("deleteTeam removes the team's time entries, running or not", async () => {
  const soleId = await makeUser();
  const space = await createTeam(ctx(soleId), { slug: "tt-doomed", name: "Doomed" });
  const p = await createProject(ctx(soleId), { teamId: space.id, slug: "tt-doomed-p", key: "TTD", name: "P" });
  const t = await createTask(ctx(soleId), { projectId: p.id, title: "Gone" });
  const target = { taskId: t.id, projectId: p.id };
  const now = Date.now();
  const logged = await createTimeEntry(ctx(soleId), { ...target, startedAt: new Date(now - 2 * HOUR_MS), endedAt: new Date(now - HOUR_MS) });
  const timer = await startTimer(ctx(soleId), target);

  // Only org owners delete teams.
  await db.update(orgMember).set({ role: "owner" }).where(eq(orgMember.userId, soleId));
  await deleteTeam(ctx(soleId), { teamId: space.id, confirmation: space.slug });
  expect(await entry(logged.id)).toBeUndefined();
  expect(await entry(timer.id)).toBeUndefined();
});

it("removes time entries with a permanently deleted task or a deleted project, and keeps them on transfer", async () => {
  const userId = await makeMember();
  const now = Date.now();
  const log = (target: { taskId: string; projectId: string }) =>
    createTimeEntry(ctx(userId), { ...target, startedAt: new Date(now - 2 * HOUR_MS), endedAt: new Date(now - HOUR_MS) });

  const doomed = await makeTask();
  const doomedEntry = await log(doomed.target);
  await archiveTask(owner, doomed.target);
  await deleteArchivedTask(owner, { ...doomed.target, confirmation: doomed.t.key });
  expect(await entry(doomedEntry.id)).toBeUndefined();

  const gone = await makeTask();
  const goneEntry = await log(gone.target);
  await deleteProject(owner, { projectId: gone.p.id, confirmation: gone.p.slug });
  expect(await entry(goneEntry.id)).toBeUndefined();

  const moving = await makeTask();
  const destination = await makeProject();
  const movingEntry = await log(moving.target);
  await transferTask(owner, { taskId: moving.t.id, sourceProjectId: moving.p.id, destinationProjectId: destination.id });
  expect(await entry(movingEntry.id)).toMatchObject({ taskId: moving.t.id, teamId: workspace.id });
  const totals = await getTaskTimeTotals(ctx(userId), { taskId: moving.t.id, projectId: destination.id });
  expect(totals.mineMs).toBe(HOUR_MS);
});

it("stopStaleTimers stops only timers running for 12 hours or more", async () => {
  // Close anything earlier tests left running so the count is exact.
  await db.update(timeEntry).set({ endedAt: sql`${timeEntry.startedAt}` }).where(isNull(timeEntry.endedAt));
  const staleId = await makeMember();
  const freshId = await makeMember();
  const { target } = await makeTask();
  const now = Date.now();
  const stale = await startTimer(ctx(staleId), target);
  const fresh = await startTimer(ctx(freshId), target);
  await backdate(stale.id, now - 14 * HOUR_MS);
  await backdate(fresh.id, now - 11 * HOUR_MS);

  expect(await stopStaleTimers(db, now)).toBe(1);
  expect(await entry(stale.id)).toMatchObject({ autoStopped: true, endedAt: new Date(now - 2 * HOUR_MS) });
  expect((await entry(fresh.id)).endedAt).toBeNull();
});

it("setUserTimezone rejects an unknown zone and stores a valid one", async () => {
  const userId = await makeMember();
  await expect(setUserTimezone(ctx(userId), { timezone: "Mars/Olympus" })).rejects.toThrow(/valid time zone/i);
  expect(await setUserTimezone(ctx(userId), { timezone: " Asia/Kolkata " })).toBe("Asia/Kolkata");
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  expect(row.timezone).toBe("Asia/Kolkata");
});

it("zonedMidnight gives local 00:00, or the first instant of a date whose midnight does not exist", () => {
  // A normal day.
  expect(zonedMidnight("2026-11-17", "Asia/Kolkata")).toBe(Date.UTC(2026, 10, 16, 18, 30));
  expect(zonedTime("2026-11-17", "09:15", "Asia/Kolkata")).toBe(Date.UTC(2026, 10, 17, 3, 45));
  // London springs forward at 01:00 on 2026-03-29: that midnight is still GMT, the next is BST.
  expect(zonedMidnight("2026-03-29", "Europe/London")).toBe(Date.UTC(2026, 2, 29, 0, 0));
  expect(zonedMidnight("2026-03-30", "Europe/London")).toBe(Date.UTC(2026, 2, 29, 23, 0));
  // Santiago jumps from 00:00 to 01:00 on 2026-09-06, so the day starts at 01:00 (-03).
  const santiago = zonedMidnight("2026-09-06", "America/Santiago");
  expect(santiago).toBe(Date.UTC(2026, 8, 6, 4, 0));
  expect(zonedDate(santiago, "America/Santiago")).toBe("2026-09-06");
  expect(zonedDate(santiago - 1, "America/Santiago")).toBe("2026-09-05");
});
