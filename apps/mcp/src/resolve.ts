/**
 * PLAN §5.7: agents address everything by what a human would type. These are
 * the read-only lookups that turn those identifiers into ids. Reads may live
 * here; every mutation still goes through a `@tasks/core/domain` function,
 * which re-proves reach with `requireProjectMember` on its own.
 */
import { AccessError, teamAccess } from "@tasks/core/access";
import { parseTaskKey } from "@tasks/core/domain";
import { DomainError } from "@tasks/core/errors";
import {
  team,
  project,
  projectSlugAlias,
  projectTaskType,
  status,
  task,
  user,
  type Project,
  type ProjectTaskType,
  type Status,
} from "@tasks/core/schema";
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQLWrapper } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

/** `implicit`: reached only through an org owner/admin role, not a team membership. */
export type ReachableProject = Project & { teamSlug: string; implicit: boolean };

const NO_PROJECT = () => new AccessError("not_a_member", "No such project.");
const NO_TASK = () => new AccessError("not_a_member", "No such task.");

/** Project IDs the caller can open, as a subquery (D1 caps bound parameters at 100). */
export function reachableProjectIds(db: DrizzleD1Database, userId: string) {
  return db.select({ id: project.id }).from(project).where(isNotNull(teamAccess(project.teamId, userId).role));
}

/** Every project the caller can reach: their teams, or every team for org owners/admins. */
export async function reachableProjects(
  db: DrizzleD1Database,
  userId: string,
): Promise<ReachableProject[]> {
  const access = teamAccess(project.teamId, userId);
  const rows = await db
    .select({
      project,
      teamSlug: team.slug,
      implicit: access.implicit,
    })
    .from(project)
    .innerJoin(team, eq(team.id, project.teamId))
    .where(isNotNull(access.role))
    .orderBy(asc(team.slug), asc(project.name), asc(project.id));

  return rows.map((r) => ({ ...r.project, teamSlug: r.teamSlug, implicit: r.implicit }));
}

/** `team` is a team slug the caller can open; any other is "No such team." */
export async function resolveTeam(
  db: DrizzleD1Database,
  userId: string,
  slug: string,
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .select({ id: team.id, slug: team.slug })
    .from(team)
    .where(and(eq(team.slug, slug.trim().toLowerCase()), isNotNull(teamAccess(team.id, userId).role)));
  if (!row) throw new AccessError("not_a_member", "No such team.");
  return row;
}

/**
 * Splits the optional `team/` qualifier. Project keys and slugs are unique only
 * within a team (§3), so one user in two teams can reach two `WEB` projects;
 * `acme/WEB` picks one.
 */
function splitTeam(input: string): { teamSlug?: string; rest: string } {
  const trimmed = input.trim();
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { rest: trimmed };
  return {
    teamSlug: trimmed.slice(0, slash).toLowerCase(),
    rest: trimmed.slice(slash + 1),
  };
}

/**
 * Without a team prefix, the caller's own teams win: an org owner/admin reaches
 * every team, so a bare key falls back to those only when no own team matches.
 */
function preferOwnTeams<T extends { implicit: boolean }>(matches: T[], teamSlug?: string): T[] {
  if (teamSlug) return matches;
  const own = matches.filter((m) => !m.implicit);
  return own.length > 0 ? own : matches;
}

function pickOne<T extends { teamSlug: string }>(
  matches: T[],
  what: string,
  notFound: () => Error,
): T {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw notFound();
  const teams = [...new Set(matches.map((m) => m.teamSlug))].sort().join(", ");
  throw new DomainError(
    `"${what}" matches more than one project (teams: ${teams}). Prefix it with the team slug, e.g. "${matches[0].teamSlug}/${what}".`,
  );
}

/**
 * `project` is a key (`ENG`) or a slug (`web`), case-insensitive, optionally
 * `team/`-qualified. A former slug from a rename still resolves when nothing
 * live matches.
 */
export async function resolveProject(
  db: DrizzleD1Database,
  userId: string,
  input: string,
): Promise<ReachableProject> {
  const { teamSlug, rest } = splitTeam(input);
  const wanted = rest.toLowerCase();
  const matches = preferOwnTeams((await reachableProjects(db, userId)).filter(
    (p) =>
      (!teamSlug || p.teamSlug === teamSlug) &&
      (p.key.toLowerCase() === wanted || p.slug === wanted),
  ), teamSlug);
  // A key in one project and the same word as another's slug: the key wins,
  // since it is the more specific identifier.
  const byKey = matches.filter((p) => p.key.toLowerCase() === wanted);
  if (matches.length > 0) return pickOne(byKey.length > 0 ? byKey : matches, rest, NO_PROJECT);

  const aliasAccess = teamAccess(project.teamId, userId);
  const aliased = await db
    .select({ project, teamSlug: team.slug, implicit: aliasAccess.implicit })
    .from(projectSlugAlias)
    .innerJoin(project, and(eq(project.id, projectSlugAlias.projectId), eq(project.teamId, projectSlugAlias.teamId)))
    .innerJoin(team, eq(team.id, project.teamId))
    .where(and(
      eq(projectSlugAlias.slug, wanted),
      teamSlug ? eq(team.slug, teamSlug) : undefined,
      isNotNull(aliasAccess.role),
    ))
    .orderBy(asc(team.slug), asc(project.id));
  return pickOne(
    preferOwnTeams(aliased.map((r) => ({ ...r.project, teamSlug: r.teamSlug, implicit: r.implicit })), teamSlug),
    rest,
    NO_PROJECT,
  );
}

