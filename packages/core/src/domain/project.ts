import { and, desc, eq, exists, inArray, ne, notExists, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import {
  AccessError,
  can,
  canProject,
  type Capability,
  requireCapability,
  requireOrgMember,
  requireProjectMember,
} from "../access";
import {
  type BatchWrites,
  type DomainContext,
  writeActivity,
  writeActivityIfChanged,
  writeActivitySelect,
} from "../activity";
import {
  DomainError,
  MAX_LENGTH,
  assertMaxLength,
  isConstraintError,
} from "../errors";
import { placeAfter } from "../position";
import { assertValidProjectKey, assertValidSlug } from "../slug";
import { user } from "../schema/auth";
import { orgMember } from "../schema/org";
import {
  type Project,
  type ProjectRole,
  type Status,
  project,
  projectMember,
  status,
} from "../schema/project";
import { task } from "../schema/task";

const DEFAULT_STATUSES = [
  { name: "Todo", color: "gray" },
  { name: "In Progress", color: "blue" },
  { name: "Done", color: "green" },
  { name: "Blocked", color: "red" },
] satisfies Pick<Status, "name" | "color">[];

async function requireProjectCapability(
  ctx: DomainContext,
  projectId: string,
  capability: Capability,
): Promise<Project> {
  const { project: row, member, projectRole } = await requireProjectMember(
    ctx.db,
    projectId,
    ctx.actorUserId,
  );
  if (!canProject(member.role, projectRole, capability)) {
    requireCapability(member.role, capability);
  }
  return row;
}

function requireStatusColor(color: NonNullable<Status["color"]>) {
  if (!status.color.enumValues.includes(color)) {
    throw new DomainError("Pick a status color.");
  }
  return color;
}

function statusName(input: string): string {
  const name = input.trim();
  if (!name) {
    throw new DomainError("Status name is required.");
  }
  assertMaxLength("Status name", name, MAX_LENGTH.name);
  return name;
}

async function requireManagedStatus(ctx: DomainContext, statusId: string) {
  const [row] = await ctx.db
    .select()
    .from(status)
    .where(eq(status.id, statusId));
  // Same answer as a status in a project the caller cannot reach, so the
  // response never reveals whether an id exists (as `loadTask` does).
  if (!row) {
    throw new AccessError("not_a_member", "No such status.");
  }
  await requireProjectCapability(ctx, row.projectId, "project:manage_statuses");
  return row;
}

/**
 * For a status write batched with `writeActivityIfChanged`: a concurrent
 * `deleteStatus` can remove the row after `requireManagedStatus` read it, so
 * the write matches nothing and logs nothing. The caller is then told what it
 * would have been told had the delete landed first.
 */
function assertStatusSurvived(written: unknown[]) {
  if (written.length === 0) {
    throw new DomainError("No such status.");
  }
}

export async function createProject(
  ctx: DomainContext,
  input: { orgId: string; slug: string; name: string; key: string },
): Promise<Project> {
  const actor = await requireOrgMember(ctx.db, input.orgId, ctx.actorUserId);
  requireCapability(actor.role, "project:create");

  // Same reserved list as org slugs: `/[org]/[project]/settings` means a
  // project slugged `settings` would shadow its own settings page (§4.10).
  assertValidSlug("Project slug", input.slug);
  assertValidProjectKey(input.key);

  const name = input.name.trim();
  if (!name) {
    throw new DomainError("Project name is required.");
  }
  assertMaxLength("Project name", name, MAX_LENGTH.name);

  // unique(orgId,slug) and unique(orgId,key) both exist; checked here so the
  // caller gets a sentence instead of a SQLite constraint message.
  const slugTaken = new DomainError(
    `A project with the slug "${input.slug}" already exists.`,
  );
  const keyTaken = new DomainError(
    `A project with the key "${input.key}" already exists.`,
  );
  const clashes = await ctx.db
    .select({ slug: project.slug, key: project.key })
    .from(project)
    .where(eq(project.orgId, input.orgId));
  if (clashes.some((p) => p.slug === input.slug)) {
    throw slugTaken;
  }
  if (clashes.some((p) => p.key === input.key)) {
    throw keyTaken;
  }

  const now = new Date();
  const row: Project = {
    id: crypto.randomUUID(),
    orgId: input.orgId,
    slug: input.slug,
    name,
    key: input.key,
    taskCounter: 0,
    createdAt: now,
    restrictTaskEdits: false,
  };
  const positions = generateNKeysBetween(null, null, DEFAULT_STATUSES.length);
  try {
    await ctx.db.batch([
      ctx.db.insert(project).values(row),
      // §3: the creator becomes a member, so a project is never created memberless.
      ctx.db.insert(projectMember).values({
        orgId: input.orgId,
        projectId: row.id,
        userId: ctx.actorUserId,
      }),
      ctx.db.insert(status).values(
        DEFAULT_STATUSES.map((s, i) => ({
          id: crypto.randomUUID(),
          projectId: row.id,
          ...s,
          position: positions[i],
          createdAt: now,
        })),
      ),
      // One activity row. The seeded statuses and the creator's
      // membership are part of creating the project, not separate events a
      // reader would want listed — §3 assigns no payload to "created with
      // defaults".
      writeActivity(ctx, {
        projectId: row.id,
        type: "project.created",
        data: { name: row.name, key: row.key },
      }),
    ]);
  } catch (error) {
    // A concurrent create took the slug or key after the check above.
    if (isConstraintError(error, "UNIQUE", "project.slug")) throw slugTaken;
    if (isConstraintError(error, "UNIQUE", "project.key")) throw keyTaken;
    throw error;
  }

  return row;
}

export async function setProjectTaskEditRestriction(
  ctx: DomainContext,
  { projectId, restricted }: { projectId: string; restricted: boolean },
) {
  const capability = "project:manage_task_editing";
  const { id, orgId } = await requireProjectCapability(ctx, projectId, capability);
  const { db, actorUserId } = ctx;
  const permittedRoles = orgMember.role.enumValues.filter((role) => can(role, capability));
  const stillPermitted = exists(db.select({ userId: orgMember.userId }).from(orgMember)
    .leftJoin(projectMember, and(
      eq(projectMember.projectId, id),
      eq(projectMember.orgId, orgMember.orgId),
      eq(projectMember.userId, orgMember.userId),
    ))
    .where(and(
      eq(orgMember.orgId, orgId),
      eq(orgMember.userId, actorUserId),
      or(inArray(orgMember.role, permittedRoles), eq(projectMember.role, "admin")),
    )));
  const [changed] = await db.batch([
    db.update(project).set({ restrictTaskEdits: restricted })
      .where(and(eq(project.id, id), ne(project.restrictTaskEdits, restricted), stillPermitted))
      .returning({ id: project.id }),
    writeActivityIfChanged(ctx, {
      projectId: id,
      type: "project.task_edit_restriction_changed",
      data: { restricted },
    }),
  ]);
  if (!changed.length) await requireProjectCapability(ctx, projectId, capability);
}

export async function addProjectMember(
  ctx: DomainContext,
  input: { projectId: string; userId: string },
) {
  const row = await requireProjectCapability(
    ctx,
    input.projectId,
    "project:manage_members",
  );

  // The composite FK would reject a non-org-member with "FOREIGN KEY
  // constraint failed"; this says what actually went wrong.
  const notOrgMember = new DomainError(
    "That user must be a member of the organization first.",
  );
  const alreadyMember = new DomainError(
    "That user is already a member of this project.",
  );
  const [target] = await ctx.db
    .select({ displayName: user.name })
    .from(orgMember)
    .innerJoin(user, eq(user.id, orgMember.userId))
    .where(
      and(eq(orgMember.orgId, row.orgId), eq(orgMember.userId, input.userId)),
    );
  if (!target) {
    throw notOrgMember;
  }

  const [existing] = await ctx.db
    .select({ userId: projectMember.userId })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, input.projectId),
        eq(projectMember.userId, input.userId),
      ),
    );
  if (existing) {
    throw alreadyMember;
  }

  try {
    await ctx.db.batch([
      ctx.db.insert(projectMember).values({
        orgId: row.orgId,
        projectId: input.projectId,
        userId: input.userId,
      }),
      writeActivity(ctx, {
        projectId: input.projectId,
        type: "project.member_added",
        data: { userId: input.userId, displayName: target.displayName },
      }),
    ]);
  } catch (error) {
    // Both checks above can be raced: a concurrent add, or the user's removal
    // from the org between the check and this insert.
    if (isConstraintError(error, "UNIQUE")) throw alreadyMember;
    if (isConstraintError(error, "FOREIGN KEY")) throw notOrgMember;
    throw error;
  }
}

