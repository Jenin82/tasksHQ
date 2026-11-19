import { and, eq, exists, inArray, isNotNull, or, sql, type SQLWrapper } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import { DomainError } from "./errors";
import { type OrgMember, type OrgRole, orgMember } from "./schema/org";
import { type TeamMember, team, teamMember } from "./schema/team";
import { type Project, type ProjectRole, project, projectMember } from "./schema/project";
import { task } from "./schema/task";

export type TeamRole = TeamMember["role"];

/**
 * `not_a_member` means "you cannot see that this exists" — §4.6 renders
 * `notFound()` for it so team slugs are not enumerable. `forbidden` means the
 * caller is a member but lacks the capability, and maps to 403.
 */
export class AccessError extends DomainError {
  constructor(
    readonly reason: "not_a_member" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

export class TaskEditForbidden extends AccessError {
  constructor() {
    super("forbidden", "Only the creator, reporter, current assignee, or an admin can edit this task.");
  }
}

export const CAPABILITIES = [
  "team:manage_members",
  "team:change_role",
  "team:rename",
  "project:create",
  "project:delete",
  "project:manage_statuses",
  "project:manage_members",
  "project:manage_task_editing",
  "team:delete",
  "task:delete_archived",
  "team:view_time_reports",
  "project:rename",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * PLAN §3's role matrix, transcribed once and only here.
 *
 * The matrix's two parenthesised qualifiers — admin "(not owners)" and
 * "(cannot grant or target owner)" — depend on the *target* member, not on the
 * capability, so they cannot live in this table. They are enforced in
 * `domain/team.ts` where the target is known.
 */
const TEAM_ROLE_CAPABILITIES: Record<TeamRole, readonly Capability[]> = {
  owner: CAPABILITIES,
  admin: CAPABILITIES.filter((c) => c !== "team:delete" && c !== "project:delete"),
  member: [],
};

export function can(role: TeamRole, capability: Capability): boolean {
  return TEAM_ROLE_CAPABILITIES[role].includes(capability);
}

export function canProject(role: TeamRole, projectRole: ProjectRole | null, capability: Capability): boolean {
  return can(role, capability) || (
    projectRole === "admin" &&
    (capability === "project:manage_members" || capability === "project:manage_statuses" || capability === "project:manage_task_editing")
  );
}

export function requireCapability(role: TeamRole, capability: Capability) {
  if (!can(role, capability)) {
    throw new AccessError(
      "forbidden",
      `A ${role} cannot perform "${capability}".`,
    );
  }
}

export const ORG_CAPABILITIES = [
  "org:manage_members",
  "org:change_role",
  "org:create_team",
  "org:rename",
] as const;

export type OrgCapability = (typeof ORG_CAPABILITIES)[number];

/**
 * The org matrix, next to the team one. As there, admin "(cannot grant or
 * target owner)" depends on the target, so `domain/org.ts` enforces it.
 */
const ORG_ROLE_CAPABILITIES: Record<OrgRole, readonly OrgCapability[]> = {
  owner: ORG_CAPABILITIES,
  admin: ORG_CAPABILITIES,
  member: [],
};

export function canOrg(role: OrgRole, capability: OrgCapability): boolean {
  return ORG_ROLE_CAPABILITIES[role].includes(capability);
}

export function requireOrgCapability(role: OrgRole, capability: OrgCapability) {
  if (!canOrg(role, capability)) {
    throw new AccessError("forbidden", `An org ${role} cannot perform "${capability}".`);
  }
}

export async function requireOrgMember(db: DrizzleD1Database, userId: string): Promise<OrgMember> {
  const [row] = await db.select().from(orgMember).where(eq(orgMember.userId, userId));
  if (!row) throw new AccessError("not_a_member", "No such organization.");
  return row;
}

/** The caller's effective role in a team, as `requireTeamMember` returns it. */
export type TeamAccess = { teamId: string; userId: string; role: TeamRole; implicit: boolean };

const accessTeamMember = alias(teamMember, "access_team_member");
const accessOrgMember = alias(orgMember, "access_org_member");
// A raw `sql` template renders an alias as its bare name, so spell out the FROM.
const accessTeamMemberFrom = sql`${teamMember} ${sql.identifier("access_team_member")}`;
const accessOrgMemberFrom = sql`${orgMember} ${sql.identifier("access_org_member")}`;

/**
 * The one SQL source of team access. `role` is the higher of the user's real
 * team role and their org-derived one (org owner -> owner, org admin -> admin,
 * org member -> none), or NULL for no access. `implicit` is true when the user
 * has no real `team_member` row. Scalar subqueries over aliased tables, so it
 * nests in any statement (including batch guards) and never takes an ID list.
 */
export function teamAccess(teamId: SQLWrapper | string, userId: SQLWrapper | string) {
  const realRow = and(eq(accessTeamMember.teamId, teamId), eq(accessTeamMember.userId, userId));
  const role = sql<TeamRole | null>`(case max(
    coalesce((select case ${accessTeamMember.role} when 'owner' then 3 when 'admin' then 2 when 'member' then 1 end
      from ${accessTeamMemberFrom} where ${realRow}), 0),
    coalesce((select case ${accessOrgMember.role} when 'owner' then 3 when 'admin' then 2 end
      from ${accessOrgMemberFrom} where ${eq(accessOrgMember.userId, userId)}), 0)
  ) when 3 then 'owner' when 2 then 'admin' when 1 then 'member' end)`;
  const implicit = sql<boolean>`(not exists (select 1 from ${accessTeamMemberFrom} where ${realRow}))`.mapWith(Boolean);
  return { role, implicit };
}

export async function requireTeamMember(
  db: DrizzleD1Database,
  teamId: string,
  userId: string,
): Promise<TeamAccess> {
  const access = teamAccess(team.id, userId);
  const [row] = await db.select({ role: access.role, implicit: access.implicit })
    .from(team)
    .where(and(eq(team.id, teamId), isNotNull(access.role)));

  if (!row?.role) {
    throw new AccessError("not_a_member", "No such team.");
  }
  return { teamId, userId, role: row.role, implicit: row.implicit };
}

/** Team members, and org owners/admins, can open every project in a team. */
export async function requireProjectMember(
  db: DrizzleD1Database,
  projectId: string,
  userId: string,
): Promise<{ project: Project; member: TeamAccess; projectRole: ProjectRole | null }> {
  const access = teamAccess(project.teamId, userId);
  const [row] = await db.select({ project, role: access.role, implicit: access.implicit, projectRole: projectMember.role })
    .from(project)
    .leftJoin(projectMember, and(
      eq(projectMember.teamId, project.teamId),
      eq(projectMember.projectId, project.id),
      eq(projectMember.userId, userId),
    ))
    .where(and(eq(project.id, projectId), isNotNull(access.role)));
  if (!row?.role) throw new AccessError("not_a_member", "No such project.");
  return {
    project: row.project,
    member: { teamId: row.project.teamId, userId, role: row.role, implicit: row.implicit },
    projectRole: row.projectRole,
  };
}

/** Recheck REAL team membership inside a mutation batch (assignability, time). */
export function hasTeamMembership(db: DrizzleD1Database, teamId: string, userId: string) {
  return exists(db.select({ userId: teamMember.userId }).from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId))));
}

