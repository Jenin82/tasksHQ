import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import {
  AccessError, canEditAnyTask, canEditTask, hasOrgMembership, hasTaskEditPermission, requireOrgMember, requireProjectMember, TaskEditForbidden,
} from "../access";
import {
  type BatchWrites,
  type DomainContext,
  type TaskActivityType,
  writeActivity,
  writeActivityIfChanged,
  writeActivitySelect,
} from "../activity";
import { activity } from "../schema/activity";
import { placeAfter } from "../position";
import {
  DomainError,
  MAX_LENGTH,
  assertMaxLength,
  isConstraintError,
} from "../errors";
import { user } from "../schema/auth";
import { orgMember, orgReportingLine } from "../schema/org";
import { type Project, type ProjectTaskType, type Status, project, projectTaskType, status } from "../schema/project";
import { TASK_PRIORITIES, type Comment, type CommentMention, type Task, type TaskPriority, comment, task, taskProjectAlias } from "../schema/task";
import { resolveCommentMentions } from "./comment-mentions";
import { queueAssignmentMail, queueCommentMentionMail, queueTaskEditMail } from "./mail";
import { queueSlackTaskEvent } from "./slack";

/**
 * §3: the display key is derived at read time from `project.key` and
 * `task.number`, never stored — storing it would go stale the moment
 * `project.key` changed.
 */
export function taskKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

/**
 * The inverse of `taskKey`, for the one place a key arrives as input: the
 * `/[org]/[project]/[task]` URL and §5.7's key-addressed MCP tools.
 *
 * The project key itself is `[A-Z][A-Z0-9]{1,5}` (`assertValidProjectKey`), so
 * it never contains the `-`, and the number comes from a counter that starts
 * at one — hence no `0` and no leading zeros, which would otherwise give one
 * task two URLs. Case is *not* decided here: this returns what was typed and
 * `getTaskByKey` compares case-insensitively.
 */
export function parseTaskKey(
  key: string,
): { projectKey: string; number: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]{1,5})-([1-9]\d*)$/.exec(key.trim());
  if (!match) return null;
  return { projectKey: match[1], number: Number(match[2]) };
}

export type UserRef = { id: string; displayName: string } | null;

export type StatusRef = { id: string; name: string };

export type TaskTypeRef = Pick<ProjectTaskType, "id" | "name" | "color" | "icon">;