export async function removeProjectMember(
  ctx: DomainContext,
  input: { projectId: string; userId: string },
) {
  const { project: row, member, projectRole } = await requireProjectMember(
    ctx.db, input.projectId, ctx.actorUserId,
  );
  if (!canProject(member.role, projectRole, "project:manage_members")) {
    requireCapability(member.role, "project:manage_members");
  }

  const [existing] = await ctx.db
    .select({ displayName: user.name })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(
      and(
        eq(projectMember.projectId, input.projectId),
        eq(projectMember.userId, input.userId),
      ),
    );
  const notMember = new DomainError("That user is not a member of this project.");
  if (!existing) {
    throw notMember;
  }

  const managesOrg = can(member.role, "org:manage_members");
  const orgManagerRoles = orgMember.role.enumValues.filter((role) => can(role, "org:manage_members"));
  const unprotectedOrgMember = notExists(ctx.db.select({ userId: orgMember.userId })
    .from(orgMember).where(and(
      eq(orgMember.orgId, row.orgId),
      eq(orgMember.userId, input.userId),
      inArray(orgMember.role, orgManagerRoles),
    )));
  const stillPermitted = managesOrg
    ? exists(ctx.db.select({ userId: orgMember.userId }).from(orgMember).where(and(
      eq(orgMember.orgId, row.orgId),
      eq(orgMember.userId, ctx.actorUserId),
      inArray(orgMember.role, orgManagerRoles),
    )))
    : exists(ctx.db.select({ userId: projectMember.userId }).from(projectMember).where(and(
      eq(projectMember.projectId, input.projectId),
      eq(projectMember.orgId, row.orgId),
      eq(projectMember.userId, ctx.actorUserId),
      eq(projectMember.role, "admin"),
    )));
  const removable = managesOrg ? undefined : and(
    eq(projectMember.role, "member"),
    unprotectedOrgMember,
  );

  // A concurrent removal can delete the row between the check and here; the
  // loser deletes nothing, so it logs nothing and is told what a sequential
  // second removal is told.
  const [deleted] = await ctx.db.batch([
    ctx.db
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.projectId, input.projectId),
          eq(projectMember.userId, input.userId),
          stillPermitted,
          removable,
        ),
      )
      .returning({ userId: projectMember.userId }),
    writeActivityIfChanged(ctx, {
      projectId: input.projectId,
      type: "project.member_removed",
      data: { userId: input.userId, displayName: existing.displayName },
    }),
  ]);
  if (deleted.length === 0) {
    if (!managesOrg) {
      throw new AccessError("forbidden", "Project admins can only remove project members.");
    }
    throw notMember;
  }
}

