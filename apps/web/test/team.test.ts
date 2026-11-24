import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { RESERVED_SLUGS } from "@tasks/core/slug";
import {
  changeTeamMemberRole,
  createTeam,
  inviteToTeam,
  removeTeamMember,
} from "@tasks/core/domain";
import {
  orgMember,
  team,
  teamInvite,
  teamMember,
  project,
  projectMember,
  status,
  task,
  user,
} from "@tasks/core/schema";

const db = drizzle(env.DB);
const now = new Date();

// Shared storage, so every id and email here is prefixed `og-`.
const IDS = ["og-a", "og-b", "og-c", "og-d"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@team.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

// The domain's createTeam needs an org owner or admin.
await db.insert(orgMember).values({ userId: "og-a", role: "admin", createdAt: now });

function ctxFor(userId: string) {
  return { db, actorUserId: userId, source: "web" as const };
}

async function membersOf(teamId: string) {
  return db.select().from(teamMember).where(eq(teamMember.teamId, teamId));
}

it("createTeam makes the creator a team admin", async () => {
  const created = await createTeam(ctxFor("og-a"), {
    slug: "og-acme",
    name: "  Acme  ",
  });

  expect(created.name).toBe("Acme");
  expect(await membersOf(created.id)).toMatchObject([
    { userId: "og-a", role: "admin" },
  ]);
});

it("createTeam rejects reserved and malformed slugs and accepts a valid one", async () => {
  // §4.6's list, plus §5's M2 endpoints, the static `/docs` route, and
  // `projects`, whose static route would collide with a project slug.
  expect(RESERVED_SLUGS).toEqual([
    "api",
    "login",
    "new",
    "settings",
    "consent",
    "authorize",
    "_next",
    ".well-known",
    "oauth",
    "internal",
    "token",
    "register",
    "mcp",
    "projects",
    "docs",
  ]);

  for (const slug of RESERVED_SLUGS) {
    await expect(
      createTeam(ctxFor("og-a"), { slug, name: "X" }),
    ).rejects.toMatchObject({ name: "DomainError" });
  }
  // `_next` and `.well-known` are unspellable as slugs anyway; the other six
  // are well-formed and only the denylist stops them.
  for (const slug of ["api", "login", "new", "settings", "consent", "authorize"]) {
    await expect(
      createTeam(ctxFor("og-a"), { slug, name: "X" }),
    ).rejects.toThrowError(/reserved/);
  }

  for (const slug of ["Acme", "a", "has space", "trailing-", "-leading", "a_b"]) {
    await expect(
      createTeam(ctxFor("og-a"), { slug, name: "X" }),
    ).rejects.toMatchObject({ name: "DomainError" });
  }

  const ok = await createTeam(ctxFor("og-a"), { slug: "og-v4lid-x", name: "X" });
  expect(ok.slug).toBe("og-v4lid-x");

  await expect(
    createTeam(ctxFor("og-a"), { slug: "og-v4lid-x", name: "Y" }),
  ).rejects.toThrowError(/already taken/);
});

it("inviteToTeam refuses an address that already belongs to a member", async () => {
  const o = await createTeam(ctxFor("og-a"), { slug: "og-dup", name: "Dup" });

  // og-a's own address, in the casing Google would return it.
  await expect(
    inviteToTeam(ctxFor("og-a"), {
      teamId: o.id,
      email: "OG-A@Team.test",
      role: "member",
    }),
  ).rejects.toThrowError(/already a member/);
});

it("inviteToTeam upserts a removed-then-reinvited user, clearing acceptedAt", async () => {
  const o = await createTeam(ctxFor("og-a"), { slug: "og-re", name: "Re" });

  await inviteToTeam(ctxFor("og-a"), {
    teamId: o.id,
    email: "og-b@team.test",
    role: "member",
  });
  // Accepted, the way claimInvites would stamp it.
  await db
    .update(teamInvite)
    .set({ acceptedAt: now })
    .where(
      and(eq(teamInvite.teamId, o.id), eq(teamInvite.email, "og-b@team.test")),
    );
  await db.insert(teamMember).values({
    teamId: o.id,
    userId: "og-b",
    role: "member",
    createdAt: now,
  });

  await removeTeamMember(ctxFor("og-a"), { teamId: o.id, userId: "og-b" });

  await inviteToTeam(ctxFor("og-a"), {
    teamId: o.id,
    email: "  OG-B@team.test  ",
    role: "admin",
  });

  const invites = await db
    .select()
    .from(teamInvite)
    .where(eq(teamInvite.teamId, o.id));
  expect(invites).toHaveLength(1);
  expect(invites[0]).toMatchObject({
    email: "og-b@team.test",
    role: "admin",
    acceptedAt: null,
  });
});

it("lets the last admin be demoted or removed, since org owners and admins cover the team (P5)", async () => {
  const o = await createTeam(ctxFor("og-a"), { slug: "og-last", name: "Last" });

  await changeTeamMemberRole(ctxFor("og-a"), { teamId: o.id, userId: "og-a", role: "member" });
  expect(await membersOf(o.id)).toMatchObject([{ userId: "og-a", role: "member" }]);

  const p = await createTeam(ctxFor("og-a"), { slug: "og-last-rm", name: "Last rm" });
  await removeTeamMember(ctxFor("og-a"), { teamId: p.id, userId: "og-a" });
  expect(await membersOf(p.id)).toEqual([]);
});

it("a team admin changes and removes other admins, and grants only admin or member", async () => {
  const o = await createTeam(ctxFor("og-a"), { slug: "og-admin", name: "Adm" });
  await db.insert(teamMember).values([
    { teamId: o.id, userId: "og-b", role: "admin", createdAt: now },
    { teamId: o.id, userId: "og-c", role: "member", createdAt: now },
    { teamId: o.id, userId: "og-d", role: "admin", createdAt: now },
  ]);
  const roleOf = async (userId: string) => (await db.select().from(teamMember)
    .where(and(eq(teamMember.teamId, o.id), eq(teamMember.userId, userId))))[0]?.role;

  // There is no owner role left to grant: a stale form gets an inline sentence.
  const owner = "owner" as "admin";
  await expect(
    changeTeamMemberRole(ctxFor("og-b"), { teamId: o.id, userId: "og-c", role: owner }),
  ).rejects.toMatchObject({ name: "DomainError", message: expect.stringMatching(/not a valid role/) });
  await expect(
    inviteToTeam(ctxFor("og-b"), { teamId: o.id, email: "og-d@team.test", role: owner }),
  ).rejects.toMatchObject({ name: "DomainError" });

  // A plain member has none of this authority at all.
  await expect(
    changeTeamMemberRole(ctxFor("og-c"), { teamId: o.id, userId: "og-b", role: "member" }),
  ).rejects.toMatchObject({ reason: "forbidden" });
  await expect(
    removeTeamMember(ctxFor("og-c"), { teamId: o.id, userId: "og-b" }),
  ).rejects.toMatchObject({ reason: "forbidden" });

  // An admin acts on anyone in the team, the team's creator and other admins included.
  await changeTeamMemberRole(ctxFor("og-b"), { teamId: o.id, userId: "og-c", role: "admin" });
  expect(await roleOf("og-c")).toBe("admin");
  await changeTeamMemberRole(ctxFor("og-b"), { teamId: o.id, userId: "og-a", role: "member" });
  expect(await roleOf("og-a")).toBe("member");
  await removeTeamMember(ctxFor("og-b"), { teamId: o.id, userId: "og-d" });
  expect(await roleOf("og-d")).toBeUndefined();
});

it("removing a team member nulls their task assignments and drops their project_member rows", async () => {
  const o = await createTeam(ctxFor("og-a"), { slug: "og-casc", name: "Casc" });
  await db.insert(teamMember).values({
    teamId: o.id,
    userId: "og-b",
    role: "member",
    createdAt: now,
  });
  await db.insert(project).values({
    id: "og-casc-p",
    teamId: o.id,
    slug: "p",
    name: "P",
    key: "OGC",
    createdAt: now,
  });
  await db.insert(projectMember).values({
    teamId: o.id,
    projectId: "og-casc-p",
    userId: "og-b",
  });
  await db.insert(status).values({
    id: "og-casc-s",
    projectId: "og-casc-p",
    name: "Todo",
    color: "gray",
    position: "a0",
    createdAt: now,
  });
  await db.insert(task).values({
    id: "og-casc-t",
    projectId: "og-casc-p",
    number: 1,
    title: "Assigned to the leaver",
    statusId: "og-casc-s",
    assigneeUserId: "og-b",
    position: "a0",
    createdByUserId: "og-a",
    createdAt: now,
    updatedAt: now,
  });

  // A second team whose task is assigned to the same user, to prove the update
  // is scoped to the team being left rather than nulling every assignment.
  const other = await createTeam(ctxFor("og-a"), {
    slug: "og-casc-other",
    name: "Other",
  });
  await db.insert(teamMember).values({
    teamId: other.id,
    userId: "og-b",
    role: "member",
    createdAt: now,
  });
  await db.insert(project).values({
    id: "og-casc-p2",
    teamId: other.id,
    slug: "p",
    name: "P",
    key: "OGD",
    createdAt: now,
  });
  await db.insert(status).values({
    id: "og-casc-s2",
    projectId: "og-casc-p2",
    name: "Todo",
    color: "gray",
    position: "a0",
    createdAt: now,
  });
  await db.insert(task).values({
    id: "og-casc-t2",
    projectId: "og-casc-p2",
    number: 1,
    title: "Still theirs",
    statusId: "og-casc-s2",
    assigneeUserId: "og-b",
    position: "a0",
    createdByUserId: "og-c",
    createdAt: now,
    updatedAt: now,
  });

  await removeTeamMember(ctxFor("og-a"), { teamId: o.id, userId: "og-b" });

  const [t] = await db.select().from(task).where(eq(task.id, "og-casc-t"));
  expect(t.assigneeUserId).toBeNull();
  const [t2] = await db.select().from(task).where(eq(task.id, "og-casc-t2"));
  expect(t2.assigneeUserId).toBe("og-b");

  // The composite FK's ON DELETE CASCADE, not code in removeTeamMember.
  expect(
    await db
      .select()
      .from(projectMember)
      .where(eq(projectMember.projectId, "og-casc-p")),
  ).toEqual([]);

  expect(await membersOf(o.id)).toMatchObject([
    { userId: "og-a", role: "admin" },
  ]);
});
