import { and, eq, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  AccessError, requireCapability, requireOrgCapability, requireOrgMember, requireTeamMember, teamAccess,
} from "../access";
import { type BatchWrites, type DomainContext, writeActivitySelect } from "../activity";
import {
  DomainError,
  MAX_LENGTH,
  assertMaxLength,
  isConstraintError,
} from "../errors";
import { assertValidSlug } from "../slug";
import { user } from "../schema/auth";
import { orgInvite, orgMember } from "../schema/org";
import { type Team, type TeamMember, team, teamInvite, teamMember } from "../schema/team";
import { project } from "../schema/project";
import { task } from "../schema/task";
import { timeEntry } from "../schema/time";
import { inviterStillManagesOrg, inviterStillManagesTeam, verifiedInviteRecipient } from "./invite-eligibility";
import { queueTeamInviteMail } from "./mail";
import { stopTimeEntryValues } from "./time";

/**
 * Claims live team and org invitations for a verified address. Team roles never
 * change; an org invite only raises an existing org role.
 *
 * Team activity has no corresponding project ID, so claims write no activity row.
 */
export async function claimInvites(
  db: DrizzleD1Database,
  userId: string,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase();
  const pending = and(
    eq(teamInvite.email, normalizedEmail),
    isNull(teamInvite.acceptedAt),
    inviterStillManagesTeam(),
    verifiedInviteRecipient(db, userId, normalizedEmail),
  );
  const orgPending = and(
    eq(orgInvite.email, normalizedEmail),
    isNull(orgInvite.acceptedAt),
    inviterStillManagesOrg(),
    verifiedInviteRecipient(db, userId, normalizedEmail),
  );
  const [teamEligible, orgEligible] = await db.batch([
    db.select({ teamId: teamInvite.teamId }).from(teamInvite).where(pending).limit(1),
    db.select({ email: orgInvite.email }).from(orgInvite).where(orgPending),
  ]);
  if (teamEligible.length === 0 && orgEligible.length === 0) return;

  // Recheck current invite and inviter inside the same batch as the grant.
  const now = new Date();
  const rank = (role: SQL) => sql`(case ${role} when 'owner' then 3 when 'admin' then 2 else 1 end)`;
  const writes: BatchWrites = [
    db.insert(orgMember).select(
      db.select({
        userId: sql<string>`${userId}`.as("user_id"),
        role: orgInvite.role,
        createdAt: sql<Date>`${now.getTime()}`.as("created_at"),
      }).from(orgInvite).where(orgPending),
    ).onConflictDoUpdate({
      target: orgMember.userId,
      set: { role: sql`excluded.role` },
      setWhere: sql`${rank(sql`excluded.role`)} > ${rank(sql`${orgMember.role}`)}`,
    }),
    db.update(orgInvite).set({ acceptedAt: now }).where(orgPending),
    db.insert(teamMember).select(
      db.select({
        teamId: teamInvite.teamId,
        userId: sql<string>`${userId}`.as("user_id"),
        role: teamInvite.role,
        createdAt: sql<Date>`${now.getTime()}`.as("created_at"),
      }).from(teamInvite).where(pending),
    ).onConflictDoNothing(),
    db.update(teamInvite).set({ acceptedAt: now }).where(pending),
  ];
  await db.batch(writes);
}

// Every function below writes no team-level activity row, for claimInvites'
// reason above: `activity.projectId` is NOT NULL and §3 defines no team-level
// activity type. (removeTeamMember does log the task-level side effect.)

/**
 * The actor is still an effective team admin (real, or an org owner/admin), as
 * a SQL condition on the row being written, so a demotion or removal that
 * lands after the pre-check cannot slip through.
 *
 * There is no last-admin rule: org owners and admins always cover a team.
 */
function actorStillAdmin(ctx: DomainContext, teamId: string) {
  return eq(teamAccess(teamId, ctx.actorUserId).role, "admin");
}

const NO_LONGER_ADMIN = "You no longer manage this team's members.";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The schema's own enum, so the domain cannot accept a role the column does not. */
function assertValidRole(role: string): asserts role is TeamMember["role"] {
  if (!(teamMember.role.enumValues as readonly string[]).includes(role)) {
    throw new DomainError(`"${role}" is not a valid role.`);
  }
}

