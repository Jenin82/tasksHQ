import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { AccessError, requireCapability, requireOrgMember } from "../access";
import { type DomainContext, writeActivitySelect } from "../activity";
import {
  DomainError,
  MAX_LENGTH,
  assertMaxLength,
  isConstraintError,
} from "../errors";
import { assertValidSlug } from "../slug";
import { user } from "../schema/auth";
import { type Org, type OrgMember, org, orgInvite, orgMember } from "../schema/org";
import { project } from "../schema/project";
import { task } from "../schema/task";
import { inviterStillManagesOrg, verifiedInviteRecipient } from "./invite-eligibility";
import { queueOrgInviteMail } from "./mail";

/**
 * Claims live invitations for a verified address without changing existing roles.
 *
 * Org activity has no corresponding project ID, so claims write no activity row.
 */
export async function claimInvites(
  db: DrizzleD1Database,
  userId: string,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase();
  const pending = and(
    eq(orgInvite.email, normalizedEmail),
    isNull(orgInvite.acceptedAt),
    inviterStillManagesOrg(db),
    verifiedInviteRecipient(db, userId, normalizedEmail),
  );
  const [eligible] = await db.select({ orgId: orgInvite.orgId })
    .from(orgInvite).where(pending).limit(1);
  if (!eligible) return;

  // Recheck current invite and inviter inside the same batch as the grant.
  const now = new Date();
  await db.batch([
    db.insert(orgMember).select(
      db.select({
        orgId: orgInvite.orgId,
        userId: sql<string>`${userId}`.as("user_id"),
        role: orgInvite.role,
        createdAt: sql<Date>`${now.getTime()}`.as("created_at"),
      }).from(orgInvite).where(pending),
    ).onConflictDoNothing(),
    db.update(orgInvite).set({ acceptedAt: now }).where(pending),
  ]);
}

// Every function below writes no org-level activity row, for claimInvites'
// reason above: `activity.projectId` is NOT NULL and §3 defines no org-level
// activity type. (removeOrgMember does log the task-level side effect.)

/**
 * §3's last-owner rule as a SQL condition on the row being removed or demoted,
 * so the check and the write are one statement. A separate count-then-write
 * lets two owners remove each other concurrently: both counts see two owners.
 */
function notLastOwner(orgId: string) {
  return or(
    ne(orgMember.role, "owner"),
    sql`(select count(*) from ${orgMember} where ${orgMember.orgId} = ${orgId} and ${orgMember.role} = 'owner') > 1`,
  );
}

/**
 * §3's "admins can't touch owners" as a SQL condition on the row being
 * written, for `notLastOwner`'s reason: the pre-check reads the target's role
 * before the write, so an owner promoting the target in between would
 * otherwise let an admin remove or change a fresh owner.
 */
function untouchableBy(actor: OrgMember) {
  return actor.role === "owner" ? undefined : ne(orgMember.role, "owner");
}

const ADMIN_REMOVES_OWNER = "An admin cannot remove an owner.";
const ADMIN_CHANGES_OWNER = "An admin cannot change an owner's role.";

const LAST_OWNER =
  "An organization must have at least one owner, so the last owner cannot be";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The schema's own enum, so the domain cannot accept a role the column does not. */
function assertValidRole(role: string): asserts role is OrgMember["role"] {
  if (!(orgMember.role.enumValues as readonly string[]).includes(role)) {
    throw new DomainError(`"${role}" is not a valid role.`);
  }
}

async function requireTarget(
  db: DrizzleD1Database,
  orgId: string,
  userId: string,
): Promise<OrgMember> {
  const [target] = await db
    .select()
    .from(orgMember)
    .where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, userId)));

  if (!target) {
    throw new DomainError("That user is not a member of this organization.");
  }
  return target;
}

function validateOrgName(input: string) {
  const name = input.trim();
  if (!name) {
    throw new DomainError("Organization name is required.");
  }
  assertMaxLength("Organization name", name, MAX_LENGTH.name);
  return name;
}

