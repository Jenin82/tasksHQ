import { and, eq, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { AccessError, requireCapability, requireOrgCapability, requireOrgMember, requireTeamMember, type TeamAccess } from "../access";
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
 * §3's "admins can't touch owners" as a SQL condition on the row being
 * written, so the check and the write are one statement: the pre-check reads
 * the target's role before the write, so an owner promoting the target in
 * between would otherwise let an admin remove or change a fresh owner.
 *
 * There is no last-owner rule (P5): org owners always cover a team, so a team
 * may be left without a real owner.
 */
function untouchableBy(actor: Pick<TeamAccess, "role">) {
  return actor.role === "owner" ? undefined : ne(teamMember.role, "owner");
}

const ADMIN_REMOVES_OWNER = "An admin cannot remove an owner.";
const ADMIN_CHANGES_OWNER = "An admin cannot change an owner's role.";

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
        role: "owner",
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

  // §3's matrix: an admin's authority over members stops short of owners, so
  // it cannot hand out the role it cannot revoke. A DomainError, not an
  // AccessError: the admin may invite, and a stale form offering "owner"
  // deserves an inline sentence rather than a full-page 403.
  if (input.role === "owner" && actor.role !== "owner") {
    throw new DomainError("Only an owner can invite someone as an owner.");
  }

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
      // The upsert would otherwise let an admin downgrade an owner's pending
      // owner invite — changing an owner-level grant it could not have made.
      // Part of the write rather than a read before it, so an owner invite
      // landing in between cannot slip past. An accepted owner invite is fair
      // game: re-inviting a removed former owner is §3's ordinary re-invite.
      setWhere: and(
        actor.role === "owner" ? undefined : or(ne(teamInvite.role, "owner"), isNotNull(teamInvite.acceptedAt)),
        or(isNotNull(teamInvite.acceptedAt), ne(teamInvite.role, input.role), ne(teamInvite.invitedByUserId, ctx.actorUserId)),
      ),
    })
    .returning({ email: teamInvite.email });

  const written = ctx.emailNotifications
    ? (await ctx.db.batch([write, queueTeamInviteMail(ctx, input.teamId, email, now)]))[0]
    : await write;
  if (written.length > 0 || actor.role === "owner") return;

  const [protectedInvite] = await ctx.db.select({ role: teamInvite.role }).from(teamInvite).where(and(
    eq(teamInvite.teamId, input.teamId), eq(teamInvite.email, email),
    eq(teamInvite.role, "owner"), isNull(teamInvite.acceptedAt),
  ));
  if (protectedInvite) {
    throw new DomainError(
      `${email} has a pending owner invite, which only an owner can change.`,
    );
  }
}

export async function revokeTeamInvite(ctx: DomainContext, input: { teamId: string; email: string }) {
  const actor = await requireTeamMember(ctx.db, input.teamId, ctx.actorUserId);
  requireCapability(actor.role, "team:manage_members");
  await ctx.db.delete(teamInvite).where(and(
    eq(teamInvite.teamId, input.teamId), eq(teamInvite.email, input.email.trim().toLowerCase()),
    isNull(teamInvite.acceptedAt), actor.role === "owner" ? undefined : ne(teamInvite.role, "owner"),
  ));
}

export async function removeTeamMember(
  ctx: DomainContext,
  input: { teamId: string; userId: string },
) {
  const actor = await requireTeamMember(ctx.db, input.teamId, ctx.actorUserId);
  requireCapability(actor.role, "team:manage_members");

  const target = await requireTarget(ctx.db, input.teamId, input.userId);

  if (target.role === "owner" && actor.role !== "owner") {
    throw new AccessError("forbidden", ADMIN_REMOVES_OWNER);
  }

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
        .where(and(memberRow, untouchableBy(actor))),
      // The guarded delete above can match nothing — the target became an
      // owner after the check above — and a zero-row
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
      throw new AccessError("forbidden", ADMIN_REMOVES_OWNER);
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

  const target = await requireTarget(ctx.db, input.teamId, input.userId);

  // §3's matrix: an admin can neither grant nor target owner. Targeting an
  // owner is a 403; granting owner is a DomainError for inviteToTeam's reason —
  // a stale role picker should get an inline sentence.
  if (actor.role !== "owner" && target.role === "owner") {
    throw new AccessError("forbidden", ADMIN_CHANGES_OWNER);
  }
  if (actor.role !== "owner" && input.role === "owner") {
    throw new DomainError("Only an owner can make someone an owner.");
  }

  const changed = await ctx.db
    .update(teamMember)
    .set({ role: input.role })
    .where(
      and(
        eq(teamMember.teamId, input.teamId),
        eq(teamMember.userId, input.userId),
        untouchableBy(actor),
      ),
    )
    .returning({ userId: teamMember.userId });

  if (changed.length === 0) {
    // Re-read rather than trust `target`: the row may have been removed (and
    // `requireTarget` says so) or promoted since the pre-check.
    await requireTarget(ctx.db, input.teamId, input.userId);
    throw new AccessError("forbidden", ADMIN_CHANGES_OWNER);
  }
}