export type TaskSummary = {
  id: string;
  key: string;
  number: number;
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  type: TaskTypeRef;
  status: Pick<Status, "id" | "name" | "color">;
  assignee: (NonNullable<UserRef> & { image?: string }) | null;
  createdBy: NonNullable<UserRef>;
  reportedBy: NonNullable<UserRef> & { image?: string };
  position: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TaskDetail = TaskSummary & {
  projectId: string;
  description: string | null;
};

// URL/key-addressed callers carry their resolved location through the write.
type TaskTarget = { taskId: string; projectId?: string; number?: number };

/** §3: `task.updated` carries scalars as plain `{from, to}`. */
export type ScalarChange = { from: string | null; to: string | null };

/**
 * §3: assignee and reporter are the non-scalar fields `task.updated` carries,
 * spelled out because `null` on both sides of an assignee change is meaningful.
 * A reporter is never cleared.
 */
export type UpdatedFields = {
  title?: ScalarChange;
  description?: ScalarChange;
  dueDate?: ScalarChange;
  priority?: { from: TaskPriority; to: TaskPriority };
  type?: { from: string; to: string };
  assignee?: { from: UserRef; to: UserRef };
  reporter?: { from: NonNullable<UserRef>; to: NonNullable<UserRef> };
};

export type TaskComment = {
  id: string;
  body: string;
  author: { id: string; displayName: string };
  source: "web" | "mcp";
  createdAt: Date;
  mentions?: CommentMention[];
};

/**
 * §3's activity table, transcribed as types. Every task-level payload shape is
 * pinned there literally; this is the one place that spelling is written down
 * for a reader rather than a writer.
 */
type TaskActivityPayload = {
  "task.created": { title: string; status: StatusRef };
  "task.updated": { fields: UpdatedFields };
  "task.moved": { from: StatusRef; to: StatusRef };
  "task.transferred": {
    status: { from: string; to: string };
    fields: UpdatedFields;
  };
  "task.archived": Record<string, never>;
  "task.unarchived": Record<string, never>;
  "comment.added": { commentId: string; excerpt: string };
};

type ActivityMeta = {
  id: string;
  actor: { id: string; displayName: string };
  /** §2's provenance: which surface, and — for MCP — which agent. */
  source: "web" | "mcp";
  clientId: string | null;
  clientName: string | null;
  createdAt: Date;
};

/**
 * Keyed off `TaskActivityType` deliberately: adding a type there without a
 * payload here fails to compile, and a renderer that switches over this union
 * with a `never` default fails to compile when it omits a case.
 */
export type TaskActivityEntry = {
  [K in TaskActivityType]: ActivityMeta & { type: K; data: TaskActivityPayload[K] };
}[TaskActivityType];

/**
 * §5.7's `get_task` return shape, so the web detail page and the MCP tool read
 * through one implementation rather than two compositions that can drift.
 */
export type TaskWithHistory = TaskDetail & {
  comments: TaskComment[];
  activity: TaskActivityEntry[];
};

const EXCERPT_LENGTH = 140;

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

const creator = alias(user, "task_creator");
const reporter = alias(user, "task_reporter");

const taskTypeJoin = and(
  eq(projectTaskType.projectId, task.projectId),
  or(eq(projectTaskType.id, task.typeId), and(isNull(task.typeId), eq(projectTaskType.isDefault, true))),
);

const DETAIL_COLUMNS = {
  id: task.id,
  projectId: task.projectId,
  number: task.number,
  title: task.title,
  description: task.description,
  dueDate: task.dueDate,
  priority: task.priority,
  type: { id: projectTaskType.id, name: projectTaskType.name, color: projectTaskType.color, icon: projectTaskType.icon },
  position: task.position,
  archivedAt: task.archivedAt,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  statusId: status.id,
  statusName: status.name,
  statusColor: status.color,
  assigneeId: user.id,
  assigneeName: user.name,
  assigneeImage: user.image,
  creatorId: creator.id,
  creatorName: creator.name,
  reporterId: reporter.id,
  reporterName: reporter.name,
  reporterImage: reporter.image,
};

type DetailRow = Awaited<ReturnType<typeof detailQuery>>[number];

function toDetail(row: DetailRow, projectKey: string): TaskDetail {
  return {
    id: row.id,
    key: taskKey(projectKey, row.number),
    projectId: row.projectId,
    number: row.number,
    title: row.title,
    description: row.description,
    dueDate: row.dueDate,
    priority: row.priority,
    type: row.type,
    status: {
      id: row.statusId,
      name: row.statusName,
      color: row.statusColor,
    },
    assignee:
      row.assigneeId && row.assigneeName
        ? {
            id: row.assigneeId,
            displayName: row.assigneeName,
            ...(row.assigneeImage ? { image: row.assigneeImage } : {}),
          }
        : null,
    createdBy: { id: row.creatorId, displayName: row.creatorName },
    reportedBy: {
      id: row.reporterId,
      displayName: row.reporterName,
      ...(row.reporterImage ? { image: row.reporterImage } : {}),
    },
    position: row.position,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function detailQuery(db: DrizzleD1Database) {
  return db
    .select(DETAIL_COLUMNS)
    .from(task)
    .innerJoin(status, eq(status.id, task.statusId))
    .innerJoin(projectTaskType, taskTypeJoin)
    .innerJoin(creator, eq(creator.id, task.createdByUserId))
    .innerJoin(reporter, eq(reporter.id, task.reporterUserId))
    .leftJoin(user, eq(user.id, task.assigneeUserId));
}

async function readDetail(
  db: DrizzleD1Database,
  taskId: string,
  p: Project,
  number: number,
): Promise<TaskDetail> {
  const [row] = await detailQuery(db).where(taskInProject(taskId, p.id, number));
  if (!row) {
    throw new AccessError("not_a_member", "No such task.");
  }
  return toDetail(row, p.key);
}

/** Active assignments in the viewer's organization. */
export async function listWorkspaceAssignments(
  ctx: DomainContext,
  input: { orgId: string; view: "mine" | "assigned" | "team" },
) {
  const { db, actorUserId } = ctx;
  await requireOrgMember(db, input.orgId, actorUserId);
  const rankedAssignments = input.view === "assigned" ? db.select({
    taskId: activity.taskId,
    actorId: activity.actorUserId,
    assigneeId: sql<string | null>`json_extract(${activity.data}, '$.fields.assignee.to.id')`.as("assigned_user_id"),
    rank: sql<number>`row_number() over (
      partition by ${activity.taskId}
      order by ${activity.createdAt} desc, ${ACTIVITY_ROWID} desc
    )`.as("assignment_rank"),
  })
    .from(activity)
    .innerJoin(project, eq(project.id, activity.projectId))
    .where(and(
      eq(project.orgId, input.orgId),
      eq(activity.type, "task.updated"),
      sql`json_type(${activity.data}, '$.fields.assignee') = 'object'`,
    ))
    .as("ranked_assignments") : null;

  let assigned;
  if (rankedAssignments) {
    // With no reassignment in the log, a task that has an assignee was
    // assigned at creation. A later clear or change takes precedence.
    assigned = and(
      ne(task.assigneeUserId, actorUserId),
      or(
        and(isNull(rankedAssignments.taskId), eq(task.createdByUserId, actorUserId)),
        and(eq(rankedAssignments.actorId, actorUserId), eq(rankedAssignments.assigneeId, task.assigneeUserId)),
      ),
    );
  } else if (input.view === "mine") {
    assigned = eq(task.assigneeUserId, actorUserId);
  } else {
    assigned = inArray(
      task.assigneeUserId,
      db.select({ userId: orgReportingLine.userId })
        .from(orgReportingLine)
        .where(and(eq(orgReportingLine.orgId, input.orgId), eq(orgReportingLine.leadUserId, actorUserId))),
    );
  }

  const query = db
    .select({
      id: task.id,
      number: task.number,
      title: task.title,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      dueDate: task.dueDate,
      priority: task.priority,
      type: { id: projectTaskType.id, name: projectTaskType.name, color: projectTaskType.color, icon: projectTaskType.icon },
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
      projectKey: project.key,
      status: { id: status.id, name: status.name, color: status.color },
      assignee: { id: user.id, displayName: user.name },
      createdBy: { id: creator.id, displayName: creator.name },
      reportedBy: { id: reporter.id, displayName: reporter.name },
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .innerJoin(status, eq(status.id, task.statusId))
    .innerJoin(projectTaskType, taskTypeJoin)
    .innerJoin(user, eq(user.id, task.assigneeUserId))
    .innerJoin(creator, eq(creator.id, task.createdByUserId))
    .innerJoin(reporter, eq(reporter.id, task.reporterUserId))
    .$dynamic();
  if (rankedAssignments) {
    query.leftJoin(rankedAssignments, and(
      eq(rankedAssignments.taskId, task.id),
      eq(rankedAssignments.rank, 1),
    ));
  }
  const rows = await query
    .where(and(eq(project.orgId, input.orgId), assigned, isNull(task.archivedAt)))
    .orderBy(desc(task.updatedAt), asc(task.id));

  return rows.map(({ projectKey, number, createdAt, updatedAt, ...row }) => ({
    ...row,
    key: taskKey(projectKey, number),
    createdAt: createdAt.getTime(),
    updatedAt: updatedAt.getTime(),
  }));
}

/**
 * Board and table rows, ordered the way §3 pins it: `position, id` within a
 * `(projectId, statusId)` column.
 *
 * `includeArchived` defaults to false, matching §5.7's `list_tasks`.
 * The Archived view asks for archived rows only, newest archive first.
 */
export async function listTasks(
  ctx: DomainContext,
  input: {
    projectId: string;
    statusId?: string;
    assigneeUserId?: string;
    includeArchived?: boolean;
    archivedOnly?: boolean;
  },
): Promise<TaskSummary[]> {
  const { project: p } = await requireProjectMember(
    ctx.db,
    input.projectId,
    ctx.actorUserId,
  );

  const rows = await detailQuery(ctx.db)
    .where(
      and(
        eq(task.projectId, input.projectId),
        input.statusId ? eq(task.statusId, input.statusId) : undefined,
        input.assigneeUserId
          ? eq(task.assigneeUserId, input.assigneeUserId)
          : undefined,
        input.archivedOnly
          ? isNotNull(task.archivedAt)
          : input.includeArchived ? undefined : isNull(task.archivedAt),
      ),
    )
    .orderBy(
      input.archivedOnly ? desc(task.archivedAt) : asc(task.position),
      asc(task.id),
    );

  return rows.map((row) => toDetail(row, p.key));
}

export async function getTask(
  ctx: DomainContext,
  input: TaskTarget,
): Promise<TaskDetail> {
  const { row, project: p } = await loadTask(ctx, input);
  return readDetail(ctx.db, row.id, p, row.number);
}

/**
 * §3's ordering rule, and the only expression of it.
 *
 * `created_at, id` is wrong and was verified wrong in real data: two rows
 * written one `await` apart share a `created_at` millisecond, and the id is a
 * random UUID, so a `task.updated` + `task.moved` pair from one `updateTask`
 * call would render in arbitrary order and flip between loads. SQLite's
 * implicit `rowid` is monotonic for sequential inserts and nothing in this
 * codebase deletes activity rows, so it is a stable tiebreak with no schema
 * change. Drizzle has no column for an implicit rowid — it is not in the
 * table definition and selecting it is not needed — so it is reached with a
 * raw `sql` fragment, table-qualified because these reads join `user`.
 */
const ACTIVITY_ROWID = sql`"activity"."rowid"`;
const COMMENT_ROWID = sql`"comment"."rowid"`;

/**
 * §5.7's `get_task` composition: the task, its comments oldest-first, and its
 * activity log. `getTask` deliberately returns neither, so this is the one
 * place the three are assembled and M2's tool reuses it rather than
 * reassembling them.
 */
export async function getTaskDetail(
  ctx: DomainContext,
  input: TaskTarget,
): Promise<TaskWithHistory> {
  const { row, project: p } = await loadTask(ctx, input);
  return readTaskHistory(ctx.db, row.id, p, row.number);
}

async function readTaskHistory(db: DrizzleD1Database, taskId: string, p: Project, number: number): Promise<TaskWithHistory> {
  const scope = taskInProject(taskId, p.id, number);
  const stillInProject = exists(db.select({ id: task.id }).from(task).where(scope));
  const commentQuery = db
    .select({
      id: comment.id,
      body: comment.body,
      mentions: comment.mentions,
      source: comment.source,
      createdAt: comment.createdAt,
      authorId: user.id,
      authorName: user.name,
    })
    .from(comment)
    .innerJoin(user, eq(user.id, comment.userId))
    .where(and(eq(comment.taskId, taskId), stillInProject))
    // Oldest first. Two comments can share a millisecond for the same reason
    // two activity rows can, so the tiebreak is the same one.
    .orderBy(asc(comment.createdAt), COMMENT_ROWID);

  const activityQuery = db
    .select({
      id: activity.id,
      type: activity.type,
      data: activity.data,
      source: activity.source,
      clientId: activity.clientId,
      clientName: activity.clientName,
      createdAt: activity.createdAt,
      actorId: user.id,
      actorName: user.name,
    })
    .from(activity)
    .innerJoin(user, eq(user.id, activity.actorUserId))
    .where(and(eq(activity.taskId, taskId), stillInProject))
    .orderBy(asc(activity.createdAt), ACTIVITY_ROWID);

  // Scope every read so an in-flight move cannot expose destination history
  // to a caller who only reached the task in its original project.
  const [[row], commentRows, activityRows] = await Promise.all([
    detailQuery(db).where(scope),
    commentQuery,
    activityQuery,
  ]);
  if (!row) throw new AccessError("not_a_member", "No such task.");

  return {
    ...toDetail(row, p.key),
    comments: commentRows.map((row) => ({
      id: row.id,
      body: row.body,
      ...(row.mentions?.length ? { mentions: row.mentions } : {}),
      author: { id: row.authorId, displayName: row.authorName },
      source: row.source,
      createdAt: row.createdAt,
    })),
    // `data` is `text` (§12), and §3 pins its shape per `type`. The cast is
    // the one place that pinning is taken on trust; everything downstream is
    // checked against `TaskActivityType`.
    activity: activityRows.map(
      (row) =>
        ({
          id: row.id,
          type: row.type,
          data: JSON.parse(row.data),
          source: row.source,
          clientId: row.clientId,
          clientName: row.clientName,
          createdAt: row.createdAt,
          actor: { id: row.actorId, displayName: row.actorName },
        }) as TaskActivityEntry,
    ),
  };
}

/**
 * Resolves the display key the URL and §5.7's tools carry — `WEB-5` — inside
 * a project the caller has already been proved to reach.
 *
 * The key is derived at read time (§3), so resolving one means parsing it
 * back. **Case-insensitive on the project-key half**: `project.key` is
 * uppercase by construction while the org and project slugs sharing the URL
 * are lowercase, so a hand-typed `/acme/web/web-5` is the ordinary case, not
 * an error worth a 404. The number is matched exactly.
 *
 * An unparseable key, a key naming a different project and a task that is not
 * there are the identical `AccessError("not_a_member")` that `loadTask`
 * throws, so an unresolvable key and an unreachable one cannot be told apart.
 */
export async function getTaskByKey(
  ctx: DomainContext,
  input: { projectId: string; key: string },
): Promise<TaskWithHistory> {
  const { project: p, number } = await projectTaskNumber(ctx, input);
  const [row] = await ctx.db.select({ id: task.id }).from(task).where(
    and(eq(task.projectId, p.id), eq(task.number, number)),
  );
  if (!row) throw new AccessError("not_a_member", "No such task.");
  return readTaskHistory(ctx.db, row.id, p, number);
}

async function projectTaskNumber(ctx: DomainContext, input: { projectId: string; key: string }) {
  const { project: p } = await requireProjectMember(
    ctx.db,
    input.projectId,
    ctx.actorUserId,
  );

  const parsed = parseTaskKey(input.key);
  if (!parsed || parsed.projectKey.toUpperCase() !== p.key.toUpperCase()) {
    throw new AccessError("not_a_member", "No such task.");
  }

  return { project: p, number: parsed.number };
}

export async function getTaskSummaryByKey(ctx: DomainContext, input: { projectId: string; key: string }) {
  const { project: p, number } = await projectTaskNumber(ctx, input);
  const [row] = await detailQuery(ctx.db).where(and(eq(task.projectId, p.id), eq(task.number, number)));
  if (!row) throw new AccessError("not_a_member", "No such task.");
  return toDetail(row, p.key);
}

export async function findMovedTaskByKey(ctx: DomainContext, input: { projectId: string; key: string }) {
  const { project: source, number } = await projectTaskNumber(ctx, input);
  const [destination] = await ctx.db
    .select({ projectId: task.projectId, number: task.number })
    .from(taskProjectAlias)
    .innerJoin(task, eq(task.id, taskProjectAlias.taskId))
    .where(and(eq(taskProjectAlias.projectId, source.id), eq(taskProjectAlias.number, number)));
  if (!destination) return null;

  const { project: target } = await requireProjectMember(ctx.db, destination.projectId, ctx.actorUserId);
  return { projectSlug: target.slug, key: taskKey(target.key, destination.number) };
}

// ---------------------------------------------------------------------------
// shared internals
// ---------------------------------------------------------------------------

function taskInProject(taskId: string, projectId: string, number?: number) {
  return and(eq(task.id, taskId), eq(task.projectId, projectId),
    number === undefined ? undefined : eq(task.number, number))!;
}

function currentTaskScope(row: Task) {
  return taskInProject(row.id, row.projectId, row.number);
}

/**
 * Every task mutation starts here, so §3's project-reach rule has exactly one
 * implementation. A task that does not exist and a task the caller cannot
 * reach give the same answer, so existence does not leak — the same contract
 * `requireProjectMember` keeps for projects.
 */
async function loadTask(
  ctx: DomainContext,
  input: TaskTarget,
) {
  const [row] = await ctx.db.select().from(task).where(and(
    eq(task.id, input.taskId),
    input.projectId === undefined ? undefined : eq(task.projectId, input.projectId),
    input.number === undefined ? undefined : eq(task.number, input.number),
  ));
  if (!row) {
    throw new AccessError("not_a_member", "No such task.");
  }
  const access = await requireProjectMember(
    ctx.db,
    row.projectId,
    ctx.actorUserId,
  );
  return { row, ...access };
}

async function loadEditableTask(ctx: DomainContext, input: TaskTarget) {
  const access = await loadTask(ctx, input);
  const { row } = access;
  if (!canEditTask(canEditAnyTask(access), ctx.actorUserId, row.createdByUserId, row.assigneeUserId, row.reporterUserId)) {
    throw new TaskEditForbidden();
  }
  const scope = and(currentTaskScope(row), hasTaskEditPermission(ctx.db, row.projectId, ctx.actorUserId))!;
  return { ...access, scope };
}

async function commitTaskEdit(
  ctx: DomainContext,
  row: Task,
  scope: SQL,
  values: Partial<typeof task.$inferInsert>,
  writes: BatchItem<"sqlite">[],
) {
  // All preceding statements use this same guard before the assignee can change.
  const edit = ctx.db.update(task).set(values).where(scope).returning({ id: task.id });
  const [first, ...rest] = writes;
  const updated = first ? (await ctx.db.batch([first, ...rest, edit])).at(-1) : await edit;
  if (Array.isArray(updated) && updated.length) return;
  await loadEditableTask(ctx, { taskId: row.id, projectId: row.projectId, number: row.number });
  throw new DomainError("The task changed. Refresh and try again.");
}

async function requireStatusInProject(
  db: DrizzleD1Database,
  projectId: string,
  statusId: string,
): Promise<Status> {
  const [row] = await db
    .select()
    .from(status)
    .where(and(eq(status.id, statusId), eq(status.projectId, projectId)));
  if (!row) {
    throw new DomainError("No such status in this project.");
  }
  return row;
}

/** An assignee or reporter must belong to the task's organization. */
async function requireAssignableUser(
  db: DrizzleD1Database,
  orgId: string,
  userId: string,
): Promise<{ id: string; displayName: string }> {
  const [ref] = await db.select({ id: user.id, displayName: user.name })
    .from(orgMember).innerJoin(user, eq(user.id, orgMember.userId))
    .where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, userId)));
  if (!ref) throw new DomainError("That user must be a member of this organization.");
  return ref;
}

async function displayUser(
  db: DrizzleD1Database,
  userId: string | null,
): Promise<UserRef> {
  if (!userId) return null;
  const [row] = await db
    .select({ displayName: user.name })
    .from(user)
    .where(eq(user.id, userId));
  if (!row) {
    throw new DomainError("No such user.");
  }
  return { id: userId, displayName: row.displayName };
}

/**
 * §3: one atomic statement, because D1 has no interactive transactions and a
 * read-then-write would race. A failed insert afterwards leaves a gap in the
 * sequence; that is deliberate and acceptable, so do not "fix" it.
 */
async function allocateTaskNumber(
  db: DrizzleD1Database,
  projectId: string,
): Promise<number> {
  const [row] = await db
    .update(project)
    .set({ taskCounter: sql`${project.taskCounter} + 1` })
    .where(eq(project.id, projectId))
    .returning({ number: project.taskCounter });
  if (!row) {
    throw new DomainError("No such project.");
  }
  return row.number;
}

/**
 * Positions are fractional indices scoped to `(projectId, statusId)`, so the
 * neighbours are read from that column alone.
 *
 * `afterTaskId` is `undefined` to append, `null` to place first, or the id the
 * task should sit directly after — the shape `reorderStatus` established.
 *
 * Returns the key plus any `rekeys` the caller must batch with its own write.
 */
async function positionIn(
  db: DrizzleD1Database,
  projectId: string,
  statusId: string,
  selfTaskId: string | null,
  afterTaskId: string | null | undefined,
  moveGuard?: SQL,
): Promise<{ position: string; rekeys: BatchItem<"sqlite">[] }> {
  const siblings = await db
    .select({ id: task.id, position: task.position, number: task.number })
    .from(task)
    .where(
      and(
        eq(task.projectId, projectId),
        eq(task.statusId, statusId),
        selfTaskId ? ne(task.id, selfTaskId) : undefined,
      ),
    )
    .orderBy(asc(task.position), asc(task.id));

  // Appending is placing after the last sibling.
  const afterIndex =
    afterTaskId === undefined
      ? siblings.length - 1
      : afterTaskId
        ? siblings.findIndex((s) => s.id === afterTaskId)
        : -1;
  if (afterTaskId && afterIndex === -1) {
    throw new DomainError("No such task in that column.");
  }

  // `updatedAt` is not bumped on re-keyed rows, since nobody edited those tasks.
  const { position, rekeys } = placeAfter(siblings, afterIndex);
  const numbers = rekeys.length ? new Map(siblings.map((sibling) => [sibling.id, sibling.number])) : null;
  return {
    position,
    rekeys: rekeys.map((r) =>
      db.update(task).set({ position: r.position }).where(and(
        taskInProject(r.id, projectId, numbers?.get(r.id)), eq(task.statusId, statusId), moveGuard,
      )),
    ),
  };
}

type MovePlan = {
  from: Status;
  to: Status;
  position: string;
  rekeys: BatchItem<"sqlite">[];
};

/**
 * §3's first activity rule, made structural: a logged status change uses
 * `task.moved` and never `task.updated`. Same-project status moves use
 * `planMove` and `logMove` together.
 */
async function planMove(
  ctx: DomainContext,
  row: Task,
  toStatusId: string,
  afterTaskId: string | null | undefined,
  scope: SQL,
): Promise<MovePlan> {
  const to = await requireStatusInProject(ctx.db, row.projectId, toStatusId);
  const from =
    to.id === row.statusId
      ? to
      : await requireStatusInProject(ctx.db, row.projectId, row.statusId);
  return {
    from,
    to,
    ...(await positionIn(ctx.db, row.projectId, to.id, row.id, afterTaskId,
      exists(ctx.db.select({ id: task.id }).from(task).where(scope)))),
  };
}

const CREATION_EDIT_WINDOW_MS = 5 * 60 * 1000;
const DESCRIPTION_SAVE_WINDOW_MS = 10 * 60 * 1000;

/** Decide against the latest activity inside the same transaction as the edit. */
function writeTaskEditActivity(
  ctx: DomainContext,
  row: Task,
  now: Date,
  scope: SQL,
  event: { type: "task.updated"; data: { fields: UpdatedFields } }
    | { type: "task.moved"; data: { from: StatusRef; to: StatusRef } },
) {
  const entry = { projectId: row.projectId, taskId: row.id, ...event };
  const current = exists(ctx.db.select({ id: task.id }).from(task).where(scope));
  const write = (rest = sql.empty()) => writeActivitySelect(ctx, {
    projectId: entry.projectId,
    taskId: entry.taskId,
    type: entry.type,
    data: JSON.stringify(entry.data),
  }, sql`where ${current} ${rest}`);

  const elapsed = now.getTime() - row.createdAt.getTime();
  const isSetup = ctx.actorUserId === row.createdByUserId && elapsed >= 0 && elapsed <= CREATION_EDIT_WINDOW_MS;
  const fields = event.type === "task.updated" ? event.data.fields : undefined;
  const isDescriptionSave = fields?.description?.to != null && Object.keys(fields).length === 1;
  if (!isSetup && !isDescriptionSave) return write();

  // A later reassignment by another actor must stay visible to Assigned by you.
  // Once any event follows creation, the setup period can no longer suppress edits.
  const suppressSetup = isSetup ? sql`when ${activity.type} = 'task.created' then 0` : sql.empty();
  const suppressDescription = isDescriptionSave ? sql`
    when ${activity.type} = 'task.updated'
      and ${activity.actorUserId} = ${ctx.actorUserId}
      and ${activity.source} = ${ctx.source}
      and ${activity.clientId} is ${ctx.clientId ?? null}
      and ${activity.clientName} is ${ctx.clientName ?? null}
      and ${activity.createdAt} >= ${now.getTime() - DESCRIPTION_SAVE_WINDOW_MS}
      and json_type(${activity.data}, '$.fields.description.to') = 'text'
      and (select count(*) from json_each(${activity.data}, '$.fields')) = 1
    then 0` : sql.empty();

  return write(sql`
    and coalesce((
      select case ${suppressSetup} ${suppressDescription} else 1 end
      from ${activity}
      where ${activity.taskId} = ${row.id}
      order by ${activity.createdAt} desc, ${ACTIVITY_ROWID} desc
      limit 1
    ), 1) = 1`);
}

function logMove(ctx: DomainContext, row: Task, plan: MovePlan, now: Date, scope: SQL) {
  return writeTaskEditActivity(ctx, row, now, scope, {
    type: "task.moved",
    data: {
      from: { id: plan.from.id, name: plan.from.name },
      to: { id: plan.to.id, name: plan.to.name },
    },
  });
}

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------

export async function createTask(
  ctx: DomainContext,
  input: {
    projectId: string;
    title: string;
    description?: string | null;
    dueDate?: string | null;
    priority?: string;
    typeId?: string;
    statusId?: string;
    assigneeUserId?: string | null;
    reporterUserId?: string;
  },
): Promise<TaskDetail> {
  // Project reach is the whole rule: §3's matrix gives tasks no capability, so
  // any member of the project may create one.
  const { project: p } = await requireProjectMember(
    ctx.db,
    input.projectId,
    ctx.actorUserId,
  );

  const title = taskTitle(input.title);
  const description = taskDescription(input.description);
  const dueDate = taskDueDate(input.dueDate ?? null);
  const priority = taskPriority(input.priority === undefined ? "medium" : input.priority);

  if (input.typeId !== undefined) await resolveTaskType(ctx.db, input.projectId, input.typeId);

  const target = input.statusId
    ? await requireStatusInProject(ctx.db, input.projectId, input.statusId)
    : await firstStatus(ctx.db, input.projectId);

  if (input.assigneeUserId) {
    await requireAssignableUser(ctx.db, p.orgId, input.assigneeUserId);
  }
  if (input.reporterUserId) {
    await requireAssignableUser(ctx.db, p.orgId, input.reporterUserId);
  }

  // Appending never re-keys. Concurrent creates can all read the same last
  // key and store equal positions; `positionIn` repairs such a run when a
  // later move needs a gap inside it.
  const { position } = await positionIn(
    ctx.db,
    input.projectId,
    target.id,
    null,
    undefined,
  );

  // Last, so a validation failure above does not burn a number. Its own
  // statement, outside the batch below: the insert needs the number it
  // returns, and §3 already accepts the gap a failed insert leaves.
  const number = await allocateTaskNumber(ctx.db, input.projectId);

  const now = new Date();
  const id = crypto.randomUUID();
  try {
    const writes: BatchWrites = [
      ctx.db.insert(task).values({
        id,
        projectId: input.projectId,
        number,
        title,
        description,
        dueDate,
        priority,
        typeId: input.typeId,
        statusId: target.id,
        assigneeUserId: input.assigneeUserId ?? null,
        reporterUserId: input.reporterUserId ?? ctx.actorUserId,
        position,
        archivedAt: null,
        createdByUserId: ctx.actorUserId,
        createdAt: now,
        updatedAt: now,
      }),
      writeActivity(ctx, {
        projectId: input.projectId,
        taskId: id,
        type: "task.created",
        data: { title, status: { id: target.id, name: target.name } },
      }),
      queueSlackTaskEvent(ctx, id),
    ];
    if (ctx.emailNotifications && input.assigneeUserId && input.assigneeUserId !== ctx.actorUserId) {
      writes.push(queueAssignmentMail(ctx, id, input.assigneeUserId, sql`1`));
    }
    await ctx.db.batch(writes);
  } catch (error) {
    // The chosen status or type can be removed after validation. The number
    // is burned if the insert loses that race, which §3 accepts.
    if (isConstraintError(error, "FOREIGN KEY")) {
      if (input.typeId !== undefined) await resolveTaskType(ctx.db, input.projectId, input.typeId);
      throw new DomainError("No such status in this project.");
    }
    throw error;
  }

  return readDetail(ctx.db, id, p, number);
}

function taskTitle(input: string): string {
  const title = input.trim();
  if (!title) {
    throw new DomainError("Task title is required.");
  }
  assertMaxLength("Task title", title, MAX_LENGTH.title);
  return title;
}

function taskDescription(input: string | null | undefined): string | null {
  const description = input?.trim() || null;
  if (description) {
    assertMaxLength("Description", description, MAX_LENGTH.description);
  }
  return description;
}

function taskDueDate(input: string | null): string | null {
  if (input === null) return null;

  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input) && !input.startsWith("0000")) {
    const date = new Date(`${input}T00:00:00Z`);
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === input) {
      return input;
    }
  }

  throw new DomainError("Enter a valid due date.");
}

