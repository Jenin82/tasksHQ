import { and, desc, eq, exists, gt, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { AccessError, hasOrgMembership, requireOrgMember, requireProjectMember } from "../access";
import type { DomainContext } from "../activity";
import { DomainError, assertMaxLength } from "../errors";
import { user } from "../schema/auth";
import { org, orgMember } from "../schema/org";
import { project } from "../schema/project";
import { task } from "../schema/task";
import { STALE_MS, type TimeEntry, timeEntry } from "../schema/time";
import { taskKey } from "./task";

/**
 * Time entries write no activity rows: provenance lives on the row itself
 * (`kind`, `source`, `edited_at`), and a timer start/stop is not a task change.
 */

/** The longest entry that can be logged or edited by hand. */
export const MAX_ENTRY_MS = 24 * 60 * 60 * 1000;
const MAX_NOTE = 500;

/** How much of `[start, end)` falls inside `[from, to)`, in milliseconds. */
export function overlapMs(start: number, end: number, from: number, to: number) {
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
}
/** Own entries only: another user's entry reads as missing, as a deleted one does. */
const MISSING_ENTRY = "This time entry no longer exists.";

/**
 * The one way a running entry ends, used by every stop path: at `now`, but
 * never before it started nor more than `STALE_MS` after.
 */
export function stopTimeEntryValues(now: number) {
  return {
    endedAt: sql`min(max(${now}, ${timeEntry.startedAt}), ${timeEntry.startedAt} + ${STALE_MS})`,
    autoStopped: sql`${now} >= ${timeEntry.startedAt} + ${STALE_MS}`,
    updatedAt: new Date(now),
  };
}

function normalizeNote(note: string | null | undefined) {
  const value = note?.trim() || null;
  if (value) assertMaxLength("Note", value, MAX_NOTE);
  return value;
}

function assertValidTime(date: Date, label: string) {
  if (Number.isNaN(date.getTime())) throw new DomainError(`${label} is not a valid time.`);
}

function assertValidSpan(startedAt: Date, endedAt: Date, now: number) {
  assertValidTime(startedAt, "Start");
  assertValidTime(endedAt, "End");
  if (endedAt < startedAt) throw new DomainError("The end must be after the start.");
  if (endedAt.getTime() > now) throw new DomainError("Time entries can't end in the future.");
  if (endedAt.getTime() - startedAt.getTime() > MAX_ENTRY_MS) throw new DomainError("A time entry can be at most 24 hours.");
}

/** Read access only: any organization member may track time, even on restricted tasks. */
async function loadTimeTask(ctx: DomainContext, taskId: string, projectId: string) {
  const { project: p } = await requireProjectMember(ctx.db, projectId, ctx.actorUserId);
  const [row] = await ctx.db.select({ id: task.id, archivedAt: task.archivedAt }).from(task)
    .where(and(eq(task.id, taskId), eq(task.projectId, projectId)));
  if (!row) throw new AccessError("not_a_member", "No such task.");
  return { project: p, row };
}

async function loadTrackableTask(ctx: DomainContext, taskId: string, projectId: string) {
  const access = await loadTimeTask(ctx, taskId, projectId);
  if (access.row.archivedAt) throw new DomainError("Archived tasks can't track time.");
  return access;
}

/** Re-checks inside the batch what `loadTrackableTask` checked before it. */
function canTrack(ctx: DomainContext, taskId: string, projectId: string, orgId: string) {
  return and(
    exists(ctx.db.select({ id: task.id }).from(task)
      .where(and(eq(task.id, taskId), eq(task.projectId, projectId), isNull(task.archivedAt)))),
    hasOrgMembership(ctx.db, orgId, ctx.actorUserId),
  )!;
}

function ownEntry(ctx: DomainContext, id: string) {
  return and(
    eq(timeEntry.id, id),
    eq(timeEntry.userId, ctx.actorUserId),
    exists(ctx.db.select({ userId: orgMember.userId }).from(orgMember)
      .where(and(eq(orgMember.orgId, timeEntry.orgId), eq(orgMember.userId, ctx.actorUserId)))),
  )!;
}

function insertEntry(
  ctx: DomainContext,
  values: {
    orgId: string; taskId: string; startedAt: number; endedAt: number | null;
    note: string | null; kind: TimeEntry["kind"]; now: number;
  },
  guard: ReturnType<typeof canTrack>,
) {
  // Columns in `schema/time.ts` definition order.
  return ctx.db.insert(timeEntry).select(sql`
    select ${crypto.randomUUID()}, ${values.orgId}, ${values.taskId}, ${ctx.actorUserId},
      ${values.startedAt}, ${values.endedAt}, ${values.note}, ${values.kind}, ${ctx.source},
      0, null, ${values.now}, ${values.now}
    where ${guard}`).returning();
}

async function failedInsert(ctx: DomainContext, taskId: string, projectId: string): Promise<never> {
  await loadTrackableTask(ctx, taskId, projectId);
  throw new DomainError("The task changed. Refresh and try again.");
}

/** Starts a timer on the task, stopping the actor's running timer (in any organization) first. */
export async function startTimer(
  ctx: DomainContext,
  input: { taskId: string; projectId: string; note?: string | null },
): Promise<TimeEntry> {
  const note = normalizeNote(input.note);
  const { project: p } = await loadTrackableTask(ctx, input.taskId, input.projectId);
  const now = Date.now();
  const guard = canTrack(ctx, input.taskId, input.projectId, p.orgId);
  const [, inserted] = await ctx.db.batch([
    ctx.db.update(timeEntry).set(stopTimeEntryValues(now))
      .where(and(eq(timeEntry.userId, ctx.actorUserId), isNull(timeEntry.endedAt), guard)),
    insertEntry(ctx, { orgId: p.orgId, taskId: input.taskId, startedAt: now, endedAt: null, note, kind: "timer", now }, guard),
  ]);
  return inserted[0] ?? failedInsert(ctx, input.taskId, input.projectId);
}

export async function stopTimer(ctx: DomainContext): Promise<TimeEntry> {
  const [stopped] = await ctx.db.update(timeEntry).set(stopTimeEntryValues(Date.now()))
    .where(and(eq(timeEntry.userId, ctx.actorUserId), isNull(timeEntry.endedAt)))
    .returning();
  if (!stopped) throw new DomainError("No timer is running.");
  return stopped;
}

export type RunningTimer = {
  id: string;
  taskId: string;
  key: string;
  title: string;
  projectId: string;
  projectSlug: string;
  projectKey: string;
  orgSlug: string;
  startedAt: Date;
  note: string | null;
};

export async function getRunningTimer(ctx: DomainContext): Promise<RunningTimer | null> {
  const [row] = await ctx.db.select({
    id: timeEntry.id,
    taskId: task.id,
    number: task.number,
    title: task.title,
    projectId: project.id,
    projectSlug: project.slug,
    projectKey: project.key,
    orgSlug: org.slug,
    startedAt: timeEntry.startedAt,
    note: timeEntry.note,
  }).from(timeEntry)
    .innerJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(project, eq(project.id, task.projectId))
    .innerJoin(org, eq(org.id, project.orgId))
    .where(and(eq(timeEntry.userId, ctx.actorUserId), isNull(timeEntry.endedAt)));
  if (!row) return null;
  const { number, ...rest } = row;
  return { ...rest, key: taskKey(row.projectKey, number) };
}

/** Logs a finished span by hand. */
export async function createTimeEntry(
  ctx: DomainContext,
  input: { taskId: string; projectId: string; startedAt: Date; endedAt: Date; note?: string | null },
): Promise<TimeEntry> {
  const now = Date.now();
  assertValidSpan(input.startedAt, input.endedAt, now);
  const note = normalizeNote(input.note);
  const { project: p } = await loadTrackableTask(ctx, input.taskId, input.projectId);
  const [inserted] = await insertEntry(ctx, {
    orgId: p.orgId, taskId: input.taskId, startedAt: input.startedAt.getTime(),
    endedAt: input.endedAt.getTime(), note, kind: "manual", now,
  }, canTrack(ctx, input.taskId, input.projectId, p.orgId));
  return inserted ?? failedInsert(ctx, input.taskId, input.projectId);
}

/** Edits one of the actor's own entries. The task never changes; a running entry keeps running. */
export async function updateTimeEntry(
  ctx: DomainContext,
  input: { id: string; startedAt?: Date; endedAt?: Date; note?: string | null },
): Promise<TimeEntry> {
  const [entry] = await ctx.db.select().from(timeEntry).where(ownEntry(ctx, input.id));
  if (!entry) throw new DomainError(MISSING_ENTRY);

  const now = Date.now();
  const running = entry.endedAt === null;
  const startedAt = input.startedAt ?? entry.startedAt;
  assertValidTime(startedAt, "Start");
  if (startedAt.getTime() > now) throw new DomainError("Time entries can't start in the future.");
  let endedAt = entry.endedAt;
  if (running) {
    if (input.endedAt !== undefined) throw new DomainError("Stop the timer before setting its end.");
    const startChanged = startedAt.getTime() !== entry.startedAt.getTime();
    if (startChanged && now - startedAt.getTime() > STALE_MS) throw new DomainError("A running timer can't have started more than 12 hours ago.");
  } else {
    endedAt = input.endedAt ?? entry.endedAt!;
    assertValidSpan(startedAt, endedAt, now);
  }
  const timesChanged = startedAt.getTime() !== entry.startedAt.getTime() || endedAt?.getTime() !== entry.endedAt?.getTime();

  const [updated] = await ctx.db.update(timeEntry).set({
    startedAt,
    endedAt,
    ...(input.note !== undefined ? { note: normalizeNote(input.note) } : {}),
    ...(timesChanged ? { editedAt: new Date(now) } : {}),
    updatedAt: new Date(now),
  }).where(and(
    ownEntry(ctx, input.id),
    running ? isNull(timeEntry.endedAt) : isNotNull(timeEntry.endedAt),
  )).returning();
  if (!updated) throw new DomainError("The time entry changed. Refresh and try again.");
  return updated;
}

export async function deleteTimeEntry(ctx: DomainContext, input: { id: string }) {
  const [deleted] = await ctx.db.delete(timeEntry).where(ownEntry(ctx, input.id)).returning({ id: timeEntry.id });
  if (!deleted) throw new DomainError(MISSING_ENTRY);
}

export type MyTimeEntry = Pick<TimeEntry, "id" | "startedAt" | "endedAt" | "note" | "kind" | "source" | "autoStopped" | "editedAt"> & {
  taskId: string;
  key: string;
  title: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
};

/** The actor's entries in one organization that overlap `[from, to)`, newest first. */
export async function listMyTimeEntries(
  ctx: DomainContext,
  input: { orgId: string; from: Date; to: Date },
): Promise<MyTimeEntry[]> {
  await requireOrgMember(ctx.db, input.orgId, ctx.actorUserId);
  const rows = await ctx.db.select({
    id: timeEntry.id,
    startedAt: timeEntry.startedAt,
    endedAt: timeEntry.endedAt,
    note: timeEntry.note,
    kind: timeEntry.kind,
    source: timeEntry.source,
    autoStopped: timeEntry.autoStopped,
    editedAt: timeEntry.editedAt,
    taskId: task.id,
    number: task.number,
    title: task.title,
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    projectKey: project.key,
  }).from(timeEntry)
    .innerJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(project, eq(project.id, task.projectId))
    .where(and(
      eq(timeEntry.userId, ctx.actorUserId),
      eq(timeEntry.orgId, input.orgId),
      // No entry is longer than MAX_ENTRY_MS, so this bounds the index scan.
      gte(timeEntry.startedAt, new Date(input.from.getTime() - MAX_ENTRY_MS)),
      lt(timeEntry.startedAt, input.to),
      or(isNull(timeEntry.endedAt), gt(timeEntry.endedAt, input.from)),
    ))
    .orderBy(desc(timeEntry.startedAt), desc(timeEntry.id));
  return rows.map(({ number, projectKey, ...row }) => ({ ...row, key: taskKey(projectKey, number) }));
}

/** Totals for a task; running entries count up to now. */
export async function getTaskTimeTotals(
  ctx: DomainContext,
  input: { taskId: string; projectId: string },
): Promise<{ totalMs: number; mineMs: number; myEntries: TimeEntry[] }> {
  await loadTimeTask(ctx, input.taskId, input.projectId);
  const now = Date.now();
  // A running entry counts as if stopped now, with the same clamp as `stopTimeEntryValues`.
  const duration = sql`coalesce(${timeEntry.endedAt}, ${stopTimeEntryValues(now).endedAt}) - ${timeEntry.startedAt}`;
  const [[totals], myEntries] = await ctx.db.batch([
    ctx.db.select({
      totalMs: sql<number>`coalesce(sum(${duration}), 0)`,
      mineMs: sql<number>`coalesce(sum(case when ${timeEntry.userId} = ${ctx.actorUserId} then ${duration} end), 0)`,
    }).from(timeEntry).where(eq(timeEntry.taskId, input.taskId)),
    ctx.db.select().from(timeEntry)
      .where(and(eq(timeEntry.taskId, input.taskId), eq(timeEntry.userId, ctx.actorUserId)))
      .orderBy(desc(timeEntry.startedAt)),
  ]);
  return { totalMs: Number(totals.totalMs), mineMs: Number(totals.mineMs), myEntries };
}

/** Stores the IANA zone that time-tracking day boundaries use. */
export async function setUserTimezone(ctx: DomainContext, input: { timezone: string }) {
  const timezone = input.timezone.trim();
  try {
    // Throws RangeError for an unknown zone. Not canonicalized: that would turn "Asia/Kolkata" into "Asia/Calcutta".
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch (error) {
    if (error instanceof RangeError) throw new DomainError("Choose a valid time zone.");
    throw error;
  }
  await ctx.db.update(user).set({ timezone }).where(eq(user.id, ctx.actorUserId));
  return timezone;
}

/** Cron sweep: stops every timer that has been running for `STALE_MS` or more. */
export async function stopStaleTimers(db: DrizzleD1Database, now = Date.now()): Promise<number> {
  const stopped = await db.update(timeEntry).set(stopTimeEntryValues(now))
    .where(and(isNull(timeEntry.endedAt), lte(timeEntry.startedAt, new Date(now - STALE_MS))))
    .returning({ id: timeEntry.id });
  return stopped.length;
}