export async function createOrg(
  ctx: DomainContext,
  input: { slug: string; name: string },
): Promise<Org> {
  assertValidSlug("Organization slug", input.slug);
  const name = validateOrgName(input.name);

  const slugTaken = new DomainError(`The slug "${input.slug}" is already taken.`);
  const [taken] = await ctx.db
    .select({ id: org.id })
    .from(org)
    .where(eq(org.slug, input.slug));
  if (taken) {
    throw slugTaken;
  }

  const now = new Date();
  const row: Org = {
    id: crypto.randomUUID(),
    slug: input.slug,
    name,
    createdAt: now,
  };

  try {
    await ctx.db.batch([
      ctx.db.insert(org).values(row),
      ctx.db.insert(orgMember).values({
        orgId: row.id,
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

export async function renameOrg(
  ctx: DomainContext,
  input: { orgId: string; name: string },
) {
  const actor = await requireOrgMember(ctx.db, input.orgId, ctx.actorUserId);
  requireCapability(actor.role, "org:rename");
  const name = validateOrgName(input.name);

  await ctx.db.update(org).set({ name }).where(eq(org.id, input.orgId));
  return name;
}

export async function inviteToOrg(
  ctx: DomainContext,
  input: { orgId: string; email: string; role: OrgMember["role"] },
) {
  const actor = await requireOrgMember(ctx.db, input.orgId, ctx.actorUserId);
  requireCapability(actor.role, "org:manage_members");
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
  // `org_member` insert into their next sign-in.
  const [alreadyMember] = await ctx.db
    .select({ userId: orgMember.userId })
    .from(orgMember)
    .innerJoin(user, eq(user.id, orgMember.userId))
    .where(
      and(
        eq(orgMember.orgId, input.orgId),
        sql`lower(${user.email}) = ${email}`,
      ),
    );
  if (alreadyMember) {
    throw new DomainError(
      `${email} is already a member of this organization.`,
    );
  }

  const now = new Date();
  const write = ctx.db
    .insert(orgInvite)
    .values({
      orgId: input.orgId,
      email,
      role: input.role,
      invitedByUserId: ctx.actorUserId,
      createdAt: now,
      acceptedAt: null,
    })
    // §3: re-inviting is an upsert, so a removed-then-reinvited user works.
    .onConflictDoUpdate({
      target: [orgInvite.orgId, orgInvite.email],
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
        actor.role === "owner" ? undefined : or(ne(orgInvite.role, "owner"), isNotNull(orgInvite.acceptedAt)),
        or(isNotNull(orgInvite.acceptedAt), ne(orgInvite.role, input.role), ne(orgInvite.invitedByUserId, ctx.actorUserId)),
      ),
    })
    .returning({ email: orgInvite.email });

  const written = ctx.emailNotifications
    ? (await ctx.db.batch([write, queueOrgInviteMail(ctx, input.orgId, email, now)]))[0]
    : await write;
  if (written.length > 0 || actor.role === "owner") return;

  const [protectedInvite] = await ctx.db.select({ role: orgInvite.role }).from(orgInvite).where(and(
    eq(orgInvite.orgId, input.orgId), eq(orgInvite.email, email),
    eq(orgInvite.role, "owner"), isNull(orgInvite.acceptedAt),
  ));
  if (protectedInvite) {
    throw new DomainError(
      `${email} has a pending owner invite, which only an owner can change.`,
    );
  }
}

export async function revokeOrgInvite(ctx: DomainContext, input: { orgId: string; email: string }) {
  const actor = await requireOrgMember(ctx.db, input.orgId, ctx.actorUserId);
  requireCapability(actor.role, "org:manage_members");
  await ctx.db.delete(orgInvite).where(and(
    eq(orgInvite.orgId, input.orgId), eq(orgInvite.email, input.email.trim().toLowerCase()),
    isNull(orgInvite.acceptedAt), actor.role === "owner" ? undefined : ne(orgInvite.role, "owner"),
  ));
}

export async function removeOrgMember(
  ctx: DomainContext,
  input: { orgId: string; userId: string },
) {
  const actor = await requireOrgMember(ctx.db, input.orgId, ctx.actorUserId);
  requireCapability(actor.role, "org:manage_members");

  const target = await requireTarget(ctx.db, input.orgId, input.userId);

  if (target.role === "owner" && actor.role !== "owner") {
    throw new AccessError("forbidden", ADMIN_REMOVES_OWNER);
  }

  // §3's cascade, the half no constraint expresses: `task.assigneeUserId` has
  // a FK to `user`, not to membership, so nothing nulls it on its own. Each
  // unassigned task gets the `task.updated` row any other unassignment would,
  // written by one `INSERT … SELECT` before the update that changes what it
  // selects, rather than a statement per task.
  const inOrg = inArray(
    task.projectId,
    ctx.db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.orgId, input.orgId)),
  );
  const memberRow = and(
    eq(orgMember.orgId, input.orgId),
    eq(orgMember.userId, input.userId),
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
          where ${task.assigneeUserId} = ${input.userId} and ${inOrg}`,
      ),
      ctx.db
        .update(task)
        .set({ assigneeUserId: null, updatedAt: new Date() })
        .where(and(eq(task.assigneeUserId, input.userId), inOrg)),
      // The other half is the composite FK `project_member(orgId,userId) ->
      // org_member(orgId,userId) ON DELETE CASCADE`, so their project_member
      // rows go with this one. Not repeated here; test/org.test.ts asserts it.
      ctx.db
        .delete(orgMember)
        .where(and(memberRow, notLastOwner(input.orgId), untouchableBy(actor))),
      // The guarded delete above can match nothing — the target is the last
      // owner, or became an owner after the check above — and a zero-row
      // delete does not fail a batch, so the unassignments and activity rows
      // before it would commit. This statement only matches if the row
      // survived, and setting NOT NULL `role` to NULL then aborts the whole
      // batch. D1 has no `RAISE` outside triggers; this is the portable way to
      // make "nothing deleted" roll back.
      ctx.db.update(orgMember).set({ role: sql`NULL` }).where(memberRow),
    ]);
  } catch (error) {
    if (isConstraintError(error, "NOT NULL")) {
      // Re-read to say which guard refused: the role may have changed since
      // the pre-check.
      const current = await requireTarget(ctx.db, input.orgId, input.userId);
      if (current.role === "owner" && actor.role !== "owner") {
        throw new AccessError("forbidden", ADMIN_REMOVES_OWNER);
      }
      throw new DomainError(`${LAST_OWNER} removed.`);
    }
    throw error;
  }
}

export async function changeOrgMemberRole(
  ctx: DomainContext,
  input: { orgId: string; userId: string; role: OrgMember["role"] },
) {
  const actor = await requireOrgMember(ctx.db, input.orgId, ctx.actorUserId);
  requireCapability(actor.role, "org:change_role");
  assertValidRole(input.role);

  const target = await requireTarget(ctx.db, input.orgId, input.userId);

  // §3's matrix: an admin can neither grant nor target owner. Targeting an
  // owner is a 403; granting owner is a DomainError for inviteToOrg's reason —
  // a stale role picker should get an inline sentence.
  if (actor.role !== "owner" && target.role === "owner") {
    throw new AccessError("forbidden", ADMIN_CHANGES_OWNER);
  }
  if (actor.role !== "owner" && input.role === "owner") {
    throw new DomainError("Only an owner can make someone an owner.");
  }

  const changed = await ctx.db
    .update(orgMember)
    .set({ role: input.role })
    .where(
      and(
        eq(orgMember.orgId, input.orgId),
        eq(orgMember.userId, input.userId),
        // Promoting to owner never shrinks the owner count, so only a demotion
        // carries the last-owner guard.
        input.role === "owner" ? undefined : notLastOwner(input.orgId),
        untouchableBy(actor),
      ),
    )
    .returning({ userId: orgMember.userId });

  if (changed.length === 0) {
    // Re-read rather than trust `target`: the row may have been removed (and
    // `requireTarget` says so) or promoted since the pre-check.
    const current = await requireTarget(ctx.db, input.orgId, input.userId);
    if (current.role === "owner" && actor.role !== "owner") {
      throw new AccessError("forbidden", ADMIN_CHANGES_OWNER);
    }
    throw new DomainError(`${LAST_OWNER} demoted.`);
  }
}
