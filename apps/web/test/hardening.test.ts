import { env } from "cloudflare:test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import {
  addComment,
  addProjectMember,
  archiveTask,
  changeTeamMemberRole,
  createProject,
  createTeam as createTeamChecked,
  createStatus,
  createTask,
  deleteStatus,
  getTaskDetail,
  inviteToTeam,
  listTasks,
  moveTask,
  recolorStatus,
  removeTeamMember,
  removeProjectMember,
  renameStatus,
  reorderStatus,
  revokeTeamInvite,
  updateTask,
} from "@tasks/core/domain";
import { createTeam } from "./helpers";
import {
  activity,
  orgMember,
  teamInvite,
  teamMember,
  status,
  task,
  user,
} from "@tasks/core/schema";

// Same seam as test/board.test.ts, for the one Server Action tested here.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@hd.test`,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});
const { moveTaskAction } = await import("@/app/[team]/[project]/actions");

// Review fixes: races, atomicity, validation. Shared storage, so every id,
// slug and email here is prefixed `hd-`.
const db = drizzle(env.DB);
const now = new Date();
const IDS = ["hd-owner", "hd-owner2", "hd-admin", "hd-member"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@hd.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

// Only org owners and admins pass the domain's createTeam.
await db.insert(user).values({ id: "hd-org-admin", name: "HD-ORG-ADMIN", email: "hd-org-admin@hd.test", createdAt: now, updatedAt: now });
await db.insert(orgMember).values({ userId: "hd-org-admin", role: "admin", createdAt: now });

function ctxFor(userId: string) {
  return { db, actorUserId: userId, source: "web" as const };
}

/** A team with `hd-owner`, `hd-owner2` and `hd-admin` as admins, `hd-member` a member. */
async function freshTeam(slug: string) {
  const o = await createTeam(ctxFor("hd-owner"), { slug, name: slug });
  await db.insert(teamMember).values([
    { teamId: o.id, userId: "hd-owner2", role: "admin", createdAt: now },
    { teamId: o.id, userId: "hd-admin", role: "admin", createdAt: now },
    { teamId: o.id, userId: "hd-member", role: "member", createdAt: now },
  ]);
  return o;
}

async function freshProject(slug: string, key: string) {
  const o = await freshTeam(slug);
  const p = await createProject(ctxFor("hd-owner"), {
    teamId: o.id,
    slug: "web",
    name: "Web",
    key,
  });
  const [todo, doing] = await db
    .select()
    .from(status)
    .where(eq(status.projectId, p.id))
    .orderBy(asc(status.position));
  return { team: o, project: p, todo, doing };
}

/** Every promise settles; none may fail with anything but a DomainError. */
async function settleAsDomain(promises: Promise<unknown>[]) {
  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === "rejected") {
      expect(r.reason).toMatchObject({ name: "DomainError" });
    }
  }
  return results;
}

it("M3: a move after the 2nd of four concurrently-created tasks lands right after it", async () => {
  const { project: p, todo, doing } = await freshProject("hd-pos", "POS");
  await Promise.all(
    [1, 2, 3, 4].map((n) =>
      createTask(ctxFor("hd-owner"), {
        projectId: p.id,
        title: `T${n}`,
        statusId: todo.id,
      }),
    ),
  );
  const moving = await createTask(ctxFor("hd-owner"), {
    projectId: p.id,
    title: "Moving",
    statusId: doing.id,
  });

  const before = await listTasks(ctxFor("hd-owner"), {
    projectId: p.id,
    statusId: todo.id,
  });
  // The bug's precondition: every create read the same last key.
  expect(new Set(before.map((t) => t.position)).size).toBe(1);
  await moveTask(ctxFor("hd-owner"), {
    taskId: moving.id,
    statusId: todo.id,
    afterTaskId: before[1].id,
  });

  const after = await listTasks(ctxFor("hd-owner"), {
    projectId: p.id,
    statusId: todo.id,
  });
  expect(after.map((t) => t.id)).toEqual([
    before[0].id,
    before[1].id,
    moving.id,
    before[2].id,
    before[3].id,
  ]);
  expect(new Set(after.map((t) => t.position)).size).toBe(5);
});

