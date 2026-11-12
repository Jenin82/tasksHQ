import { type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { activity } from "./schema/activity";

/** PLAN §2: the context every domain mutation takes, so provenance is by construction. */
export type DomainContext = {
  db: DrizzleD1Database;
  actorUserId: string;
  source: "web" | "mcp";
  clientId?: string;
  clientName?: string;
  emailNotifications?: boolean;
};

/**
 * A non-empty list of writes for one `ctx.db.batch(...)`, which D1 runs as a
 * single implicit transaction. Drizzle's `batch` demands a non-empty tuple, so
 * a list built up conditionally is declared with this type.
 */
export type BatchWrites = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/** The project- and status-level types from §3's table. `taskId` is null for every one. */
export type ProjectActivityType =
  | "project.created"
  | "project.member_added"
  | "project.member_removed"
  | "project.invite_created"
  | "project.invite_revoked"
  | "project.member_role_changed"
  | "project.task_edit_restriction_changed"
  | "status.created"
  | "status.renamed"
  | "status.recolored"
  | "status.reordered"
  | "status.deleted";

/**
 * The task-level types from §3's table, which always carry a `taskId`.
 *
 * `task.unarchived` carries the same `{}` payload as archiving.
 * `task.transferred` records a change of project and any remapped fields.
 */
export type TaskActivityType =
  | "task.created"
  | "task.updated"
  | "task.moved"
  | "task.transferred"
  | "task.archived"
  | "task.unarchived"
  | "comment.added";

export type ActivityType = ProjectActivityType | TaskActivityType;

/**
 * Returns the insert unawaited so the caller can put it in the same
 * `db.batch` as the write it records — D1 runs a batch as one implicit
 * transaction, so the mutation and its activity row land or fail together.
 */
export function writeActivity(
  ctx: DomainContext,
  entry: {
    projectId: string;
    taskId?: string | null;
    type: ActivityType;
    data: unknown;
  },
) {
  return ctx.db.insert(activity).values({
    id: crypto.randomUUID(),
    projectId: entry.projectId,
    taskId: entry.taskId ?? null,
    actorUserId: ctx.actorUserId,
    source: ctx.source,
    clientId: ctx.clientId ?? null,
    clientName: ctx.clientName ?? null,
    type: entry.type,
    data: JSON.stringify(entry.data),
    createdAt: new Date(),
  });
}

/**
 * A v4-UUID-shaped id generated in SQL, once per row, so an `INSERT … SELECT`
 * writing many activity rows gives each one the same id format
 * `crypto.randomUUID()` gives the rest.
 */
const SQL_UUID = sql.raw(
  "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || " +
    "substr(hex(randomblob(2)), 2) || '-' || " +
    "substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || " +
    "hex(randomblob(6)))",
);

/**
 * `writeActivity` as `INSERT … SELECT`, one row per row `rest` yields. The
 * id, actor, provenance and `created_at` are filled exactly as `writeActivity`
 * fills them; `projectId`, `taskId` and `data` may be SQL over `rest`'s rows
 * (`data` built with `json_object`, which serialises as `JSON.stringify` does).
 */
export function writeActivitySelect(
  ctx: DomainContext,
  entry: {
    projectId: SQL | string;
    taskId: SQL | string | null;
    type: ActivityType;
    data: SQL | string;
  },
  rest: SQL,
) {
  // Drizzle inserts a raw `select` into every column in the table's
  // definition order, so this list follows `schema/activity.ts`. (Not
  // `db.run`: Drizzle cannot bind its parameters inside a D1 batch.)
  return ctx.db.insert(activity).select(sql`
    select ${SQL_UUID}, ${entry.projectId}, ${entry.taskId}, ${ctx.actorUserId},
      ${ctx.source}, ${ctx.clientId ?? null}, ${ctx.clientName ?? null},
      ${entry.type}, ${entry.data}, ${Date.now()}
    ${rest}`);
}

/**
 * `writeActivity` for a guarded write: placed immediately after it in the
 * batch, the row is inserted only if that write changed a row. Without it a
 * write whose WHERE re-checks its precondition — and so matches nothing for
 * the loser of a race — would still commit its activity row, and the log
 * would record the event twice.
 */
export function writeActivityIfChanged(
  ctx: DomainContext,
  entry: Parameters<typeof writeActivity>[1],
) {
  return writeActivitySelect(
    ctx,
    {
      projectId: entry.projectId,
      taskId: entry.taskId ?? null,
      type: entry.type,
      data: JSON.stringify(entry.data),
    },
    sql`where changes() > 0`,
  );
}
