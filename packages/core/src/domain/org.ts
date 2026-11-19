import { and, eq, exists, inArray, isNotNull, isNull, ne, not, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { AccessError, requireOrgCapability, requireOrgMember } from "../access";
import { type DomainContext, writeActivitySelect } from "../activity";
import { DomainError, MAX_LENGTH, assertMaxLength, isConstraintError } from "../errors";
import { user } from "../schema/auth";
import { type OrgMember, type OrgRole, org, orgInvite, orgMember } from "../schema/org";
import { project } from "../schema/project";
import { task } from "../schema/task";
import { teamInvite, teamMember } from "../schema/team";
import { timeEntry } from "../schema/time";
import { queueOrgInviteMail } from "./mail";
import { stopTimeEntryValues } from "./time";

// Like domain/team.ts, org changes write no activity rows: `activity.projectId`
// is NOT NULL. removeOrgMember logs its task-level side effect.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_REMOVES_OWNER = "An admin cannot remove an owner.";
const ADMIN_REMOVES_TEAM_OWNER = "An admin cannot remove a team owner.";
const ADMIN_CHANGES_OWNER = "An admin cannot change an owner's role.";
const LAST_OWNER = "An organization must have at least one owner, so the last owner cannot be";
const ROLE_LOST = "Your organization role has changed. Reload and try again.";

function assertValidRole(role: string): asserts role is OrgRole {
  if (!(orgMember.role.enumValues as readonly string[]).includes(role)) {
    throw new DomainError(`"${role}" is not a valid role.`);
  }
}

/**
 * The actor still holds the role their pre-check read, evaluated inside the
 * write. Aliased so it nests in statements that write org_member itself.
 */
function actorStill(actor: Pick<OrgMember, "userId" | "role">) {
  return sql`exists (select 1 from ${orgMember} ${sql.identifier("org_actor")}
    where ${sql.identifier("org_actor")}.${sql.identifier("user_id")} = ${actor.userId}
      and ${sql.identifier("org_actor")}.${sql.identifier("role")} = ${actor.role})`;
}

/** The last-owner rule as a condition on the written row, so the check and the write are one statement. */
function notLastOwner() {
  return or(
    ne(orgMember.role, "owner"),
    sql`(select count(*) from ${orgMember} where ${orgMember.role} = 'owner') > 1`,
  );
}

function untouchableBy(actor: Pick<OrgMember, "role">) {
  return actor.role === "owner" ? undefined : ne(orgMember.role, "owner");
}

async function requireTarget(db: DrizzleD1Database, userId: string): Promise<OrgMember> {
  const [target] = await db.select().from(orgMember).where(eq(orgMember.userId, userId));
  if (!target) throw new DomainError("That user is not a member of this organization.");
  return target;
}

/** After a guarded write matched nothing: refuse with the reason that holds now. */
async function explainRefusal(
  ctx: DomainContext,
  actor: OrgMember,
  targetUserId: string,
  ownerMessage: string,
  lastOwner: string,
  guardTeamOwners = false,
) {
  const current = await requireTarget(ctx.db, targetUserId);
  const now = await requireOrgMember(ctx.db, actor.userId);
  if (now.role !== actor.role) throw new AccessError("forbidden", ROLE_LOST);
  if (current.role === "owner" && actor.role !== "owner") throw new AccessError("forbidden", ownerMessage);
  if (guardTeamOwners && actor.role !== "owner" && await ownsATeam(ctx.db, targetUserId)) {
    throw new AccessError("forbidden", ADMIN_REMOVES_TEAM_OWNER);
  }
  throw new DomainError(lastOwner);
}

function teamOwnerRow(db: DrizzleD1Database, userId: string) {
  return db.select({ userId: teamMember.userId }).from(teamMember)
    .where(and(eq(teamMember.userId, userId), eq(teamMember.role, "owner")));
}

async function ownsATeam(db: DrizzleD1Database, userId: string) {
  return (await teamOwnerRow(db, userId).limit(1)).length > 0;
}

export async function renameOrg(ctx: DomainContext, input: { name: string }) {
  const actor = await requireOrgMember(ctx.db, ctx.actorUserId);
  requireOrgCapability(actor.role, "org:rename");
  const name = input.name.trim();
  if (!name) throw new DomainError("Organization name is required.");
  assertMaxLength("Organization name", name, MAX_LENGTH.name);

  const renamed = await ctx.db.update(org).set({ name }).where(actorStill(actor)).returning({ name: org.name });
  if (renamed.length === 0) throw new AccessError("forbidden", ROLE_LOST);
  return name;
}

export async function inviteToOrg(ctx: DomainContext, input: { email: string; role: OrgRole }) {
  const actor = await requireOrgMember(ctx.db, ctx.actorUserId);
  requireOrgCapability(actor.role, "org:manage_members");
  assertValidRole(input.role);
  // A DomainError for inviteToTeam's reason: a stale form deserves a sentence.
  if (input.role === "owner" && actor.role !== "owner") {
    throw new DomainError("Only an owner can invite someone as an owner.");
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new DomainError("A valid email address is required.");

  const [alreadyMember] = await ctx.db.select({ userId: orgMember.userId })
    .from(orgMember)
    .innerJoin(user, eq(user.id, orgMember.userId))
    .where(sql`lower(${user.email}) = ${email}`);
  if (alreadyMember) throw new DomainError(`${email} is already a member of this organization.`);

  const now = new Date();
  const write = ctx.db.insert(orgInvite).select(sql`
    select ${email}, ${input.role}, ${ctx.actorUserId}, ${now.getTime()}, null
    where ${actorStill(actor)}
  `).onConflictDoUpdate({
    target: orgInvite.email,
    set: { role: input.role, invitedByUserId: ctx.actorUserId, createdAt: now, acceptedAt: null },
    // As inviteToTeam: an admin cannot overwrite a pending owner invite, and an
    // identical pending invite is left alone so it is not mailed again.
    setWhere: and(
      actor.role === "owner" ? undefined : or(ne(orgInvite.role, "owner"), isNotNull(orgInvite.acceptedAt)),
      or(isNotNull(orgInvite.acceptedAt), ne(orgInvite.role, input.role), ne(orgInvite.invitedByUserId, ctx.actorUserId)),
    ),
  }).returning({ email: orgInvite.email });

  const written = ctx.emailNotifications
    ? (await ctx.db.batch([write, queueOrgInviteMail(ctx, email, now)]))[0]
    : await write;
  if (written.length > 0) return;

  if ((await requireOrgMember(ctx.db, actor.userId)).role !== actor.role) {
    throw new AccessError("forbidden", ROLE_LOST);
  }
  if (actor.role === "owner") return;
  const [protectedInvite] = await ctx.db.select({ role: orgInvite.role }).from(orgInvite).where(and(
    eq(orgInvite.email, email), eq(orgInvite.role, "owner"), isNull(orgInvite.acceptedAt),
  ));
  if (protectedInvite) {
    throw new DomainError(`${email} has a pending owner invite, which only an owner can change.`);
  }
}

export async function revokeOrgInvite(ctx: DomainContext, input: { email: string }) {
  const actor = await requireOrgMember(ctx.db, ctx.actorUserId);
  requireOrgCapability(actor.role, "org:manage_members");
  await ctx.db.delete(orgInvite).where(and(
    eq(orgInvite.email, input.email.trim().toLowerCase()),
    isNull(orgInvite.acceptedAt),
    actor.role === "owner" ? undefined : ne(orgInvite.role, "owner"),
    actorStill(actor),
  ));
}

export async function changeOrgMemberRole(ctx: DomainContext, input: { userId: string; role: OrgRole }) {
  const actor = await requireOrgMember(ctx.db, ctx.actorUserId);
  requireOrgCapability(actor.role, "org:change_role");
  assertValidRole(input.role);

  const target = await requireTarget(ctx.db, input.userId);
  if (actor.role !== "owner" && target.role === "owner") {
    throw new AccessError("forbidden", ADMIN_CHANGES_OWNER);
  }
  if (actor.role !== "owner" && input.role === "owner") {
    throw new DomainError("Only an owner can make someone an owner.");
  }

  const changed = await ctx.db.update(orgMember).set({ role: input.role }).where(and(
    eq(orgMember.userId, input.userId),
    input.role === "owner" ? undefined : notLastOwner(),
    untouchableBy(actor),
    actorStill(actor),
  )).returning({ userId: orgMember.userId });

  if (changed.length === 0) {
    await explainRefusal(ctx, actor, input.userId, ADMIN_CHANGES_OWNER, `${LAST_OWNER} demoted.`);
  }
}

/**
 * Removes someone from the org and so from every team. One batch, in
 * removeTeamMember's order, scoped by subqueries over the user's teams.
 */
export async function removeOrgMember(ctx: DomainContext, input: { userId: string }) {
  const actor = await requireOrgMember(ctx.db, ctx.actorUserId);
  requireOrgCapability(actor.role, "org:manage_members");

  const target = await requireTarget(ctx.db, input.userId);
  if (target.role === "owner" && actor.role !== "owner") {
    throw new AccessError("forbidden", ADMIN_REMOVES_OWNER);
  }
  // Only an org owner can remove someone who owns a team.
  if (actor.role !== "owner" && await ownsATeam(ctx.db, input.userId)) {
    throw new AccessError("forbidden", ADMIN_REMOVES_TEAM_OWNER);
  }

  const inTheirTeams = inArray(
    task.projectId,
    ctx.db.select({ id: project.id }).from(project).where(inArray(
      project.teamId,
      ctx.db.select({ teamId: teamMember.teamId }).from(teamMember).where(eq(teamMember.userId, input.userId)),
    )),
  );
  const memberRow = eq(orgMember.userId, input.userId);
  const theirEmail = ctx.db.select({ email: sql`lower(${user.email})` }).from(user).where(eq(user.id, input.userId));

  try {
    await ctx.db.batch([
      writeActivitySelect(
        ctx,
        {
          projectId: sql`${task.projectId}`,
          taskId: sql`${task.id}`,
          type: "task.updated",
          data: sql`json_object('fields', json_object('assignee', json_object(
            'from', json_object('id', ${input.userId}, 'displayName', ${user.name}),
            'to', null)))`,
        },
        sql`from ${task} join ${user} on ${user.id} = ${task.assigneeUserId}
          where ${task.assigneeUserId} = ${input.userId} and ${inTheirTeams}`,
      ),
      ctx.db.update(task)
        .set({ assigneeUserId: null, updatedAt: new Date() })
        .where(and(eq(task.assigneeUserId, input.userId), inTheirTeams)),
      ctx.db.update(timeEntry)
        .set(stopTimeEntryValues(Date.now()))
        .where(and(eq(timeEntry.userId, input.userId), isNull(timeEntry.endedAt))),
      // Pending invites would let them straight back in (invites are stored lowercased).
      ctx.db.delete(teamInvite).where(and(inArray(teamInvite.email, theirEmail), isNull(teamInvite.acceptedAt))),
      ctx.db.delete(orgInvite).where(and(inArray(orgInvite.email, theirEmail), isNull(orgInvite.acceptedAt))),
      // The org_member_leave_teams trigger deletes their team_member rows,
      // which cascade to project_member and team_reporting_line.
      ctx.db.delete(orgMember).where(and(
        memberRow,
        notLastOwner(),
        untouchableBy(actor),
        actor.role === "owner" ? undefined : not(exists(teamOwnerRow(ctx.db, input.userId))),
        actorStill(actor),
      )),
      // removeTeamMember's abort: a surviving row makes NOT NULL fail the batch.
      ctx.db.update(orgMember).set({ role: sql`NULL` }).where(memberRow),
    ]);
  } catch (error) {
    if (isConstraintError(error, "NOT NULL")) {
      await explainRefusal(ctx, actor, input.userId, ADMIN_REMOVES_OWNER, `${LAST_OWNER} removed.`, true);
    }
    throw error;
  }
}