export async function setProjectMemberRole(
  ctx: DomainContext,
  { projectId, userId, role }: { projectId: string; userId: string; role: ProjectRole },
) {
  const { db, actorUserId } = ctx;
  const { project: row, member } = await requireProjectMember(db, projectId, actorUserId);
  requireCapability(member.role, "org:change_role");
  if (!projectMember.role.enumValues.includes(role)) {
    throw new DomainError("Choose a valid project role.");
  }

  const stillPermitted = exists(db.select({ userId: orgMember.userId }).from(orgMember)
    .where(and(
      eq(orgMember.orgId, row.orgId),
      eq(orgMember.userId, actorUserId),
      inArray(orgMember.role, orgMember.role.enumValues.filter((value) => can(value, "org:change_role"))),
    )));

  const eligibleTarget = db.select({ userId: orgMember.userId }).from(orgMember)
    .where(and(
      eq(orgMember.orgId, row.orgId),
      eq(orgMember.userId, userId),
      eq(orgMember.role, "member"),
      stillPermitted,
      exists(db.select({ id: project.id }).from(project).where(eq(project.id, projectId))),
    ));
  const from = role === "admin" ? "member" : "admin";
  const write = role === "admin"
    ? db.insert(projectMember).select(sql`
        select ${row.orgId}, ${projectId}, ${userId}, 'admin' where ${exists(eligibleTarget)}
      `).onConflictDoUpdate({
        target: [projectMember.projectId, projectMember.userId],
        set: { role },
        setWhere: and(eq(projectMember.orgId, row.orgId), eq(projectMember.role, from)),
      })
    : db.update(projectMember).set({ role }).where(and(
        eq(projectMember.orgId, row.orgId),
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, userId),
        eq(projectMember.role, from),
        exists(eligibleTarget),
      ));

  const [, , eligible] = await db.batch([
    write,
    writeActivityIfChanged(ctx, {
      projectId,
      type: "project.member_role_changed",
      data: { userId, from, to: role },
    }),
    eligibleTarget,
  ]);
  if (!eligible.length) {
    throw new DomainError("Only current organization members can be granted project admin access.");
  }
}