it("P5: the last team admin can leave, and their assignments go with them", async () => {
  // Org owners and admins always cover a team, so there is no last-admin rule.
  const { team: o, project: p } = await freshProject("hd-last", "LST");
  await db.delete(teamMember).where(
    and(eq(teamMember.teamId, o.id), inArray(teamMember.userId, ["hd-owner2", "hd-admin"])),
  );
  const t = await createTask(ctxFor("hd-owner"), {
    projectId: p.id,
    title: "Mine",
    assigneeUserId: "hd-owner",
  });

  await removeTeamMember(ctxFor("hd-owner"), { teamId: o.id, userId: "hd-owner" });

  const [row] = await db.select().from(task).where(eq(task.id, t.id));
  expect(row.assigneeUserId).toBeNull();
  const admins = await db.select().from(teamMember)
    .where(and(eq(teamMember.teamId, o.id), eq(teamMember.role, "admin")));
  expect(admins).toEqual([]);
});

it("Minor 1: removeTeamMember logs each unassignment and bumps updatedAt", async () => {
  const { team: o, project: p } = await freshProject("hd-unassign", "UNA");
  await addProjectMember(ctxFor("hd-owner"), {
    projectId: p.id,
    userId: "hd-member",
  });
  const t = await createTask(ctxFor("hd-owner"), {
    projectId: p.id,
    title: "Theirs",
    assigneeUserId: "hd-member",
  });

  await removeTeamMember(ctxFor("hd-owner"), { teamId: o.id, userId: "hd-member" });

  const detail = await getTaskDetail(ctxFor("hd-owner"), { taskId: t.id });
  expect(detail.assignee).toBeNull();
  expect(detail.updatedAt.getTime()).toBeGreaterThanOrEqual(t.updatedAt.getTime());
  expect(detail.activity.at(-1)).toMatchObject({
    type: "task.updated",
    data: {
      fields: {
        assignee: { from: { id: "hd-member", displayName: "HD-MEMBER" }, to: null },
      },
    },
  });
});

it("Minor 1: deleteStatus logs task.moved for each moved task", async () => {
  const { project: p, todo, doing } = await freshProject("hd-delst", "DST");
  const t = await createTask(ctxFor("hd-owner"), {
    projectId: p.id,
    title: "Carried",
    statusId: doing.id,
  });

  await deleteStatus(ctxFor("hd-owner"), {
    statusId: doing.id,
    moveTasksToStatusId: todo.id,
  });

  const detail = await getTaskDetail(ctxFor("hd-owner"), { taskId: t.id });
  expect(detail.status.id).toBe(todo.id);
  expect(detail.activity.at(-1)).toMatchObject({
    type: "task.moved",
    data: {
      from: { id: doing.id, name: doing.name },
      to: { id: todo.id, name: todo.name },
    },
  });
});

it("M1 + Minor 8: teams have no owner role to grant, and admins change each other's invites", async () => {
  const o = await freshTeam("hd-invite");
  const owner = "owner" as "admin";
  await expect(
    inviteToTeam(ctxFor("hd-owner"), { teamId: o.id, email: "boss@hd.test", role: owner }),
  ).rejects.toThrow(/not a valid role/);
  await expect(
    changeTeamMemberRole(ctxFor("hd-owner"), { teamId: o.id, userId: "hd-member", role: owner }),
  ).rejects.toThrow(/not a valid role/);

  await inviteToTeam(ctxFor("hd-owner"), { teamId: o.id, email: "boss@hd.test", role: "admin" });
  await inviteToTeam(ctxFor("hd-admin"), { teamId: o.id, email: "boss@hd.test", role: "member" });
  const [row] = await db.select().from(teamInvite)
    .where(and(eq(teamInvite.teamId, o.id), eq(teamInvite.email, "boss@hd.test")));
  expect(row).toMatchObject({ role: "member", invitedByUserId: "hd-admin" });
});

