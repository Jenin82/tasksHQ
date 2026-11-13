import { and, eq, exists, inArray, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { DomainError } from "./errors";
import { type OrgMember, orgMember } from "./schema/org";
import { type Project, type ProjectRole, project, projectMember } from "./schema/project";
import { task } from "./schema/task";

export type OrgRole = OrgMember["role"];

/**
 * `not_a_member` means "you cannot see that this exists" — §4.6 renders
 * `notFound()` for it so org slugs are not enumerable. `forbidden` means the
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
  "org:manage_members",
  "org:change_role",
  "org:rename",
  "project:create",
  "project:delete",
  "project:manage_statuses",
  "project:manage_members",
  "project:manage_task_editing",
  "org:delete",
  "task:delete_archived",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * PLAN §3's role matrix, transcribed once and only here.
 *
 * The matrix's two parenthesised qualifiers — admin "(not owners)" and
 * "(cannot grant or target owner)" — depend on the *target* member, not on the
 * capability, so they cannot live in this table. They are enforced in
 * `domain/org.ts` where the target is known.
 */
const ORG_ROLE_CAPABILITIES: Record<OrgRole, readonly Capability[]> = {
  owner: CAPABILITIES,
  admin: CAPABILITIES.filter((c) => c !== "org:delete" && c !== "project:delete"),
  member: [],
};

export function can(role: OrgRole, capability: Capability): boolean {
  return ORG_ROLE_CAPABILITIES[role].includes(capability);
}

export function canProject(role: OrgRole, projectRole: ProjectRole | null, capability: Capability): boolean {
  return can(role, capability) || (
    projectRole === "admin" &&
    (capability === "project:manage_members" || capability === "project:manage_statuses" || capability === "project:manage_task_editing")
  );
}

export function requireCapability(role: OrgRole, capability: Capability) {
  if (!can(role, capability)) {
    throw new AccessError(
      "forbidden",
      `A ${role} cannot perform "${capability}".`,
    );
  }
}

export async function requireOrgMember(
  db: DrizzleD1Database,
  orgId: string,
  userId: string,
): Promise<OrgMember> {
  const [member] = await db
    .select()
    .from(orgMember)
    .where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, userId)));

  if (!member) {
    throw new AccessError("not_a_member", "No such organization.");
  }
  return member;
}

/** All organization members can open every project in that organization. */
export async function requireProjectMember(
  db: DrizzleD1Database,
  projectId: string,
  userId: string,
): Promise<{ project: Project; member: OrgMember; projectRole: ProjectRole | null }> {
  const [access] = await db.select({ project, member: orgMember, projectRole: projectMember.role })
    .from(project)
    .innerJoin(orgMember, and(eq(orgMember.orgId, project.orgId), eq(orgMember.userId, userId)))
    .leftJoin(projectMember, and(
      eq(projectMember.orgId, project.orgId),
      eq(projectMember.projectId, project.id),
      eq(projectMember.userId, userId),
    ))
    .where(eq(project.id, projectId));
  if (!access) throw new AccessError("not_a_member", "No such project.");
  return access;
}

/** Recheck organization membership inside a mutation batch. */
export function hasOrgMembership(db: DrizzleD1Database, orgId: string, userId: string) {
  return exists(db.select({ userId: orgMember.userId }).from(orgMember)
    .where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, userId))));
}

export function canEditAnyTask({ project, member, projectRole }: {
  project: Pick<Project, "restrictTaskEdits">;
  member: Pick<OrgMember, "role">;
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

const taskEditingOrgRoles = orgMember.role.enumValues.filter((role) => can(role, "project:manage_task_editing"));
const taskEditingProjectRoles = projectMember.role.enumValues.filter((role) => canProject("member", role, "project:manage_task_editing"));

/** Use the live project policy, membership, and assignment inside a task write. */
export function hasTaskEditPermission(db: DrizzleD1Database, projectId: string, actorUserId: string) {
  return exists(db.select({ id: project.id }).from(project)
    .innerJoin(orgMember, and(eq(orgMember.orgId, project.orgId), eq(orgMember.userId, actorUserId)))
    .leftJoin(projectMember, and(
      eq(projectMember.orgId, project.orgId),
      eq(projectMember.projectId, project.id),
      eq(projectMember.userId, actorUserId),
    ))
    .where(and(eq(project.id, projectId), or(
      eq(project.restrictTaskEdits, false),
      inArray(orgMember.role, taskEditingOrgRoles),
      inArray(projectMember.role, taskEditingProjectRoles),
      eq(task.createdByUserId, actorUserId),
      eq(task.assigneeUserId, actorUserId),
      eq(task.reporterUserId, actorUserId),
    ))));
}
