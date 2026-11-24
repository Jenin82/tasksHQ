import { and, asc, eq, exists, gt, gte, inArray, isNull, lt, or, sql, type SQLWrapper } from "drizzle-orm";
import { can, canOrg, requireOrgMember, requireTeamMember } from "../access";
import type { DomainContext } from "../activity";
import { DomainError } from "../errors";
import { user } from "../schema/auth";
import { orgMember, reportingLine } from "../schema/org";
import { project } from "../schema/project";
import { team, teamMember } from "../schema/team";
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
  projectId: string;
  projectName: string;
  projectSlug: string;
  teamId: string;
  teamSlug: string;
  teamName: string;
  /** The stored end, or for a running entry `now` capped at `start + STALE_MS`. */
  endedAt: Date;
  running: boolean;
  edited: boolean;
};

export function assertReportRange({ from, to }: { from: Date; to: Date }) {
  if (!(to.getTime() > from.getTime())) throw new DomainError("The report must end after it starts.");
  if (to.getTime() - from.getTime() > MAX_SPAN_MS) throw new DomainError("A report can cover at most 93 days.");
}

const reportRoles = teamMember.role.enumValues.filter((role) => can(role, "team:view_time_reports"));

/** The viewer's REAL membership of the entry's team, optionally with a report-viewing role. */
function viewerInEntryTeam(db: DomainContext["db"], viewerId: string, roles?: typeof reportRoles) {
  return exists(db.select({ userId: teamMember.userId }).from(teamMember).where(and(
    eq(teamMember.teamId, timeEntry.teamId),
    eq(teamMember.userId, viewerId),
    roles && inArray(teamMember.role, roles),
  )));
}

/**
 * Whether `person` is (or was, through a time entry) in a team where `viewerId`
 * is a real member: the only teams where a lead sees a report's time.
 */
export function sharesReportTeam(db: DomainContext["db"], viewerId: string, person: SQLWrapper | string) {
  const viewerTeams = db.select({ teamId: teamMember.teamId }).from(teamMember).where(eq(teamMember.userId, viewerId));
  return or(
    exists(db.select({ userId: teamMember.userId }).from(teamMember)
      .where(and(eq(teamMember.userId, person), inArray(teamMember.teamId, viewerTeams)))),
    exists(db.select({ id: timeEntry.id }).from(timeEntry)
      .where(and(eq(timeEntry.userId, person), inArray(timeEntry.teamId, viewerTeams)))),
  )!;
}

/**
 * Whether `person` is the viewer, a member (or, through a time entry, a former
 * member) of a team where the viewer is a real admin, or a direct report who
 * shares a team with the viewer. Org owners and admins see everyone instead.
 */
export function personInReportScope(db: DomainContext["db"], viewerId: string, person: SQLWrapper | string) {
  const managed = db.select({ teamId: teamMember.teamId }).from(teamMember)
    .where(and(eq(teamMember.userId, viewerId), inArray(teamMember.role, reportRoles)));
  return or(
    eq(sql`${person}`, viewerId),
    and(
      exists(db.select({ userId: reportingLine.userId }).from(reportingLine)
        .where(and(eq(reportingLine.userId, person), eq(reportingLine.leadUserId, viewerId)))),
      sharesReportTeam(db, viewerId, person),
    ),
    exists(db.select({ userId: teamMember.userId }).from(teamMember)
      .where(and(eq(teamMember.userId, person), inArray(teamMember.teamId, managed)))),
    exists(db.select({ id: timeEntry.id }).from(timeEntry)
      .where(and(eq(timeEntry.userId, person), inArray(timeEntry.teamId, managed)))),
  )!;
}

export type TimeReportPerson = { id: string; name: string; email: string };

/**
 * The people the viewer may pick in a time report: for org owners and admins
 * every org member and anyone with a time entry, otherwise the viewer and
 * everyone `personInReportScope` admits. Ordered by name.
 */
export async function listTimeReportPeople(ctx: DomainContext): Promise<TimeReportPerson[]> {
  const { db, actorUserId } = ctx;
  const viewer = await requireOrgMember(db, actorUserId);
  const rows = await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(
    canOrg(viewer.role, "org:manage_members")
      ? or(
        exists(db.select({ userId: orgMember.userId }).from(orgMember).where(eq(orgMember.userId, user.id))),
        exists(db.select({ id: timeEntry.id }).from(timeEntry).where(eq(timeEntry.userId, user.id))),
      )
      : personInReportScope(db, actorUserId, user.id),
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Entries across the org (or one team) that overlap `[from, to)`, unclamped.
 * Org owners and admins see everyone, including former members. Others see
 * every entry in teams where they are a real admin (former members
 * included), and their own and their direct reports' entries in teams they
 * are a real member of.
 */
export async function listTimeReportEntries(
  ctx: DomainContext,
  input: { teamId?: string; from: Date; to: Date } & ({ userId: string } | { userEmail: string } | {}),
): Promise<TimeReportEntry[]> {
  const { db, actorUserId } = ctx;
  const viewer = await requireOrgMember(db, actorUserId);
  if (input.teamId) await requireTeamMember(db, input.teamId, actorUserId);
  assertReportRange(input);
  const from = input.from.getTime();

  const seesAll = canOrg(viewer.role, "org:manage_members");
  // Subqueries, not ID lists, so a large org stays under D1's parameter limit.
  const reports = db.select({ userId: reportingLine.userId }).from(reportingLine)
    .where(eq(reportingLine.leadUserId, actorUserId));
  const scope = seesAll ? undefined : or(
    viewerInEntryTeam(db, actorUserId, reportRoles),
    and(
      viewerInEntryTeam(db, actorUserId),
      or(eq(timeEntry.userId, actorUserId), inArray(timeEntry.userId, reports)),
    ),
  );

  let person;
  if ("userId" in input) {
    if (!seesAll) {
      const [inScope] = await db.select({ id: user.id }).from(user)
        .where(and(eq(user.id, input.userId), personInReportScope(db, actorUserId, user.id)));
      if (!inScope) throw new OutOfReportScope();
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
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
    projectKey: project.key,
    teamId: team.id,
    teamSlug: team.slug,
    teamName: team.name,
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
    .innerJoin(team, eq(team.id, timeEntry.teamId))
    .where(and(
      input.teamId ? eq(timeEntry.teamId, input.teamId) : undefined,
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
