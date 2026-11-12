import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  addProjectMember,
  createOrg,
  createProject,
  createStatus,
  deleteStatus,
  recolorStatus,
  removeProjectMember,
  renameStatus,
  reorderStatus,
} from "@tasks/core/domain";
import {
  activity,
  orgMember,
  projectMember,
  status,
  task,
  user,
} from "@tasks/core/schema";

const db = drizzle(env.DB);
const now = new Date();

// Shared storage, so every id here is prefixed `pj-`.
const IDS = ["pj-owner", "pj-member", "pj-outsider"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@project.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

function ctxFor(userId: string) {
  return { db, actorUserId: userId, source: "web" as const };
}

/** A fresh org with `pj-owner` as owner and `pj-member` as a plain member. */
async function freshOrg(slug: string) {
  const o = await createOrg(ctxFor("pj-owner"), { slug, name: slug });
  await db.insert(orgMember).values({
    orgId: o.id,
    userId: "pj-member",
    role: "member",
    createdAt: now,
  });
  return o;
}

function statusesOf(projectId: string) {
  return db
    .select()
    .from(status)
    .where(eq(status.projectId, projectId))
    .orderBy(asc(status.position), asc(status.id));
}

function activityOf(projectId: string) {
  return db
    .select()
    .from(activity)
    .where(eq(activity.projectId, projectId))
    .orderBy(asc(activity.createdAt), asc(activity.id));
}

it("createProject seeds four named, colored statuses in order and adds the creator", async () => {
  const o = await freshOrg("pj-seed");
  const p = await createProject(ctxFor("pj-owner"), {
    orgId: o.id,
    slug: "web",
    name: "Web",
    key: "WEB",
  });

  const statuses = await statusesOf(p.id);
  expect(
    statuses.map((s) => [s.name, s.color]),
  ).toEqual([
    ["Todo", "gray"],
    ["In Progress", "blue"],
    ["Done", "green"],
    ["Blocked", "red"],
  ]);
  // Fractional indices, so a later insert fits between without a renumber.
  expect(new Set(statuses.map((s) => s.position)).size).toBe(4);

  expect(
    await db
      .select()
      .from(projectMember)
      .where(eq(projectMember.projectId, p.id)),
  ).toMatchObject([{ orgId: o.id, userId: "pj-owner" }]);

  const rows = await activityOf(p.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    type: "project.created",
    taskId: null,
    actorUserId: "pj-owner",
    source: "web",
  });
  expect(JSON.parse(rows[0].data)).toEqual({ name: "Web", key: "WEB" });
});

it("createProject refuses a plain member, a duplicate slug, a duplicate key and a bad key", async () => {
  const o = await freshOrg("pj-dup");
  await createProject(ctxFor("pj-owner"), {
    orgId: o.id,
    slug: "web",
    name: "Web",
    key: "WEB",
  });

  await expect(
    createProject(ctxFor("pj-member"), {
      orgId: o.id,
      slug: "other",
      name: "O",
      key: "OTH",
    }),
  ).rejects.toMatchObject({ name: "AccessError", reason: "forbidden" });

  await expect(
    createProject(ctxFor("pj-owner"), {
      orgId: o.id,
      slug: "web",
      name: "W2",
      key: "WB2",
    }),
  ).rejects.toThrowError(/slug "web" already exists/);

  await expect(
    createProject(ctxFor("pj-owner"), {
      orgId: o.id,
      slug: "web2",
      name: "W2",
      key: "WEB",
    }),
  ).rejects.toThrowError(/key "WEB" already exists/);

  for (const key of ["web", "W", "TOOLONGKEY", "1AB"]) {
    await expect(
      createProject(ctxFor("pj-owner"), {
        orgId: o.id,
        slug: "web3",
        name: "W3",
        key,
      }),
    ).rejects.toThrowError(/Project key/);
  }

  await expect(
    createProject(ctxFor("pj-owner"), {
      orgId: o.id,
      slug: "settings",
      name: "S",
      key: "SET",
    }),
  ).rejects.toThrowError(/reserved/);
});

it("project membership requires org membership, and logs both events", async () => {
  const o = await freshOrg("pj-members");
  const p = await createProject(ctxFor("pj-owner"), {
    orgId: o.id,
    slug: "web",
    name: "Web",
    key: "WEB",
  });

  await expect(
    addProjectMember(ctxFor("pj-owner"), {
      projectId: p.id,
      userId: "pj-outsider",
    }),
  ).rejects.toThrowError(/member of the organization first/);

  await addProjectMember(ctxFor("pj-owner"), {
    projectId: p.id,
    userId: "pj-member",
  });
  await expect(
    addProjectMember(ctxFor("pj-owner"), {
      projectId: p.id,
      userId: "pj-member",
    }),
  ).rejects.toThrowError(/already a member/);

  await removeProjectMember(ctxFor("pj-owner"), {
    projectId: p.id,
    userId: "pj-member",
  });

  const rows = await activityOf(p.id);
  expect(rows.map((r) => r.type)).toEqual([
    "project.created",
    "project.member_added",
    "project.member_removed",
  ]);
  // §3: users are `{userId, displayName}` in project.member_* payloads.
  expect(JSON.parse(rows[1].data)).toEqual({
    userId: "pj-member",
    displayName: "PJ-MEMBER",
  });
  expect(JSON.parse(rows[2].data)).toEqual({
    userId: "pj-member",
    displayName: "PJ-MEMBER",
  });
});