async function resolveTaskType(db: DrizzleD1Database, projectId: string, typeId?: string): Promise<Pick<TaskTypeRef, "id" | "name">> {
  const [type] = await db
    .select({ id: projectTaskType.id, name: projectTaskType.name })
    .from(projectTaskType)
    .where(and(
      eq(projectTaskType.projectId, projectId),
      typeId === undefined ? eq(projectTaskType.isDefault, true) : eq(projectTaskType.id, typeId),
    ))
    .limit(1);
  if (!type) throw new DomainError(typeId === undefined ? "This project has no default task type." : "No such task type in this project.");
  return type;
}

function taskPriority(input: string): TaskPriority {
  const priority = TASK_PRIORITIES.find((value) => value === input);
  if (priority === undefined) throw new DomainError("Choose a valid priority.");
  return priority;
}

/** §5.7's default for a task created without a status. */
async function firstStatus(
  db: DrizzleD1Database,
  projectId: string,
): Promise<Status> {
  const [row] = await db
    .select()
    .from(status)
    .where(eq(status.projectId, projectId))
    .orderBy(asc(status.position), asc(status.id))
    .limit(1);
  if (!row) {
    throw new DomainError(
      "This project has no statuses. Add a status before creating a task.",
    );
  }
  return row;
}

/**
 * A status passed here is a move, not an update: it is routed through the same
 * `planMove`/`logMove` pair `moveTask` uses, so an MCP `update_task(status:…)`
 * and a board drag produce the identical `task.moved` row (§3). `task.updated`
 * never carries a status field.
 *
 * `undefined` leaves a field alone; `null` clears the description, due date,
 * or assignee.
 */
