import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  org,
  orgMember,
  project,
  projectMember,
  status,
  task,
  user,
} from "@tasks/core/schema";

const db = drizzle(env.DB);
const now = new Date();

// Every user-referencing column now has a FK to `user`, so the users these
// tests cite have to exist. Seeded once for the file.
await db.insert(user).values(
  ["u1", "u2", "u3"].map((id) => ({
    id,
    name: id,
    email: `${id}@schema.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

// Storage is shared across tests in this pool, so each test uses its own org.
async function seedOrg(id: string) {
  await db.insert(org).values({ id, slug: id, name: id, createdAt: now });
}

async function seedProject(id: string, orgId: string) {
  await db.insert(project).values({
    id,
    orgId,
    slug: id,
    name: id,
    key: id.toUpperCase(),
    createdAt: now,
  });
}

async function seedStatus(id: string, projectId: string) {
  await db.insert(status).values({
    id,
    projectId,
    name: "Todo",
    color: "gray",
    position: "a0",
    createdAt: now,
  });
}

// Drizzle wraps the D1 failure, so the SQLite reason lives on the cause chain.
async function rejectionReason(promise: Promise<unknown>) {
  try {
    await promise;
    return "no error thrown";
  } catch (error) {
    const messages: string[] = [];
    for (let e = error as Error | undefined; e; e = e.cause as Error | undefined) {
      messages.push(e.message);
    }
    return messages.join(" | ");
  }
}

it("accepts an org and a member, and rejects a duplicate (orgId, userId)", async () => {
  await seedOrg("o-member");
  await db
    .insert(orgMember)
    .values({ orgId: "o-member", userId: "u1", role: "owner", createdAt: now });

  expect(
    await db.select().from(orgMember).where(eq(orgMember.orgId, "o-member")),
  ).toHaveLength(1);

  expect(
    await rejectionReason(
      db.insert(orgMember).values({
        orgId: "o-member",
        userId: "u1",
        role: "member",
        createdAt: now,
      }),
    ),
  ).toMatch(/UNIQUE constraint failed: org_member.org_id, org_member.user_id/);
});

it("accepts every org_member role and the four default status colors", async () => {
  await seedOrg("o-enums");
  await db.insert(orgMember).values([
    { orgId: "o-enums", userId: "u1", role: "owner", createdAt: now },
    { orgId: "o-enums", userId: "u2", role: "admin", createdAt: now },
    { orgId: "o-enums", userId: "u3", role: "member", createdAt: now },
  ]);
  await seedProject("p-enums", "o-enums");
  await db.insert(status).values([
    { id: "s1", projectId: "p-enums", name: "Todo", color: "gray", position: "a0", createdAt: now },
    { id: "s2", projectId: "p-enums", name: "Doing", color: "blue", position: "a1", createdAt: now },
    { id: "s3", projectId: "p-enums", name: "Done", color: "green", position: "a2", createdAt: now },
    { id: "s4", projectId: "p-enums", name: "Blocked", color: "red", position: "a3", createdAt: now },
  ]);

  const members = await db
    .select()
    .from(orgMember)
    .where(eq(orgMember.orgId, "o-enums"));
  expect(members.map((m) => m.role).sort()).toEqual([
    "admin",
    "member",
    "owner",
  ]);

  const statuses = await db
    .select()
    .from(status)
    .where(eq(status.projectId, "p-enums"));
  expect(statuses.map((s) => s.color).sort()).toEqual([
    "blue",
    "gray",
    "green",
    "red",
  ]);
});

it("rejects a project_member whose (orgId, userId) is not an org_member", async () => {
  // D1 pins foreign key enforcement on; `PRAGMA foreign_keys = ...` is a no-op.
  expect((await env.DB.prepare("PRAGMA foreign_keys").all()).results).toEqual([
    { foreign_keys: 1 },
  ]);

  await seedOrg("o-fk");
  await seedProject("p-fk", "o-fk");
  await db
    .insert(orgMember)
    .values({ orgId: "o-fk", userId: "u1", role: "owner", createdAt: now });

  await db
    .insert(projectMember)
    .values({ orgId: "o-fk", projectId: "p-fk", userId: "u1" });

  expect(
    await rejectionReason(
      db
        .insert(projectMember)
        .values({ orgId: "o-fk", projectId: "p-fk", userId: "stranger" }),
    ),
  ).toMatch(/FOREIGN KEY constraint failed/);
});

it("rejects a duplicate task number in a project but allows it in another", async () => {
  await seedOrg("o-task");
  await seedProject("p-task-a", "o-task");
  await seedProject("p-task-b", "o-task");
  await seedStatus("s-task-a", "p-task-a");
  await seedStatus("s-task-b", "p-task-b");

  const base = {
    title: "t",
    position: "a0",
    createdByUserId: "u1",
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(task).values({
    ...base,
    id: "t1",
    projectId: "p-task-a",
    number: 1,
    statusId: "s-task-a",
  });

  expect(
    await rejectionReason(
      db.insert(task).values({
        ...base,
        id: "t2",
        projectId: "p-task-a",
        number: 1,
        statusId: "s-task-a",
      }),
    ),
  ).toMatch(/UNIQUE constraint failed: task.project_id, task.number/);

  await db.insert(task).values({
    ...base,
    id: "t3",
    projectId: "p-task-b",
    number: 1,
    statusId: "s-task-b",
  });

  // Scoped to this test's projects: storage is shared, so an unscoped select
  // would break as soon as any other test inserts a task.
  expect(
    (
      await db
        .select()
        .from(task)
        .where(inArray(task.projectId, ["p-task-a", "p-task-b"]))
    )
      .map((t) => t.id)
      .sort(),
  ).toEqual(["t1", "t3"]);
});

it("rejects an org_member whose userId is not a user", async () => {
  await seedOrg("o-user-fk");

  expect(
    await rejectionReason(
      db.insert(orgMember).values({
        orgId: "o-user-fk",
        userId: "ghost",
        role: "member",
        createdAt: now,
      }),
    ),
  ).toMatch(/FOREIGN KEY constraint failed/);
});