export async function createStatus(
  ctx: DomainContext,
  input: {
    projectId: string;
    name: string;
    color?: NonNullable<Status["color"]>;
  },
): Promise<Status> {
  await requireProjectCapability(
    ctx,
    input.projectId,
    "project:manage_statuses",
  );
  const name = statusName(input.name);
  const color = requireStatusColor(input.color === undefined ? "gray" : input.color);

  const existing = await ctx.db
    .select({ name: status.name, position: status.position })
    .from(status)
    .where(eq(status.projectId, input.projectId))
    .orderBy(desc(status.position));
  if (existing.some((s) => s.name === name)) {
    throw new DomainError(`This project already has a status called "${name}".`);
  }

  const row: Status = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    name,
    color,
    position: generateKeyBetween(existing[0]?.position ?? null, null),
    createdAt: new Date(),
  };
  await ctx.db.batch([
    ctx.db.insert(status).values(row),
    writeActivity(ctx, {
      projectId: row.projectId,
      type: "status.created",
      data: { id: row.id, name: row.name, color },
    }),
  ]);

  return row;
}

export async function renameStatus(
  ctx: DomainContext,
  input: { statusId: string; name: string },
) {
  const row = await requireManagedStatus(ctx, input.statusId);

  const name = statusName(input.name);
  if (name === row.name) {
    return;
  }

  const [clash] = await ctx.db
    .select({ id: status.id })
    .from(status)
    .where(and(eq(status.projectId, row.projectId), eq(status.name, name)));
  if (clash) {
    throw new DomainError(`This project already has a status called "${name}".`);
  }

  const [updated] = await ctx.db.batch([
    ctx.db
      .update(status)
      .set({ name })
      .where(eq(status.id, row.id))
      .returning({ id: status.id }),
    writeActivityIfChanged(ctx, {
      projectId: row.projectId,
      type: "status.renamed",
      data: { id: row.id, from: row.name, to: name },
    }),
  ]);
  assertStatusSurvived(updated);
}

export async function recolorStatus(
  ctx: DomainContext,
  input: { statusId: string; color: NonNullable<Status["color"]> },
) {
  const row = await requireManagedStatus(ctx, input.statusId);
  const color = requireStatusColor(input.color);
  if (color === row.color) return;

  // Match the color we read so the activity's previous value stays accurate
  // when two people edit the same status concurrently.
  const [updated] = await ctx.db.batch([
    ctx.db
      .update(status)
      .set({ color })
      .where(and(eq(status.id, row.id), sql`${status.color} is ${row.color}`))
      .returning({ id: status.id }),
    writeActivityIfChanged(ctx, {
      projectId: row.projectId,
      type: "status.recolored",
      data: { id: row.id, name: row.name, from: row.color, to: color },
    }),
  ]);
  if (!updated.length) {
    const [latest] = await ctx.db
      .select({ color: status.color })
      .from(status)
      .where(eq(status.id, row.id));
    if (latest?.color !== color) throw new DomainError("This status changed. Try again.");
  }
}

/**
 * Moves a status to sit directly after `afterStatusId`, or first when that is
 * null. One row written, which is the whole point of the fractional index (§3)
 * — plus, rarely, a re-keyed run of equal positions (`placeAfter`).
 */
export async function reorderStatus(
  ctx: DomainContext,
  input: { statusId: string; afterStatusId: string | null },
) {
  const row = await requireManagedStatus(ctx, input.statusId);
  if (input.afterStatusId === input.statusId) {
    throw new DomainError("A status cannot be placed after itself.");
  }

  const siblings = await ctx.db
    .select({ id: status.id, position: status.position })
    .from(status)
    .where(and(eq(status.projectId, row.projectId), ne(status.id, row.id)))
    .orderBy(status.position, status.id);

  const afterIndex = input.afterStatusId
    ? siblings.findIndex((s) => s.id === input.afterStatusId)
    : -1;
  if (input.afterStatusId && afterIndex === -1) {
    throw new DomainError("No such status in this project.");
  }

  // Concurrent `createStatus` calls append after the same last key, so equal
  // positions are reachable here as they are for tasks.
  const { position, rekeys } = placeAfter(siblings, afterIndex);

  const [moved] = await ctx.db.batch([
    ctx.db
      .update(status)
      .set({ position })
      .where(eq(status.id, row.id))
      .returning({ id: status.id }),
    // Directly after the write it records, which `changes()` reads.
    writeActivityIfChanged(ctx, {
      projectId: row.projectId,
      type: "status.reordered",
      data: { id: row.id, name: row.name },
    }),
    ...rekeys.map((r) =>
      ctx.db
        .update(status)
        .set({ position: r.position })
        .where(eq(status.id, r.id)),
    ),
  ]);
  assertStatusSurvived(moved);
}