export async function updateTask(
  ctx: DomainContext,
  input: TaskTarget & {
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    priority?: string;
    typeId?: string;
    statusId?: string;
    assigneeUserId?: string | null;
    reporterUserId?: string;
  },
): Promise<TaskDetail> {
  const { row, project: p, scope } = await loadEditableTask(ctx, input);

  const columns: Partial<typeof task.$inferInsert> = {};
  const fields: UpdatedFields = {};

  if (input.title !== undefined) {
    const title = taskTitle(input.title);
    if (title !== row.title) {
      columns.title = title;
      fields.title = { from: row.title, to: title };
    }
  }

  if (input.description !== undefined) {
    const description = taskDescription(input.description);
    if (description !== row.description) {
      columns.description = description;
      fields.description = { from: row.description, to: description };
    }
  }

  if (input.dueDate !== undefined) {
    const dueDate = taskDueDate(input.dueDate);
    if (dueDate !== row.dueDate) {
      columns.dueDate = dueDate;
      fields.dueDate = { from: row.dueDate, to: dueDate };
    }
  }

  if (input.priority !== undefined) {
    const priority = taskPriority(input.priority);
    if (priority !== row.priority) {
      columns.priority = priority;
      fields.priority = { from: row.priority, to: priority };
    }
  }

  if (input.typeId !== undefined && input.typeId !== row.typeId) {
    const to = await resolveTaskType(ctx.db, row.projectId, input.typeId);
    const from = await resolveTaskType(ctx.db, row.projectId, row.typeId ?? undefined);
    columns.typeId = to.id;
    fields.type = { from: from.name, to: to.name };
  }

  if (
    input.assigneeUserId !== undefined &&
    input.assigneeUserId !== row.assigneeUserId
  ) {
    const to = input.assigneeUserId
      ? await requireAssignableUser(ctx.db, p.orgId, input.assigneeUserId)
      : null;
    columns.assigneeUserId = input.assigneeUserId;
    fields.assignee = {
      from: await displayUser(ctx.db, row.assigneeUserId),
      to,
    };
  }

  if (input.reporterUserId !== undefined && input.reporterUserId !== row.reporterUserId) {
    const to = await requireAssignableUser(ctx.db, p.orgId, input.reporterUserId);
    // Backfill and the insert trigger guarantee a reporter.
    const from = (await displayUser(ctx.db, row.reporterUserId!))!;
    columns.reporterUserId = input.reporterUserId;
    fields.reporter = { from, to };
  }

  // Appends to the end of the destination column: a caller that cares where
  // the card lands uses `moveTask`.
  const plan =
    input.statusId !== undefined && input.statusId !== row.statusId
      ? await planMove(ctx, row, input.statusId, undefined, scope)
      : null;
  if (plan) {
    columns.statusId = plan.to.id;
    columns.position = plan.position;
  }

  if (Object.keys(columns).length === 0) {
    return readDetail(ctx.db, row.id, p, row.number);
  }

  // `task.updated` before `task.moved`: §3 orders activity by rowid, so the
  // batch order is the order the log renders.
  const now = new Date();
  const writes: BatchItem<"sqlite">[] = [];
  if (Object.keys(fields).length > 0) {
    writes.push(
      writeTaskEditActivity(ctx, row, now, scope, {
        type: "task.updated",
        data: { fields },
      }),
    );
  }
  if (plan) {
    writes.unshift(queueSlackTaskEvent(ctx, row.id, { statusId: plan.to.id, title: fields.title?.to ?? undefined, scope }));
    writes.push(...plan.rekeys, logMove(ctx, row, plan, now, scope));
  }
  if (ctx.emailNotifications) {
    if (columns.assigneeUserId && columns.assigneeUserId !== ctx.actorUserId) {
      writes.unshift(queueAssignmentMail(ctx, row.id, columns.assigneeUserId,
        and(scope, sql`${task.assigneeUserId} is not ${columns.assigneeUserId}`)!));
    }
    const changed = or(
      fields.title && sql`${task.title} is not ${fields.title.to}`,
      fields.description && sql`${task.description} is not ${fields.description.to}`,
      plan ? sql`${task.statusId} is not ${plan.to.id}` : undefined,
    );
    if (changed) {
      writes.unshift(queueTaskEditMail(ctx, row.id, p.orgId,
        columns.assigneeUserId === undefined ? sql`${task.assigneeUserId}` : columns.assigneeUserId,
        columns.reporterUserId ?? sql`${task.reporterUserId}`,
        and(scope, changed)!, now));
    }
  }
  try {
    await commitTaskEdit(ctx, row, scope, { ...columns, updatedAt: now }, writes);
  } catch (error) {
    if (columns.typeId && isConstraintError(error, "FOREIGN KEY")) {
      await resolveTaskType(ctx.db, row.projectId, columns.typeId);
    }
    throw error;
  }

  return readDetail(ctx.db, row.id, p, row.number);
}