export function canEditAnyTask({ project, member, projectRole }: {
  project: Pick<Project, "restrictTaskEdits">;
  member: Pick<TeamAccess, "role">;
  projectRole: ProjectRole | null;
}) {
  return !project.restrictTaskEdits || canProject(member.role, projectRole, "project:manage_task_editing");
}

export function canEditTask(
  canEditAny: boolean,
  actorUserId: string,
  creatorId: string,
  assigneeId?: string | null,
  reporterId?: string | null,
) {
  return canEditAny || actorUserId === creatorId || actorUserId === assigneeId || actorUserId === reporterId;
}

const taskEditingTeamRoles = teamMember.role.enumValues.filter((role) => can(role, "project:manage_task_editing"));
const taskEditingProjectRoles = projectMember.role.enumValues.filter((role) => canProject("member", role, "project:manage_task_editing"));

/** Use the live project policy, membership, and assignment inside a task write. */
export function hasTaskEditPermission(db: DrizzleD1Database, projectId: string, actorUserId: string) {
  const access = teamAccess(project.teamId, actorUserId);
  return exists(db.select({ id: project.id }).from(project)
    .leftJoin(projectMember, and(
      eq(projectMember.teamId, project.teamId),
      eq(projectMember.projectId, project.id),
      eq(projectMember.userId, actorUserId),
    ))
    .where(and(eq(project.id, projectId), isNotNull(access.role), or(
      eq(project.restrictTaskEdits, false),
      inArray(access.role, taskEditingTeamRoles),
      inArray(projectMember.role, taskEditingProjectRoles),
      eq(task.createdByUserId, actorUserId),
      eq(task.assigneeUserId, actorUserId),
      eq(task.reporterUserId, actorUserId),
    ))));
}