/**
 * §3: blocked while tasks reference it, and the caller must name a status to
 * move them to. Tasks are never cascade-deleted.
 */
export async function deleteStatus(
  ctx: DomainContext,
  input: { statusId: string; moveTasksToStatusId?: string | null },
) {
  const row = await requireManagedStatus(ctx, input.statusId);

  const referencing = await ctx.db
    .select({ id: task.id })
    .from(task)
    .where(eq(task.statusId, row.id));

  let movedTo: Status | null = null;
  if (input.moveTasksToStatusId) {
    if (input.moveTasksToStatusId === row.id) {
      throw new DomainError("Tasks cannot be moved to the status being deleted.");
    }
    const [target] = await ctx.db
      .select()
      .from(status)
      .where(
        and(
          eq(status.id, input.moveTasksToStatusId),
          eq(status.projectId, row.projectId),
        ),
      );
    if (!target) {
      throw new DomainError("No such status in this project.");
    }
    movedTo = target;
  }

  if (referencing.length > 0 && !movedTo) {
    throw new DomainError(
      `"${row.name}" still holds ${referencing.length} task(s). Choose a status to move them to first.`,
    );
  }

  const moves: BatchItem<"sqlite">[] = movedTo
    ? [
        // Each moved task logs the `task.moved` a drag would, so its history
        // does not skip a column. One `INSERT … SELECT` over the tasks the
        // update below moves — read inside the batch, so a task created
        // concurrently is logged too — rather than a statement per task.
        // Before the update, which changes what it selects.
        writeActivitySelect(
          ctx,
          {
            projectId: row.projectId,
            taskId: sql`${task.id}`,
            type: "task.moved",
            data: sql`json_object(
              'from', json_object('id', ${row.id}, 'name', ${row.name}),
              'to', json_object('id', ${movedTo.id}, 'name', ${movedTo.name}))`,
          },
          sql`from ${task} where ${task.statusId} = ${row.id}`,
        ),
        // Before the delete, which the task FK would otherwise refuse.
        // `position` is left alone: it is scoped to (projectId, statusId), and
        // `placeAfter` re-keys a run of equal positions the first time a move
        // needs a gap there.
        ctx.db
          .update(task)
          .set({ statusId: movedTo.id, updatedAt: new Date() })
          .where(eq(task.statusId, row.id)),
      ]
    : [];
  const writes: BatchWrites = [
    ctx.db
      .delete(status)
      .where(eq(status.id, row.id))
      .returning({ id: status.id }),
    // Conditional for `assertStatusSurvived`'s race: a concurrent delete of the
    // same status already logged it.
    writeActivityIfChanged(ctx, {
      projectId: row.projectId,
      type: "status.deleted",
      data: {
        id: row.id,
        name: row.name,
        // §3 pins `movedTo:{id,name}`; null when the status held no tasks, so
        // nothing was moved — even if the caller named a target anyway.
        movedTo:
          movedTo && referencing.length > 0
            ? { id: movedTo.id, name: movedTo.name }
            : null,
      },
    }),
  ];
  writes.unshift(...moves);

  let results;
  try {
    results = await ctx.db.batch(writes);
  } catch (error) {
    if (isConstraintError(error, "FOREIGN KEY")) {
      // The target was deleted after the check above, so the move itself
      // pointed tasks at a status that no longer exists.
      if (movedTo) {
        const [target] = await ctx.db
          .select({ id: status.id })
          .from(status)
          .where(eq(status.id, movedTo.id));
        if (!target) {
          throw new DomainError(
            `"${movedTo.name}" no longer exists. Choose another status to move the tasks to.`,
          );
        }
      }
      // A task created into this status after the count above, with no target
      // to move it to: the task FK refuses the delete, and the whole batch with it.
      throw new DomainError(
        `"${row.name}" still holds tasks. Choose a status to move them to first.`,
      );
    }
    throw error;
  }
  assertStatusSurvived(results[moves.length] as unknown[]);
}