/**
 * Moves a task into `statusId`, directly after `afterTaskId` — or first in
 * that column when it is null. The key is computed server-side from the
 * neighbours, so the move writes exactly one row (§3). Same shape as
 * `reorderStatus`.
 */
export async function moveTask(
  ctx: DomainContext,
  input: TaskTarget & { statusId: string; afterTaskId: string | null },
): Promise<TaskDetail> {
  const { row, project: p, scope } = await loadEditableTask(ctx, input);
  if (input.afterTaskId === input.taskId) {
    throw new DomainError("A task cannot be placed after itself.");
  }

  const plan = await planMove(ctx, row, input.statusId, input.afterTaskId, scope);

  const now = new Date();
  const writes = [
    queueSlackTaskEvent(ctx, row.id, { statusId: plan.to.id, scope }),
    ...plan.rekeys,
  ];
  // A reorder inside one column is not a status change, and §3 gives
  // `task.moved` a `{from, to}` of statuses — logging one here would render as
  // "moved from Todo to Todo". The position write stands alone.
  if (plan.to.id !== plan.from.id) {
    writes.push(logMove(ctx, row, plan, now, scope));
    if (ctx.emailNotifications) {
      writes.unshift(queueTaskEditMail(ctx, row.id, p.orgId, sql`${task.assigneeUserId}`, sql`${task.reporterUserId}`,
        and(scope, sql`${task.statusId} is not ${plan.to.id}`)!, now));
    }
  }
  await commitTaskEdit(ctx, row, scope, { statusId: plan.to.id, position: plan.position, updatedAt: now }, writes);

  return readDetail(ctx.db, row.id, p, row.number);
}