async function requireTarget(
  db: DrizzleD1Database,
  teamId: string,
  userId: string,
): Promise<TeamMember> {
  const [target] = await db
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));

  if (!target) {
    throw new DomainError("That user is not a member of this team.");
  }
  return target;
}

function validateTeamName(input: string) {
  const name = input.trim();
  if (!name) {
    throw new DomainError("Team name is required.");
  }
  assertMaxLength("Team name", name, MAX_LENGTH.name);
  return name;
}

export async function createTeam(
  ctx: DomainContext,
  input: { slug: string; name: string },
): Promise<Team> {
  const actor = await requireOrgMember(ctx.db, ctx.actorUserId);
  requireOrgCapability(actor.role, "org:create_team");
  assertValidSlug("Team slug", input.slug);
  const name = validateTeamName(input.name);

  const slugTaken = new DomainError(`The slug "${input.slug}" is already taken.`);
  const [taken] = await ctx.db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.slug, input.slug));
  if (taken) {
    throw slugTaken;
  }

  const now = new Date();
  const row: Team = {
    id: crypto.randomUUID(),
    slug: input.slug,
    name,
    createdAt: now,
  };

  try {
    await ctx.db.batch([
      ctx.db.insert(team).values(row),
      ctx.db.insert(teamMember).values({
        teamId: row.id,
        userId: ctx.actorUserId,
        role: "admin",
        createdAt: now,
      }),
    ]);
  } catch (error) {
    // A concurrent create took the slug between the check above and here.
    if (isConstraintError(error, "UNIQUE")) throw slugTaken;
    throw error;
  }

  return row;
}

export async function renameTeam(
  ctx: DomainContext,
  input: { teamId: string; name: string },
) {
  const actor = await requireTeamMember(ctx.db, input.teamId, ctx.actorUserId);
  requireCapability(actor.role, "team:rename");
  const name = validateTeamName(input.name);

  await ctx.db.update(team).set({ name }).where(eq(team.id, input.teamId));
  return name;
}

export async function inviteToTeam(
  ctx: DomainContext,
  input: { teamId: string; email: string; role: TeamMember["role"] },
) {
  const actor = await requireTeamMember(ctx.db, input.teamId, ctx.actorUserId);
  requireCapability(actor.role, "team:manage_members");
  assertValidRole(input.role);

  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) {
    throw new DomainError("A valid email address is required.");
  }

  // §3's first guard on the re-invite upsert: inviting someone who is already a
  // member would clear `acceptedAt` on a live membership and push a duplicate
  // `team_member` insert into their next sign-in.
  const [alreadyMember] = await ctx.db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(
      and(
        eq(teamMember.teamId, input.teamId),
        sql`lower(${user.email}) = ${email}`,
      ),
    );
  if (alreadyMember) {
    throw new DomainError(
      `${email} is already a member of this team.`,
    );
  }

  const now = new Date();
  const write = ctx.db
    .insert(teamInvite)
    .values({
      teamId: input.teamId,
      email,
      role: input.role,
      invitedByUserId: ctx.actorUserId,
      createdAt: now,
      acceptedAt: null,
    })
    // §3: re-inviting is an upsert, so a removed-then-reinvited user works.
    .onConflictDoUpdate({
      target: [teamInvite.teamId, teamInvite.email],
      set: {
        role: input.role,
        invitedByUserId: ctx.actorUserId,
        createdAt: now,
        acceptedAt: null,
      },
      setWhere: or(isNotNull(teamInvite.acceptedAt), ne(teamInvite.role, input.role), ne(teamInvite.invitedByUserId, ctx.actorUserId)),
    });

  if (ctx.emailNotifications) {
    await ctx.db.batch([write, queueTeamInviteMail(ctx, input.teamId, email, now)]);
  } else {
    await write;
  }
}

