import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { DomainContext } from "../activity";
import { activity } from "../schema/activity";
import { project, status } from "../schema/project";
import { task } from "../schema/task";
import { timeEntry } from "../schema/time";
import { ACTIVITY_ROWID, taskKey } from "./task";
import { MAX_ENTRY_MS, overlapMs } from "./time";
import { listTimeReportEntries } from "./time-report";

export type WorkSummaryTask = {
  key: string;
  title: string;
  /** Project slug, as the sibling tools return it. */
  project: string;
  projectName: string;
  status: string;
  archived: boolean;
  minutes: number;
  notes: string[];
  created: { at: Date; status: string } | null;
  statusChanges: { from: string; to: string; at: Date }[];
  comments: { at: Date; excerpt: string }[];
};

/**
 * The caller's own work in one organization over `[from, to)`, for an MCP
 * client to write a summary from: tasks they logged time on, created, moved or
 * commented on, archived ones included. Status changes made by a transfer are
 * `task.transferred` and intentionally not listed; the task shows under its
 * current key.
 */
export async function getWorkSummaryData(
  ctx: DomainContext,
  input: { orgId: string; from: Date; to: Date },
): Promise<{ totalMinutes: number; tasks: WorkSummaryTask[] }> {
  const { db, actorUserId } = ctx;
  const { orgId, from, to } = input;
  // Checks membership and the range before anything else is read.
  const entries = await listTimeReportEntries(ctx, { orgId, from, to, userId: actorUserId });

  const acted = and(
    eq(activity.actorUserId, actorUserId),
    inArray(activity.type, ["task.created", "task.moved", "comment.added"]),
    gte(activity.createdAt, from),
    lt(activity.createdAt, to),
  );
  const inOrg = and(eq(project.id, task.projectId), eq(project.orgId, orgId));

  // Subqueries, not ID lists, so a busy range stays under D1's parameter limit.
  // Every selected column name is unique within its statement: D1's batch
  // results are keyed by column name, so same-named columns overwrite each other.
  const [actions, details, deletions] = await db.batch([
    db.select({
      taskId: task.id,
      type: activity.type,
      createdAt: activity.createdAt,
      fromId: sql<string | null>`json_extract(${activity.data}, '$.from.id')`.as("move_from_id"),
      from: sql<string | null>`json_extract(${activity.data}, '$.from.name')`,
      to: sql<string | null>`json_extract(${activity.data}, '$.to.name')`,
      createdStatus: sql<string | null>`json_extract(${activity.data}, '$.status.name')`,
      excerpt: sql<string | null>`json_extract(${activity.data}, '$.excerpt')`,
    }).from(activity)
      .innerJoin(task, eq(task.id, activity.taskId))
      .innerJoin(project, inOrg)
      .where(acted)
      .orderBy(asc(activity.createdAt), ACTIVITY_ROWID),
    db.select({
      id: task.id,
      number: task.number,
      title: task.title,
      projectKey: project.key,
      projectSlug: project.slug,
      // Aliased: both are `name`.
      projectName: sql<string>`${project.name}`.as("project_name"),
      status: sql<string>`${status.name}`.as("status_name"),
      archived: sql<number>`${task.archivedAt} is not null`,
    }).from(task)
      .innerJoin(project, inOrg)
      .innerJoin(status, eq(status.id, task.statusId))
      .where(or(
        inArray(task.id, db.select({ id: timeEntry.taskId }).from(timeEntry).where(and(
          eq(timeEntry.userId, actorUserId),
          eq(timeEntry.orgId, orgId),
          gte(timeEntry.startedAt, new Date(from.getTime() - MAX_ENTRY_MS)),
          lt(timeEntry.startedAt, to),
        ))),
        inArray(task.id, db.select({ id: activity.taskId }).from(activity).where(acted)),
      )),
    // The caller's own status deletions, to drop the remap moves they logged (below).
    // Up to 1s past `to`, so a remap just before `to` still finds its deletion.
    db.select({
      deletedId: sql<string | null>`json_extract(${activity.data}, '$.id')`.as("deleted_status_id"),
      deletedAt: sql<number>`${activity.createdAt}`.as("deleted_at"),
    }).from(activity).where(and(
      eq(activity.actorUserId, actorUserId),
      eq(activity.type, "status.deleted"),
      gte(activity.createdAt, from),
      lt(activity.createdAt, new Date(to.getTime() + 1000)),
    )),
  ]);

  // `deleteStatus` logs a `task.moved` per task it remaps, in the same batch as
  // its `status.deleted` row, by the same actor and with timestamps taken in
  // the same synchronous code. Those moves are not the caller's own work, so
  // drop a move whose from-status the caller deleted within 1s after it. No
  // project or `movedTo` match: a transfer rewrites the move's project_id,
  // `movedTo` is null when only a concurrently created task was remapped, and
  // status IDs are UUIDs.
  const remap = (a: (typeof actions)[number]) =>
    a.type === "task.moved" &&
    deletions.some((d) => {
      const gap = Number(d.deletedAt) - a.createdAt.getTime();
      return d.deletedId === a.fromId && gap >= 0 && gap <= 1000;
    });
  const kept = actions.filter((a) => !remap(a));

  const ms = new Map<string, number>();
  const notes = new Map<string, Set<string>>();
  for (const e of entries) {
    const m = overlapMs(e.startedAt.getTime(), e.endedAt.getTime(), from.getTime(), to.getTime());
    if (m === 0) continue;
    ms.set(e.taskId, (ms.get(e.taskId) ?? 0) + m);
    const note = e.note?.trim();
    if (note) notes.set(e.taskId, (notes.get(e.taskId) ?? new Set()).add(note));
  }

  const tasks = new Map<string, WorkSummaryTask>();
  for (const d of details) {
    tasks.set(d.id, {
      key: taskKey(d.projectKey, d.number),
      title: d.title,
      project: d.projectSlug,
      projectName: d.projectName,
      status: d.status,
      archived: Boolean(d.archived),
      minutes: Math.floor((ms.get(d.id) ?? 0) / 60_000),
      notes: [...(notes.get(d.id) ?? [])],
      created: null,
      statusChanges: [],
      comments: [],
    });
  }
  const active = new Set<string>();
  for (const a of kept) {
    const t = tasks.get(a.taskId);
    if (!t) continue;
    active.add(a.taskId);
    if (a.type === "task.created") t.created = { at: a.createdAt, status: a.createdStatus ?? "" };
    else if (a.type === "task.moved") t.statusChanges.push({ from: a.from ?? "", to: a.to ?? "", at: a.createdAt });
    else t.comments.push({ at: a.createdAt, excerpt: a.excerpt ?? "" });
  }

  // Only time on tasks the details read returned, so the total matches the list.
  let totalMs = 0;
  for (const id of tasks.keys()) totalMs += ms.get(id) ?? 0;
  return {
    totalMinutes: Math.floor(totalMs / 60_000),
    tasks: [...tasks.entries()]
      .filter(([id]) => (ms.get(id) ?? 0) > 0 || active.has(id))
      .map(([, t]) => t)
      .sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key, "en", { numeric: true })),
  };
}