it("Minor 4: the domain refuses roles and status colors outside the schema's enums", async () => {
  const { team: o, project: p, todo } = await freshProject("hd-enum", "ENM");
  const bogus = "superuser" as "member";
  await expect(
    inviteToTeam(ctxFor("hd-owner"), { teamId: o.id, email: "x@hd.test", role: bogus }),
  ).rejects.toThrow(/not a valid role/);
  await expect(
    changeTeamMemberRole(ctxFor("hd-owner"), {
      teamId: o.id,
      userId: "hd-member",
      role: bogus,
    }),
  ).rejects.toThrow(/not a valid role/);
  const badColor = "rainbow" as "gray";
  await expect(
    createStatus(ctxFor("hd-owner"), {
      projectId: p.id,
      name: "Waiting",
      color: badColor,
    }),
  ).rejects.toThrow(/status color/i);
  await expect(
    recolorStatus(ctxFor("hd-owner"), { statusId: todo.id, color: badColor }),
  ).rejects.toThrow(/status color/i);
});

it("Minor 7: racing creates surface as DomainErrors, never constraint failures", async () => {
  const [a, b] = await settleAsDomain([
    createTeamChecked(ctxFor("hd-org-admin"), { slug: "hd-dup", name: "A" }),
    createTeamChecked(ctxFor("hd-org-admin"), { slug: "hd-dup", name: "B" }),
  ]);
  expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);

  const { team: o, project: p, doing } = await freshProject("hd-dup-p", "DUP");
  await settleAsDomain([
    createProject(ctxFor("hd-owner"), { teamId: o.id, slug: "api2", name: "X", key: "XX" }),
    createProject(ctxFor("hd-owner"), { teamId: o.id, slug: "api2", name: "Y", key: "YY" }),
    createProject(ctxFor("hd-owner"), { teamId: o.id, slug: "api3", name: "Z", key: "XX" }),
  ]);
  await settleAsDomain([
    addProjectMember(ctxFor("hd-owner"), { projectId: p.id, userId: "hd-member" }),
    addProjectMember(ctxFor("hd-owner"), { projectId: p.id, userId: "hd-member" }),
  ]);
  await settleAsDomain([
    deleteStatus(ctxFor("hd-owner"), { statusId: doing.id }),
    createTask(ctxFor("hd-owner"), { projectId: p.id, title: "Late", statusId: doing.id }),
  ]);
});

it("Minor 15: length caps on names, titles, descriptions and comments", async () => {
  const { team: o, project: p } = await freshProject("hd-len", "LEN");
  const long = (n: number) => "x".repeat(n);
  await expect(
    createTeamChecked(ctxFor("hd-org-admin"), { slug: "hd-len2", name: long(81) }),
  ).rejects.toThrow(/at most 80/);
  await expect(
    createProject(ctxFor("hd-owner"), { teamId: o.id, slug: "p2", name: long(81), key: "PTW" }),
  ).rejects.toThrow(/at most 80/);
  await expect(
    createStatus(ctxFor("hd-owner"), { projectId: p.id, name: long(81) }),
  ).rejects.toThrow(/at most 80/);
  await expect(
    createTask(ctxFor("hd-owner"), { projectId: p.id, title: long(201) }),
  ).rejects.toThrow(/at most 200/);
  // Code points, not UTF-16 units: 200 emoji is a legal title.
  const t = await createTask(ctxFor("hd-owner"), { projectId: p.id, title: "🙂".repeat(200) });
  await expect(
    updateTask(ctxFor("hd-owner"), { taskId: t.id, description: long(10_001) }),
  ).rejects.toThrow(/at most 10000/);
  await expect(
    addComment(ctxFor("hd-owner"), { taskId: t.id, body: long(10_001) }),
  ).rejects.toThrow(/at most 10000/);
});