export async function revokeTeamInvite(ctx: DomainContext, input: { teamId: string; email: string }) {
  const actor = await requireTeamMember(ctx.db, input.teamId, ctx.actorUserId);
  requireCapability(actor.role, "team:manage_members");
  const revoked = await ctx.db.delete(teamInvite).where(and(
    eq(teamInvite.teamId, input.teamId), eq(teamInvite.email, input.email.trim().toLowerCase()),
    isNull(teamInvite.acceptedAt), actorStillAdmin(ctx, input.teamId),
  )).returning({ email: teamInvite.email });
  // Nothing to revoke is fine; being demoted since the pre-check is not.
  if (revoked.length === 0) {
    const still = await requireTeamMember(ctx.db, input.teamId, ctx.actorUserId);
    if (still.role !== "admin") throw new AccessError("forbidden", NO_LONGER_ADMIN);
  }
}

export async function removeTeamMember(
  ctx: DomainContext,
  input: { teamId: string; userId: string },
) {
  const actor = await requireTeamMember(ctx.db, input.teamId, ctx.actorUserId);
  requireCapability(actor.role, "team:manage_members");

  await requireTarget(ctx.db, input.teamId, input.userId);

  // §3's cascade, the half no constraint expresses: `task.assigneeUserId` has
  // a FK to `user`, not to membership, so nothing nulls it on its own. Each
  // unassigned task gets the `task.updated` row any other unassignment would,
  // written by one `INSERT … SELECT` before the update that changes what it
  // selects, rather than a statement per task.
  const inTeam = inArray(
    task.projectId,
    ctx.db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.teamId, input.teamId)),
  );
  const memberRow = and(
    eq(teamMember.teamId, input.teamId),
    eq(teamMember.userId, input.userId),
  );

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
          where ${task.assigneeUserId} = ${input.userId} and ${inTeam}`,
      ),
      ctx.db
        .update(task)
        .set({ assigneeUserId: null, updatedAt: new Date() })
        .where(and(eq(task.assigneeUserId, input.userId), inTeam)),
      // The other half is the composite FK `project_member(teamId,userId) ->
      // team_member(teamId,userId) ON DELETE CASCADE`, so their project_member
      // rows go with this one. Not repeated here; test/team.test.ts asserts it.
      // Their running timer in this team stops with their membership.
      ctx.db
        .update(timeEntry)
        .set(stopTimeEntryValues(Date.now()))
        .where(and(eq(timeEntry.userId, input.userId), eq(timeEntry.teamId, input.teamId), isNull(timeEntry.endedAt))),
      ctx.db
        .delete(teamMember)
        .where(and(memberRow, actorStillAdmin(ctx, input.teamId))),
      // The guarded delete above can match nothing — the actor stopped being
      // a team admin after the check above — and a zero-row
      // delete does not fail a batch, so the unassignments and activity rows
      // before it would commit. This statement only matches if the row
      // survived, and setting NOT NULL `role` to NULL then aborts the whole
      // batch. D1 has no `RAISE` outside triggers; this is the portable way to
      // make "nothing deleted" roll back.
      ctx.db.update(teamMember).set({ role: sql`NULL` }).where(memberRow),
    ]);
  } catch (error) {
    if (isConstraintError(error, "NOT NULL")) {
      // Re-read: the row may have been removed since the pre-check.
      await requireTarget(ctx.db, input.teamId, input.userId);
      throw new AccessError("forbidden", NO_LONGER_ADMIN);
    }
    throw error;
  }
}

export async function changeTeamMemberRole(
  ctx: DomainContext,
  input: { teamId: string; userId: string; role: TeamMember["role"] },
) {
  const actor = await requireTeamMember(ctx.db, input.teamId, ctx.actorUserId);
  requireCapability(actor.role, "team:change_role");
  assertValidRole(input.role);

  await requireTarget(ctx.db, input.teamId, input.userId);

  const changed = await ctx.db
    .update(teamMember)
    .set({ role: input.role })
    .where(
      and(
        eq(teamMember.teamId, input.teamId),
        eq(teamMember.userId, input.userId),
        actorStillAdmin(ctx, input.teamId),
      ),
    )
    .returning({ userId: teamMember.userId });

  if (changed.length === 0) {
    // The row may have been removed (and `requireTarget` says so) or the actor
    // demoted since the pre-check.
    await requireTarget(ctx.db, input.teamId, input.userId);
    throw new AccessError("forbidden", NO_LONGER_ADMIN);
  }
}
