import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  team,
  teamMember,
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

// Storage is shared across tests in this pool, so each test uses its own team.
async function seedTeam(id: string) {
  await db.insert(team).values({ id, slug: id, name: id, createdAt: now });
}

async function seedProject(id: string, teamId: string) {
  await db.insert(project).values({
    id,
    teamId,
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

it("accepts a team and a member, and rejects a duplicate (teamId, userId)", async () => {
  await seedTeam("o-member");
  await db
    .insert(teamMember)
    .values({ teamId: "o-member", userId: "u1", role: "owner", createdAt: now });

  expect(
    await db.select().from(teamMember).where(eq(teamMember.teamId, "o-member")),
  ).toHaveLength(1);

  expect(
    await rejectionReason(
      db.insert(teamMember).values({
        teamId: "o-member",
        userId: "u1",
        role: "member",
        createdAt: now,
      }),
    ),
  ).toMatch(/UNIQUE constraint failed: team_member.team_id, team_member.user_id/);
});

it("accepts every team_member role and the four default status colors", async () => {
  await seedTeam("o-enums");
  await db.insert(teamMember).values([
    { teamId: "o-enums", userId: "u1", role: "owner", createdAt: now },
    { teamId: "o-enums", userId: "u2", role: "admin", createdAt: now },
    { teamId: "o-enums", userId: "u3", role: "member", createdAt: now },
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
    .from(teamMember)
    .where(eq(teamMember.teamId, "o-enums"));
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

it("rejects a project_member whose (teamId, userId) is not a team_member", async () => {
  // D1 pins foreign key enforcement on; `PRAGMA foreign_keys = ...` is a no-op.
  expect((await env.DB.prepare("PRAGMA foreign_keys").all()).results).toEqual([
    { foreign_keys: 1 },
  ]);

  await seedTeam("o-fk");
  await seedProject("p-fk", "o-fk");
  await db
    .insert(teamMember)
    .values({ teamId: "o-fk", userId: "u1", role: "owner", createdAt: now });

  await db
    .insert(projectMember)
    .values({ teamId: "o-fk", projectId: "p-fk", userId: "u1" });

  expect(
    await rejectionReason(
      db
        .insert(projectMember)
        .values({ teamId: "o-fk", projectId: "p-fk", userId: "stranger" }),
    ),
  ).toMatch(/FOREIGN KEY constraint failed/);
});

it("rejects a duplicate task number in a project but allows it in another", async () => {
  await seedTeam("o-task");
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

it("rejects a team_member whose userId is not a user", async () => {
  await seedTeam("o-user-fk");

  expect(
    await rejectionReason(
      db.insert(teamMember).values({
        teamId: "o-user-fk",
        userId: "ghost",
        role: "member",
        createdAt: now,
      }),
    ),
  ).toMatch(/FOREIGN KEY constraint failed/);
});