it("nits: email shape is checked, and an excerpt never splits a surrogate pair", async () => {
  const { team: o, project: p } = await freshProject("hd-nits", "NIT");
  await expect(
    inviteToTeam(ctxFor("hd-owner"), { teamId: o.id, email: "a@b", role: "member" }),
  ).rejects.toThrow(/valid email/);

  const t = await createTask(ctxFor("hd-owner"), { projectId: p.id, title: "E" });
  await addComment(ctxFor("hd-owner"), { taskId: t.id, body: "🙂".repeat(200) });
  const detail = await getTaskDetail(ctxFor("hd-owner"), { taskId: t.id });
  const entry = detail.activity.at(-1);
  if (entry?.type !== "comment.added") throw new Error("expected comment.added");
  expect(entry.data.excerpt).toBe(`${"🙂".repeat(139)}…`);
});

/**
 * `ctx.db`, except that `hook` runs once just before the first `batch` — a
 * concurrent write landing between a function's pre-checks and its batch,
 * deterministically.
 */
function landsBeforeBatch(hook: () => Promise<unknown>) {
  let fired = false;
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key === "batch" && !fired) {
        fired = true;
        return async (queries: Parameters<typeof db.batch>[0]) => {
          await hook();
          return target.batch(queries);
        };
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

function racedCtx(userId: string, hook: () => Promise<unknown>) {
  return { ...ctxFor(userId), db: landsBeforeBatch(hook) };
}

async function activityOfType(projectId: string, type: string) {
  return db
    .select()
    .from(activity)
    .where(and(eq(activity.projectId, projectId), eq(activity.type, type)));
}

it("MIN-1: reordering a status between two concurrently-created ones re-keys instead of throwing", async () => {
  const { project: p, todo } = await freshProject("hd-st-pos", "STP");
  await Promise.all(
    ["A", "B"].map((name) =>
      createStatus(ctxFor("hd-owner"), { projectId: p.id, name }),
    ),
  );
  const ordered = () =>
    db
      .select()
      .from(status)
      .where(eq(status.projectId, p.id))
      .orderBy(asc(status.position), asc(status.id));
  const before = await ordered();
  const [firstCreated, secondCreated] = before.slice(-2);
  // The precondition: both creates appended after the same last key.
  expect(firstCreated.position).toBe(secondCreated.position);

  await reorderStatus(ctxFor("hd-owner"), {
    statusId: todo.id,
    afterStatusId: firstCreated.id,
  });

  const after = await ordered();
  expect(after.map((s) => s.id)).toEqual([
    ...before.slice(1, -1).map((s) => s.id),
    todo.id,
    secondCreated.id,
  ]);
  expect(new Set(after.map((s) => s.position)).size).toBe(before.length);
});

it("MIN-2: an admin demoted after their check cannot remove a member", async () => {
  const o = await freshTeam("hd-promo-rm");
  const demote = () =>
    db
      .update(teamMember)
      .set({ role: "member" })
      .where(and(eq(teamMember.teamId, o.id), eq(teamMember.userId, "hd-admin")));

  await expect(
    removeTeamMember(racedCtx("hd-admin", demote), {
      teamId: o.id,
      userId: "hd-member",
    }),
  ).rejects.toMatchObject({ name: "AccessError", reason: "forbidden" });

  const [row] = await db
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.teamId, o.id), eq(teamMember.userId, "hd-member")));
  expect(row.role).toBe("member");
});

it("MIN-2: an admin demoted after their check cannot revoke an invite", async () => {
  const o = await freshTeam("hd-promo-rv");
  await inviteToTeam(ctxFor("hd-owner"), { teamId: o.id, email: "keep@hd.test", role: "member" });
  const demote = () => db.update(teamMember).set({ role: "member" })
    .where(and(eq(teamMember.teamId, o.id), eq(teamMember.userId, "hd-admin")));
  // `revokeTeamInvite` writes with one delete, not a batch, so land the demotion before it.
  let fired = false;
  const racedDb = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "delete" && !fired) {
        fired = true;
        return (table: Parameters<typeof db.delete>[0]) => {
          const query = target.delete(table);
          return new Proxy(query, {
            get(q, k, r) {
              if (k !== "then") return Reflect.get(q, k, r);
              return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => demote().then(() => q).then(resolve, reject);
            },
          });
        };
      }
      return Reflect.get(target, key, receiver);
    },
  });

  await expect(revokeTeamInvite({ ...ctxFor("hd-admin"), db: racedDb }, { teamId: o.id, email: "keep@hd.test" }))
    .rejects.toMatchObject({ name: "AccessError", reason: "forbidden" });
  const rows = await db.select().from(teamInvite).where(and(eq(teamInvite.teamId, o.id), eq(teamInvite.email, "keep@hd.test")));
  expect(rows).toHaveLength(1);
});

