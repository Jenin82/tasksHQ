import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { AccessError, can, requireTeamMember } from "../access";
import type { DomainContext } from "../activity";
import { DomainError } from "../errors";
import { user } from "../schema/auth";
import { teamReportingLine } from "../schema/team";
import { project } from "../schema/project";
import { task } from "../schema/task";
import { STALE_MS, type TimeEntry, timeEntry } from "../schema/time";
import { taskKey } from "./task";
import { MAX_ENTRY_MS } from "./time";

const MAX_SPAN_MS = 93 * 24 * 60 * 60 * 1000;

/** The requested person is outside the viewer's report scope. */
export class OutOfReportScope extends DomainError {
  constructor() {
    super("No such person in your report scope.");
  }
}

export type TimeReportEntry = Pick<TimeEntry, "id" | "userId" | "taskId" | "startedAt" | "note" | "kind" | "source" | "autoStopped"> & {
  userName: string;
  userEmail: string;
  userTimezone: string | null;
  key: string;
  title: string;
  projectName: string;
  projectSlug: string;
  /** The stored end, or for a running entry `now` capped at `start + STALE_MS`. */
  endedAt: Date;
  running: boolean;
  edited: boolean;
};

export function assertReportRange({ from, to }: { from: Date; to: Date }) {
  if (!(to.getTime() > from.getTime())) throw new DomainError("The report must end after it starts.");
  if (to.getTime() - from.getTime() > MAX_SPAN_MS) throw new DomainError("A report can cover at most 93 days.");
}

/**
 * Entries in one team that overlap `[from, to)`, unclamped. Owners and
 * admins see everyone, including former members; others see themselves and
 * their direct reports.
 */
export async function listTimeReportEntries(
  ctx: DomainContext,
  input: { teamId: string; from: Date; to: Date } & ({ userId: string } | { userEmail: string } | {}),
): Promise<TimeReportEntry[]> {
  const { db, actorUserId } = ctx;
  const member = await requireTeamMember(db, input.teamId, actorUserId);
  // Time reports stay with real members until reporting moves to the org.
  if (member.implicit) throw new AccessError("not_a_member", "No such team.");
  assertReportRange(input);
  const from = input.from.getTime();
  const to = input.to.getTime();

  const seesAll = can(member.role, "team:view_time_reports");
  // A subquery, not an ID list, so a large team stays under D1's parameter limit.
  const scope = seesAll ? undefined : or(
    eq(timeEntry.userId, actorUserId),
    inArray(timeEntry.userId, db.select({ userId: teamReportingLine.userId }).from(teamReportingLine)
      .where(and(eq(teamReportingLine.teamId, input.teamId), eq(teamReportingLine.leadUserId, actorUserId)))),
  );

  let person;
  if ("userId" in input) {
    if (!seesAll && input.userId !== actorUserId) {
      const [line] = await db.select({ userId: teamReportingLine.userId }).from(teamReportingLine)
        .where(and(
          eq(teamReportingLine.teamId, input.teamId),
          eq(teamReportingLine.userId, input.userId),
          eq(teamReportingLine.leadUserId, actorUserId),
        ));
      if (!line) throw new OutOfReportScope();
    }
    person = eq(timeEntry.userId, input.userId);
  } else if ("userEmail" in input) {
    person = sql`lower(${user.email}) = lower(${input.userEmail})`;
  }

  const now = Date.now();
  const rows = await db.select({
    id: timeEntry.id,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userTimezone: user.timezone,
    taskId: task.id,
    number: task.number,
    title: task.title,
    projectName: project.name,
    projectSlug: project.slug,
    projectKey: project.key,
    startedAt: timeEntry.startedAt,
    endedAt: timeEntry.endedAt,
    note: timeEntry.note,
    kind: timeEntry.kind,
    source: timeEntry.source,
    autoStopped: timeEntry.autoStopped,
    editedAt: timeEntry.editedAt,
  }).from(timeEntry)
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .innerJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(project, eq(project.id, task.projectId))
    .where(and(
      eq(timeEntry.teamId, input.teamId),
      scope,
      person,
      // No entry is longer than MAX_ENTRY_MS, so this bounds the index scan.
      gte(timeEntry.startedAt, new Date(from - MAX_ENTRY_MS)),
      lt(timeEntry.startedAt, input.to),
      // The effective end is after `from`.
      or(
        gt(timeEntry.endedAt, input.from),
        now > from ? and(isNull(timeEntry.endedAt), gt(timeEntry.startedAt, new Date(from - STALE_MS))) : undefined,
      ),
    ))
    .orderBy(asc(user.name), asc(timeEntry.startedAt), asc(timeEntry.id));

  return rows.map(({ number, projectKey, endedAt, editedAt, ...row }) => ({
    ...row,
    key: taskKey(projectKey, number),
    // Same as `stopTimeEntryValues`: never before the start, never past STALE_MS.
    endedAt: endedAt ?? new Date(Math.min(Math.max(now, row.startedAt.getTime()), row.startedAt.getTime() + STALE_MS)),
    running: endedAt === null,
    edited: editedAt !== null,
  }));
}
