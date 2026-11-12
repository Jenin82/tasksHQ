import { env } from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import {
  addComment,
  addProjectMember,
  archiveTask,
  changeOrgMemberRole,
  createOrg,
  createProject,
  createStatus,
  createTask,
  deleteStatus,
  getTaskDetail,
  inviteToOrg,
  listTasks,
  moveTask,
  recolorStatus,
  removeOrgMember,
  removeProjectMember,
  renameStatus,
  reorderStatus,
  updateTask,
} from "@tasks/core/domain";
import {
  activity,
  orgInvite,
  orgMember,
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
const { moveTaskAction } = await import("@/app/[org]/[project]/actions");

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

function ctxFor(userId: string) {
  return { db, actorUserId: userId, source: "web" as const };
}

/** An org owned by `hd-owner` and `hd-owner2`, `hd-admin` an admin, `hd-member` a member. */
async function freshOrg(slug: string) {
  const o = await createOrg(ctxFor("hd-owner"), { slug, name: slug });
  await db.insert(orgMember).values([
    { orgId: o.id, userId: "hd-owner2", role: "owner", createdAt: now },
    { orgId: o.id, userId: "hd-admin", role: "admin", createdAt: now },
    { orgId: o.id, userId: "hd-member", role: "member", createdAt: now },
  ]);
  return o;
}

async function freshProject(slug: string, key: string) {
  const o = await freshOrg(slug);
  const p = await createProject(ctxFor("hd-owner"), {
    orgId: o.id,
    slug: "web",
    name: "Web",
    key,
  });
  const [todo, doing] = await db
    .select()
    .from(status)
    .where(eq(status.projectId, p.id))
    .orderBy(asc(status.position));
  return { org: o, project: p, todo, doing };
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

it("M4: two owners removing each other in parallel leaves an owner", async () => {
  const o = await freshOrg("hd-race-rm");
  const results = await settleAsDomain([
    removeOrgMember(ctxFor("hd-owner"), { orgId: o.id, userId: "hd-owner2" }),
    removeOrgMember(ctxFor("hd-owner2"), { orgId: o.id, userId: "hd-owner" }),
  ]);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const owners = await db
    .select()
    .from(orgMember)
    .where(and(eq(orgMember.orgId, o.id), eq(orgMember.role, "owner")));
  expect(owners).toHaveLength(1);
});

it("M4: two owners demoting each other in parallel leaves an owner", async () => {
  const o = await freshOrg("hd-race-dm");
  await settleAsDomain([
    changeOrgMemberRole(ctxFor("hd-owner"), {
      orgId: o.id,
      userId: "hd-owner2",
      role: "member",
    }),
    changeOrgMemberRole(ctxFor("hd-owner2"), {
      orgId: o.id,
      userId: "hd-owner",
      role: "member",
    }),
  ]);
  const owners = await db
    .select()
    .from(orgMember)
    .where(and(eq(orgMember.orgId, o.id), eq(orgMember.role, "owner")));
  expect(owners).toHaveLength(1);
});

it("M4/M5: refusing to remove the last owner rolls back the unassignment too", async () => {
  const { org: o, project: p } = await freshProject("hd-last", "LST");
  await db.delete(orgMember).where(
    and(eq(orgMember.orgId, o.id), eq(orgMember.userId, "hd-owner2")),
  );
  const t = await createTask(ctxFor("hd-owner"), {
    projectId: p.id,
    title: "Mine",
    assigneeUserId: "hd-owner",
  });

  await expect(
    removeOrgMember(ctxFor("hd-owner"), { orgId: o.id, userId: "hd-owner" }),
  ).rejects.toThrow(/last owner cannot be removed/);

  const [row] = await db.select().from(task).where(eq(task.id, t.id));
  expect(row.assigneeUserId).toBe("hd-owner");
  const log = await db.select().from(activity).where(eq(activity.taskId, t.id));
  expect(log.map((a) => a.type)).toEqual(["task.created"]);
});

it("Minor 1: removeOrgMember logs each unassignment and bumps updatedAt", async () => {
  const { org: o, project: p } = await freshProject("hd-unassign", "UNA");
  await addProjectMember(ctxFor("hd-owner"), {
    projectId: p.id,
    userId: "hd-member",
  });
  const t = await createTask(ctxFor("hd-owner"), {
    projectId: p.id,
    title: "Theirs",
    assigneeUserId: "hd-member",
  });

  await removeOrgMember(ctxFor("hd-owner"), { orgId: o.id, userId: "hd-member" });

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

it("M1 + Minor 8: an admin cannot grant owner or overwrite a pending owner invite", async () => {
  const o = await freshOrg("hd-invite");
  await inviteToOrg(ctxFor("hd-owner"), {
    orgId: o.id,
    email: "boss@hd.test",
    role: "owner",
  });
  await expect(
    inviteToOrg(ctxFor("hd-admin"), {
      orgId: o.id,
      email: "boss@hd.test",
      role: "member",
    }),
  ).rejects.toThrow(/pending owner invite/);
  await expect(
    changeOrgMemberRole(ctxFor("hd-admin"), {
      orgId: o.id,
      userId: "hd-member",
      role: "owner",
    }),
  ).rejects.toMatchObject({ name: "DomainError" });
});

it("Minor 4: the domain refuses roles and status colors outside the schema's enums", async () => {
  const { org: o, project: p, todo } = await freshProject("hd-enum", "ENM");
  const bogus = "superuser" as "member";
  await expect(
    inviteToOrg(ctxFor("hd-owner"), { orgId: o.id, email: "x@hd.test", role: bogus }),
  ).rejects.toThrow(/not a valid role/);
  await expect(
    changeOrgMemberRole(ctxFor("hd-owner"), {
      orgId: o.id,
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
    createOrg(ctxFor("hd-owner"), { slug: "hd-dup", name: "A" }),
    createOrg(ctxFor("hd-owner"), { slug: "hd-dup", name: "B" }),
  ]);
  expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);

  const { org: o, project: p, doing } = await freshProject("hd-dup-p", "DUP");
  await settleAsDomain([
    createProject(ctxFor("hd-owner"), { orgId: o.id, slug: "api2", name: "X", key: "XX" }),
    createProject(ctxFor("hd-owner"), { orgId: o.id, slug: "api2", name: "Y", key: "YY" }),
    createProject(ctxFor("hd-owner"), { orgId: o.id, slug: "api3", name: "Z", key: "XX" }),
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
  const { org: o, project: p } = await freshProject("hd-len", "LEN");
  const long = (n: number) => "x".repeat(n);
  await expect(
    createOrg(ctxFor("hd-owner"), { slug: "hd-len2", name: long(81) }),
  ).rejects.toThrow(/at most 80/);
  await expect(
    createProject(ctxFor("hd-owner"), { orgId: o.id, slug: "p2", name: long(81), key: "PTW" }),
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
  const { org: o, project: p } = await freshProject("hd-nits", "NIT");
  await expect(
    inviteToOrg(ctxFor("hd-owner"), { orgId: o.id, email: "a@b", role: "member" }),
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

it("MIN-2: an admin cannot remove someone an owner promoted after the admin's check", async () => {
  const o = await freshOrg("hd-promo-rm");
  const promote = () =>
    db
      .update(orgMember)
      .set({ role: "owner" })
      .where(and(eq(orgMember.orgId, o.id), eq(orgMember.userId, "hd-member")));

  await expect(
    removeOrgMember(racedCtx("hd-admin", promote), {
      orgId: o.id,
      userId: "hd-member",
    }),
  ).rejects.toMatchObject({ name: "AccessError", reason: "forbidden" });

  const [row] = await db
    .select()
    .from(orgMember)
    .where(and(eq(orgMember.orgId, o.id), eq(orgMember.userId, "hd-member")));
  expect(row.role).toBe("owner");
});

it("MIN-2: an admin cannot change the role of someone an owner is promoting at the same moment", async () => {
  const o = await freshOrg("hd-promo-ch");
  // Promotion first, so its write lands between the admin's check and write.
  const [promoted, changed] = await Promise.allSettled([
    changeOrgMemberRole(ctxFor("hd-owner"), {
      orgId: o.id,
      userId: "hd-member",
      role: "owner",
    }),
    changeOrgMemberRole(ctxFor("hd-admin"), {
      orgId: o.id,
      userId: "hd-member",
      role: "admin",
    }),
  ]);
  expect(promoted.status).toBe("fulfilled");
  expect(changed).toMatchObject({
    status: "rejected",
    reason: { name: "AccessError", reason: "forbidden" },
  });
  const [row] = await db
    .select()
    .from(orgMember)
    .where(and(eq(orgMember.orgId, o.id), eq(orgMember.userId, "hd-member")));
  expect(row.role).toBe("owner");
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
  const { org: o, project: p, todo, doing } = await freshProject("hd-bulk", "BLK");
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

  await removeOrgMember(ctxFor("hd-owner"), { orgId: o.id, userId: "hd-member" });
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
  const { org: o, project: p } = await freshProject("hd-mv-x", "MVX");
  const other = await createProject(ctxFor("hd-owner"), {
    orgId: o.id,
    slug: "other",
    name: "Other",
    key: "OTH",
  });
  const t = await createTask(ctxFor("hd-owner"), { projectId: other.id, title: "Elsewhere" });

  await expect(
    moveTaskAction({
      orgSlug: o.slug,
      projectSlug: p.slug,
      taskId: t.id,
      statusId: t.status.id,
      afterTaskId: null,
    }),
  ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
});

it("NIT-4: an admin re-invite racing an owner's owner invite cannot downgrade it", async () => {
  const o = await freshOrg("hd-inv-race");
  // The owner's invite first, so it lands between the admin's checks and upsert.
  const [, admin] = await Promise.allSettled([
    inviteToOrg(ctxFor("hd-owner"), { orgId: o.id, email: "race@hd.test", role: "owner" }),
    inviteToOrg(ctxFor("hd-admin"), { orgId: o.id, email: "race@hd.test", role: "member" }),
  ]);
  expect(admin).toMatchObject({ status: "rejected", reason: { name: "DomainError" } });
  const [row] = await db
    .select()
    .from(orgInvite)
    .where(and(eq(orgInvite.orgId, o.id), eq(orgInvite.email, "race@hd.test")));
  expect(row.role).toBe("owner");

  // An accepted owner invite is not protected: re-inviting a removed former
  // owner is the ordinary re-invite.
  await db
    .update(orgInvite)
    .set({ acceptedAt: now })
    .where(and(eq(orgInvite.orgId, o.id), eq(orgInvite.email, "race@hd.test")));
  await inviteToOrg(ctxFor("hd-admin"), {
    orgId: o.id,
    email: "race@hd.test",
    role: "member",
  });
});

it("NIT-5: changing the role of someone removed at the same moment says they are not a member", async () => {
  const o = await freshOrg("hd-gone-ch");
  // Removal first, so the row is gone by the time the role update runs.
  // An owner target: the old fallback read the stale role and blamed the
  // last-owner rule.
  const [, changed] = await Promise.allSettled([
    removeOrgMember(ctxFor("hd-owner"), { orgId: o.id, userId: "hd-owner2" }),
    changeOrgMemberRole(ctxFor("hd-owner"), {
      orgId: o.id,
      userId: "hd-owner2",
      role: "admin",
    }),
  ]);
  expect(changed).toMatchObject({
    status: "rejected",
    reason: { message: expect.stringMatching(/not a member/) },
  });
});