it("MIN-2: an admin demoted at the same moment cannot change a member's role", async () => {
  const o = await freshTeam("hd-promo-ch");
  // Demotion first, so its write lands between the admin's check and write.
  const [demoted, changed] = await Promise.allSettled([
    changeTeamMemberRole(ctxFor("hd-owner"), {
      teamId: o.id,
      userId: "hd-admin",
      role: "member",
    }),
    changeTeamMemberRole(ctxFor("hd-admin"), {
      teamId: o.id,
      userId: "hd-member",
      role: "admin",
    }),
  ]);
  expect(demoted.status).toBe("fulfilled");
  expect(changed).toMatchObject({
    status: "rejected",
    reason: { name: "AccessError", reason: "forbidden" },
  });
  const [row] = await db
    .select()
    .from(teamMember)
    .where(and(eq(teamMember.teamId, o.id), eq(teamMember.userId, "hd-member")));
  expect(row.role).toBe("member");
});

it("MIN-3: two parallel archives write one task.archived", async () => {
  const { project: p } = await freshProject("hd-arch", "ARC");
  const t = await createTask(ctxFor("hd-owner"), { projectId: p.id, title: "Old" });

  // Both resolve, as a sequential second archive does.
  await Promise.all([
    archiveTask(ctxFor("hd-owner"), { taskId: t.id }),
    archiveTask(ctxFor("hd-owner"), { taskId: t.id }),
  ]);

  expect(await activityOfType(p.id, "task.archived")).toHaveLength(1);
});

it("MIN-3: two parallel project-member removals write one member_removed; the loser gets a DomainError", async () => {
  const { project: p } = await freshProject("hd-pm-rm", "PMR");
  await addProjectMember(ctxFor("hd-owner"), { projectId: p.id, userId: "hd-member" });

  const results = await settleAsDomain([
    removeProjectMember(ctxFor("hd-owner"), { projectId: p.id, userId: "hd-member" }),
    removeProjectMember(ctxFor("hd-owner2"), { projectId: p.id, userId: "hd-member" }),
  ]);

  expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect(await activityOfType(p.id, "project.member_removed")).toHaveLength(1);
});

it("MIN-3: renaming a status deleted after the check logs nothing and says it is gone", async () => {
  const { project: p } = await freshProject("hd-st-gone", "SGN");
  const doomed = await createStatus(ctxFor("hd-owner"), {
    projectId: p.id,
    name: "Doomed",
  });

  await expect(
    renameStatus(
      racedCtx("hd-owner", () => db.delete(status).where(eq(status.id, doomed.id))),
      { statusId: doomed.id, name: "Renamed" },
    ),
  ).rejects.toThrow(/No such status/);
  expect(await activityOfType(p.id, "status.renamed")).toHaveLength(0);
});