export async function listTaskMoveProjects(ctx: DomainContext, projectId: string) {
  const { db, actorUserId } = ctx;
  const { project: source } = await requireProjectMember(db, projectId, actorUserId);
  return db.select({ id: project.id, name: project.name }).from(project).where(and(
    eq(project.orgId, source.orgId),
    ne(project.id, source.id),
    exists(db.select({ id: status.id }).from(status).where(eq(status.projectId, project.id))),
  )).orderBy(asc(project.name), asc(project.id));
}

export async function transferTask(
  ctx: DomainContext,
  input: { taskId: string; sourceProjectId: string; destinationProjectId: string; number?: number },
  prepareDescription?: (description: string, source: Project, target: Project) => Promise<string>,
) {
  const { db, actorUserId } = ctx;
  const sourceTask = { ...input, projectId: input.sourceProjectId };
  const { row, project: source, scope } = await loadEditableTask(ctx, sourceTask);
  if (source.id === input.destinationProjectId) throw new DomainError("Choose another project.");

  const { project: target } = await requireProjectMember(db, input.destinationProjectId, actorUserId);
  if (source.orgId !== target.orgId) throw new DomainError("Choose a project in this workspace.");

  const [fromStatus, fromType, statuses, types] = await Promise.all([
    requireStatusInProject(db, source.id, row.statusId),
    resolveTaskType(db, source.id, row.typeId ?? undefined),
    db.select().from(status).where(eq(status.projectId, target.id))
      .orderBy(asc(status.position), asc(status.id)),
    db.select().from(projectTaskType).where(eq(projectTaskType.projectId, target.id))
      .orderBy(asc(projectTaskType.id)),
  ]);
  const toStatus = statuses.find((item) => item.name.toLowerCase() === fromStatus.name.toLowerCase()) ?? statuses[0];
  if (!toStatus) throw new DomainError("Add a status to the destination project before moving this work item.");
  const toType = types.find((item) => item.name.toLowerCase() === fromType.name.toLowerCase())
    ?? types.find((item) => item.isDefault);
  if (!toType) throw new DomainError("The destination project has no default work item type.");

  const description = row.description && prepareDescription
    ? await prepareDescription(row.description, source, target)
    : row.description;
  const number = await allocateTaskNumber(db, target.id);
  const moved = exists(db.select({ id: task.id }).from(task).where(taskInProject(row.id, target.id, number)));
  const { position, rekeys } = await positionIn(db, target.id, toStatus.id, null, undefined, moved);
  const assigneeCanStay = row.assigneeUserId ? hasOrgMembership(db, target.orgId, row.assigneeUserId) : sql`0`;
  const fields: UpdatedFields = fromType.name !== toType.name ? { type: { from: fromType.name, to: toType.name } } : {};
  const data = JSON.stringify({ status: { from: fromStatus.name, to: toStatus.name }, fields });

  const writes = [
    db.update(task).set({
      projectId: target.id,
      number,
      description: taskDescription(description),
      statusId: toStatus.id,
      typeId: toType.id,
      assigneeUserId: sql`case when ${assigneeCanStay} then ${task.assigneeUserId} else null end`,
      position,
      updatedAt: new Date(),
    }).where(and(
      scope,
      sql`${task.description} is ${row.description}`,
      sql`${task.assigneeUserId} is ${row.assigneeUserId}`,
      eq(task.statusId, row.statusId),
      sql`${task.typeId} is ${row.typeId}`,
      exists(db.select({ id: status.id }).from(status).where(and(
        eq(status.id, toStatus.id), eq(status.projectId, target.id),
      ))),
      exists(db.select({ id: projectTaskType.id }).from(projectTaskType).where(and(
        eq(projectTaskType.id, toType.id), eq(projectTaskType.projectId, target.id),
      ))),
    )).returning({ id: task.id }),
    db.insert(taskProjectAlias).select(sql`
      select ${source.id}, ${row.number}, ${row.id} where ${moved}
    `),
    db.update(activity).set({ projectId: target.id }).where(and(eq(activity.taskId, row.id), moved)),
    writeActivitySelect(ctx, {
      projectId: target.id,
      taskId: row.id,
      type: "task.transferred",
      data,
    }, sql`where ${moved}`),
    ...rekeys,
  ] as const;
  const notifications: BatchItem<"sqlite">[] = [];
  if (fromStatus.name !== toStatus.name) {
    const targetScope = taskInProject(row.id, target.id, number);
    notifications.push(queueSlackTaskEvent(ctx, row.id, {
      statusId: toStatus.id,
      fromStatus: fromStatus.name,
      scope: targetScope,
    }));
    if (ctx.emailNotifications) {
      notifications.push(queueTaskEditMail(ctx, row.id, target.orgId, sql`${task.assigneeUserId}`, sql`${task.reporterUserId}`, targetScope, new Date()));
    }
  }
  const [updated] = await db.batch([...writes, ...notifications]);
  if (!updated.length) {
    await loadEditableTask(ctx, sourceTask);
    throw new DomainError("The work item or project changed. Refresh and try again.");
  }
  return { projectSlug: target.slug, key: taskKey(target.key, number) };
}