it("status create / rename / reorder write §3's payloads", async () => {
  const o = await freshOrg("pj-status");
  const p = await createProject(ctxFor("pj-owner"), {
    orgId: o.id,
    slug: "web",
    name: "Web",
    key: "WEB",
  });
  const seeded = await statusesOf(p.id);

  const review = await createStatus(ctxFor("pj-owner"), {
    projectId: p.id,
    name: "Review",
    color: "blue",
  });
  expect((await statusesOf(p.id)).map((s) => s.name)).toEqual([
    "Todo",
    "In Progress",
    "Done",
    "Blocked",
    "Review",
  ]);

  await expect(
    createStatus(ctxFor("pj-owner"), {
      projectId: p.id,
      name: "Todo",
    }),
  ).rejects.toThrowError(/already has a status called/);

  await renameStatus(ctxFor("pj-owner"), {
    statusId: review.id,
    name: "In Review",
  });
  // Move it to sit directly after "Todo".
  await reorderStatus(ctxFor("pj-owner"), {
    statusId: review.id,
    afterStatusId: seeded[0].id,
  });

  expect((await statusesOf(p.id)).map((s) => s.name)).toEqual([
    "Todo",
    "In Review",
    "In Progress",
    "Done",
    "Blocked",
  ]);

  const rows = (await activityOf(p.id)).slice(1);
  expect(rows.map((r) => r.type)).toEqual([
    "status.created",
    "status.renamed",
    "status.reordered",
  ]);
  expect(rows.map((r) => r.taskId)).toEqual([null, null, null]);
  expect(JSON.parse(rows[0].data)).toEqual({
    id: review.id,
    name: "Review",
    color: "blue",
  });
  expect(JSON.parse(rows[1].data)).toEqual({
    id: review.id,
    from: "Review",
    to: "In Review",
  });
  expect(JSON.parse(rows[2].data)).toEqual({
    id: review.id,
    name: "In Review",
  });
});

it("recolors a status without changing its other properties and records the change", async () => {
  const o = await freshOrg("pj-recolor");
  const p = await createProject(ctxFor("pj-owner"), {
    orgId: o.id,
    slug: "web",
    name: "Web",
    key: "WEB",
  });
  const [todo] = await statusesOf(p.id);

  await recolorStatus(ctxFor("pj-owner"), { statusId: todo.id, color: "red" });
  expect((await statusesOf(p.id))[0]).toEqual({ ...todo, color: "red" });

  const events = (await activityOf(p.id)).filter((row) => row.type === "status.recolored");
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    taskId: null,
    actorUserId: "pj-owner",
    source: "web",
  });
  expect(JSON.parse(events[0].data)).toEqual({
    id: todo.id,
    name: "Todo",
    from: "gray",
    to: "red",
  });
});

it("deleteStatus is blocked while tasks reference it, and moves them when given a target", async () => {
  const o = await freshOrg("pj-delete");
  const p = await createProject(ctxFor("pj-owner"), {
    orgId: o.id,
    slug: "web",
    name: "Web",
    key: "WEB",
  });
  const [todo, doing, done] = await statusesOf(p.id);

  await db.insert(task).values(
    [1, 2].map((n) => ({
      id: `pj-del-t${n}`,
      projectId: p.id,
      number: n,
      title: `T${n}`,
      statusId: todo.id,
      position: `a${n}`,
      createdByUserId: "pj-owner",
      createdAt: now,
      updatedAt: now,
    })),
  );

  await expect(
    deleteStatus(ctxFor("pj-owner"), { statusId: todo.id }),
  ).rejects.toThrowError(/still holds 2 task\(s\)/);
  // Never a cascade: the tasks are untouched.
  expect(
    await db.select().from(task).where(eq(task.statusId, todo.id)),
  ).toHaveLength(2);

  await deleteStatus(ctxFor("pj-owner"), {
    statusId: todo.id,
    moveTasksToStatusId: doing.id,
  });

  expect((await statusesOf(p.id)).map((s) => s.name)).toEqual([
    "In Progress",
    "Done",
    "Blocked",
  ]);
  expect(
    (await db.select().from(task).where(eq(task.projectId, p.id))).map(
      (t) => t.statusId,
    ),
  ).toEqual([doing.id, doing.id]);

  // An empty status needs no target, and logs movedTo: null.
  await deleteStatus(ctxFor("pj-owner"), { statusId: done.id });

  const rows = (await activityOf(p.id)).filter(
    (r) => r.type === "status.deleted",
  );
  expect(JSON.parse(rows[0].data)).toEqual({
    id: todo.id,
    name: "Todo",
    movedTo: { id: doing.id, name: "In Progress" },
  });
  expect(JSON.parse(rows[1].data)).toEqual({
    id: done.id,
    name: "Done",
    movedTo: null,
  });
});

it("status management needs the capability, not just project access", async () => {
  const o = await freshOrg("pj-cap");
  const p = await createProject(ctxFor("pj-owner"), {
    orgId: o.id,
    slug: "web",
    name: "Web",
    key: "WEB",
  });
  const [todo] = await statusesOf(p.id);
  await addProjectMember(ctxFor("pj-owner"), {
    projectId: p.id,
    userId: "pj-member",
  });

  await expect(
    createStatus(ctxFor("pj-member"), {
      projectId: p.id,
      name: "Review",
    }),
  ).rejects.toMatchObject({ name: "AccessError", reason: "forbidden" });
  await expect(
    recolorStatus(ctxFor("pj-member"), { statusId: todo.id, color: "red" }),
  ).rejects.toMatchObject({ name: "AccessError", reason: "forbidden" });

  // And an outsider cannot even see the project.
  await expect(
    createStatus(ctxFor("pj-outsider"), {
      projectId: p.id,
      name: "Review",
    }),
  ).rejects.toMatchObject({ reason: "not_a_member" });
  await expect(
    recolorStatus(ctxFor("pj-outsider"), { statusId: todo.id, color: "red" }),
  ).rejects.toMatchObject({ reason: "not_a_member" });
});