it("MIN-4: bulk-written activity rows match writeActivity's id, payload and timestamp shapes", async () => {
  const { team: o, project: p, todo, doing } = await freshProject("hd-bulk", "BLK");
  await addProjectMember(ctxFor("hd-owner"), { projectId: p.id, userId: "hd-member" });
  const tasks = await Promise.all(
    ["X", "Y"].map((title) =>
      createTask(ctxFor("hd-owner"), {
        projectId: p.id,
        title,
        statusId: doing.id,
        assigneeUserId: "hd-member",
      }),
    ),
  );

  await removeTeamMember(ctxFor("hd-owner"), { teamId: o.id, userId: "hd-member" });
  await deleteStatus(ctxFor("hd-owner"), {
    statusId: doing.id,
    moveTasksToStatusId: todo.id,
  });

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const updated = await activityOfType(p.id, "task.updated");
  const moved = await activityOfType(p.id, "task.moved");
  expect(updated.map((a) => a.taskId).sort()).toEqual(tasks.map((t) => t.id).sort());
  expect(moved.map((a) => a.taskId).sort()).toEqual(tasks.map((t) => t.id).sort());
  for (const a of [...updated, ...moved]) {
    expect(a.id).toMatch(UUID_V4);
    expect(a.createdAt.getTime()).toBeGreaterThan(now.getTime());
    expect(a).toMatchObject({ actorUserId: "hd-owner", source: "web", clientId: null });
  }
  // Byte-for-byte what JSON.stringify would have written.
  expect(updated[0].data).toBe(
    JSON.stringify({
      fields: {
        assignee: { from: { id: "hd-member", displayName: "HD-MEMBER" }, to: null },
      },
    }),
  );
  expect(moved[0].data).toBe(
    JSON.stringify({
      from: { id: doing.id, name: doing.name },
      to: { id: todo.id, name: todo.name },
    }),
  );
  expect(new Set([...updated, ...moved].map((a) => a.id)).size).toBe(4);
});

it("NIT-1: deleting an empty status records movedTo as null even when a target was named", async () => {
  const { project: p, todo } = await freshProject("hd-del-empty", "DEM");
  const empty = await createStatus(ctxFor("hd-owner"), {
    projectId: p.id,
    name: "Empty",
  });
  await deleteStatus(ctxFor("hd-owner"), {
    statusId: empty.id,
    moveTasksToStatusId: todo.id,
  });
  const [row] = await activityOfType(p.id, "status.deleted");
  expect(JSON.parse(row.data)).toEqual({ id: empty.id, name: "Empty", movedTo: null });
});

it("NIT-2: a move target deleted after the check is reported as gone, not as tasks remaining", async () => {
  const { project: p, doing } = await freshProject("hd-del-tgt", "DTG");
  await createTask(ctxFor("hd-owner"), { projectId: p.id, title: "T", statusId: doing.id });
  const target = await createStatus(ctxFor("hd-owner"), {
    projectId: p.id,
    name: "Target",
  });

  await expect(
    deleteStatus(
      racedCtx("hd-owner", () => db.delete(status).where(eq(status.id, target.id))),
      { statusId: doing.id, moveTasksToStatusId: target.id },
    ),
  ).rejects.toThrow(/"Target" no longer exists/);
});

it("NIT-3: the move action 404s a task from another project than the URL's", async () => {
  actor.id = "hd-owner";
  const { team: o, project: p } = await freshProject("hd-mv-x", "MVX");
  const other = await createProject(ctxFor("hd-owner"), {
    teamId: o.id,
    slug: "other",
    name: "Other",
    key: "OTH",
  });
  const t = await createTask(ctxFor("hd-owner"), { projectId: other.id, title: "Elsewhere" });

  await expect(
    moveTaskAction({
      teamSlug: o.slug,
      projectSlug: p.slug,
      taskId: t.id,
      statusId: t.status.id,
      afterTaskId: null,
    }),
  ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
});

it("NIT-5: changing the role of someone removed at the same moment says they are not a member", async () => {
  const o = await freshTeam("hd-gone-ch");
  // Removal first, so the row is gone by the time the role update runs.
  const [, changed] = await Promise.allSettled([
    removeTeamMember(ctxFor("hd-owner"), { teamId: o.id, userId: "hd-owner2" }),
    changeTeamMemberRole(ctxFor("hd-owner"), {
      teamId: o.id,
      userId: "hd-owner2",
      role: "member",
    }),
  ]);
  expect(changed).toMatchObject({
    status: "rejected",
    reason: { message: expect.stringMatching(/not a member/) },
  });
});