export async function archiveTask(
  ctx: DomainContext,
  input: TaskTarget,
): Promise<TaskDetail> {
  const { row, project: p, scope } = await loadEditableTask(ctx, input);
  if (row.archivedAt) {
    return readDetail(ctx.db, row.id, p, row.number);
  }

  // The check above can be raced by a concurrent archive. The WHERE repeats
  // it so the loser writes nothing — no second row, and so no second
  // `task.archived` — and returns as a sequential second archive does.
  const now = new Date();
  const [updated] = await ctx.db.batch([
    ctx.db
      .update(task)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(scope, isNull(task.archivedAt)))
      .returning({ id: task.id }),
    writeActivityIfChanged(ctx, {
      projectId: row.projectId,
      taskId: row.id,
      type: "task.archived",
      data: {},
    }),
  ]);
  if (!updated.length) await loadEditableTask(ctx, { taskId: row.id, projectId: row.projectId, number: row.number });

  return readDetail(ctx.db, row.id, p, row.number);
}

/**
 * §3's activity table has no `task.unarchived` row, so this adds one, with the
 * empty payload `task.archived` carries. The alternatives were worse: reusing
 * `task.archived` makes the log say the opposite of what happened, and writing
 * no row at all drops a mutation out of the history §2 says every mutation
 * records. `TaskActivityType` is exported, so step 11's renderer gets a type
 * error if it does not handle this one.
 *
 * Web-only by design: §5.7 gives MCP no unarchive tool.
 */