/**
 * `task` is a task key (`ENG-42`), optionally `team/`-qualified. Unparseable,
 * unknown and unreachable are the identical "No such task." — the contract
 * core's `loadTask` and `getTaskByKey` keep.
 */
export async function resolveTask(
  db: DrizzleD1Database,
  userId: string,
  input: string,
): Promise<{ taskId: string; project: ReachableProject; number: number }> {
  const { teamSlug, rest } = splitTeam(input);
  const parsed = parseTaskKey(rest);
  if (!parsed) throw NO_TASK();

  const projects = (await reachableProjects(db, userId)).filter(
    (p) =>
      (!teamSlug || p.teamSlug === teamSlug) &&
      p.key.toUpperCase() === parsed.projectKey.toUpperCase(),
  );
  if (projects.length === 0) throw NO_TASK();

  const rows = await db
    .select({ id: task.id, projectId: task.projectId })
    .from(task)
    .where(
      and(
        inArray(
          task.projectId,
          projects.map((p) => p.id),
        ),
        eq(task.number, parsed.number),
      ),
    );
  const matches = rows.map((r) => {
    const p = projects.find((p) => p.id === r.projectId)!;
    return { taskId: r.id, project: p, teamSlug: p.teamSlug, implicit: p.implicit };
  });
  const hit = pickOne(preferOwnTeams(matches, teamSlug), rest, NO_TASK);
  return { taskId: hit.taskId, project: hit.project, number: parsed.number };
}

/** Statuses in board order — §3's `position, id`. */
export async function projectStatuses(
  db: DrizzleD1Database,
  projectIds: string[] | SQLWrapper,
): Promise<Status[]> {
  if (Array.isArray(projectIds) && projectIds.length === 0) return [];
  return db
    .select()
    .from(status)
    .where(inArray(status.projectId, projectIds))
    .orderBy(asc(status.position), asc(status.id));
}

/** Task types in default-first order for discovery and name lookup. */
export async function projectTaskTypes(
  db: DrizzleD1Database,
  projectIds: string[] | SQLWrapper,
): Promise<ProjectTaskType[]> {
  if (Array.isArray(projectIds) && projectIds.length === 0) return [];
  return db
    .select()
    .from(projectTaskType)
    .where(inArray(projectTaskType.projectId, projectIds))
    .orderBy(desc(projectTaskType.isDefault), asc(projectTaskType.name), asc(projectTaskType.id));
}

export async function resolveTaskType(
  db: DrizzleD1Database,
  p: Project,
  name: string,
): Promise<ProjectTaskType> {
  const types = await projectTaskTypes(db, [p.id]);
  const wanted = name.trim();
  const exact = types.find((type) => type.name === wanted);
  if (exact) return exact;
  const matches = types.filter((type) => type.name.toLowerCase() === wanted.toLowerCase());
  if (matches.length > 1) {
    throw new DomainError(`Use the exact task type name: ${matches.map((type) => type.name).join(", ")}.`);
  }
  const [hit] = matches;
  if (!hit) {
    throw new DomainError(
      `No task type named "${wanted}" in ${p.key}. Task types: ${types.map((type) => type.name).join(", ")}.`,
    );
  }
  return hit;
}

/**
 * `status` is a status name. Case-insensitive, preferring an exact match;
 * an unknown name lists the real ones so an agent can correct itself.
 *
 * TODO(core): `getStatusByName(ctx, {projectId, name})`.
 */
export async function resolveStatus(
  db: DrizzleD1Database,
  p: Project,
  name: string,
): Promise<Status> {
  const statuses = await projectStatuses(db, [p.id]);
  const wanted = name.trim();
  const hit =
    statuses.find((s) => s.name === wanted) ??
    statuses.find((s) => s.name.toLowerCase() === wanted.toLowerCase());
  if (!hit) {
    throw new DomainError(
      `No status named "${wanted}" in ${p.key}. Statuses: ${statuses.map((s) => s.name).join(", ")}.`,
    );
  }
  return hit;
}

/**
 * `assignee` or `reporter` is an email. An address with no account gets core's own
 * not-a-member message, so the tool cannot be used to probe which addresses
 * have signed up; membership itself is checked by the domain function.
 *
 * TODO(core): `getUserByEmail(db, email)`. Emails are compared lowercased —
 * Better Auth stores what Google returns (§3, "Email matching").
 */
export async function resolveAssignee(
  db: DrizzleD1Database,
  email: string,
): Promise<string> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email.trim().toLowerCase()));
  if (!row) {
    throw new DomainError(
      "That user must be a member of this team.",
    );
  }
  return row.id;
}

/**
 * Core's `UserRef` is `{id, displayName}`; agents address people by email, so
 * the tools return it alongside.
 *
 * TODO(core): carry `email` on `TaskSummary.assignee` / `TaskComment.author`.
 */
export async function emailsFor(
  db: DrizzleD1Database,
  userIds: (string | undefined | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  const emails = new Map<string, string>();
  // D1 caps bound parameters at 100.
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.id, ids.slice(i, i + 90)));
    for (const r of rows) emails.set(r.id, r.email);
  }
  return emails;
}