export async function unarchiveTask(
  ctx: DomainContext,
  input: TaskTarget,
): Promise<TaskDetail> {
  const { row, project: p, scope } = await loadEditableTask(ctx, input);
  if (!row.archivedAt) {
    return readDetail(ctx.db, row.id, p, row.number);
  }

  // `archiveTask`'s race, mirrored.
  const [updated] = await ctx.db.batch([
    ctx.db
      .update(task)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(scope, isNotNull(task.archivedAt)))
      .returning({ id: task.id }),
    writeActivityIfChanged(ctx, {
      projectId: row.projectId,
      taskId: row.id,
      type: "task.unarchived",
      data: {},
    }),
  ]);
  if (!updated.length) await loadEditableTask(ctx, { taskId: row.id, projectId: row.projectId, number: row.number });

  return readDetail(ctx.db, row.id, p, row.number);
}

export async function addComment(
  ctx: DomainContext,
  input: TaskTarget & { body: string; mentions?: unknown },
): Promise<Comment> {
  const { row, project: p } = await loadTask(ctx, input);

  const body = input.body.trim();
  if (!body) {
    throw new DomainError("A comment cannot be empty.");
  }
  assertMaxLength("A comment", body, MAX_LENGTH.comment);
  const mentions = await resolveCommentMentions(ctx.db, p.orgId, input.body, body, input.mentions);

  const now = new Date();
  const value = {
    id: crypto.randomUUID(),
    taskId: row.id,
    userId: ctx.actorUserId,
    body,
    // §3: deliberately duplicates the activity row's source, so rendering a
    // comment's web/MCP badge needs no join back to `activity`.
    source: ctx.source,
    createdAt: now,
    updatedAt: now,
    mentions: mentions.length ? mentions : null,
  };
  const writes = [
    ctx.db.insert(comment).select(sql`
      select ${value.id}, ${value.taskId}, ${value.userId}, ${value.body}, ${value.source},
        ${value.createdAt.getTime()}, ${value.updatedAt.getTime()},
        ${value.mentions ? JSON.stringify(value.mentions) : null}
      from ${task} where ${currentTaskScope(row)}
        and ${hasOrgMembership(ctx.db, p.orgId, ctx.actorUserId)}
    `).returning({ id: comment.id }),
    writeActivityIfChanged(ctx, {
      projectId: row.projectId,
      taskId: row.id,
      type: "comment.added",
      data: { commentId: value.id, excerpt: excerpt(body) },
    }),
  ] as const;
  const notifications = ctx.emailNotifications && mentions.length
    ? [queueCommentMentionMail(ctx, p.orgId, value.id, [...new Set(mentions.map(({ userId }) => userId))])]
    : [];
  const [inserted] = await ctx.db.batch([...writes, ...notifications]);

  if (!inserted.length) throw new AccessError("not_a_member", "No such task.");
  return value;
}

// Counted and cut in code points: a UTF-16 slice can split an emoji's
// surrogate pair and store a lone half.
function excerpt(body: string): string {
  const flat = Array.from(body.replace(/\s+/g, " ").trim());
  return flat.length > EXCERPT_LENGTH
    ? `${flat.slice(0, EXCERPT_LENGTH - 1).join("").trimEnd()}…`
    : flat.join("");
}
