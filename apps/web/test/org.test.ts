import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { RESERVED_SLUGS } from "@tasks/core/slug";
import {
  changeOrgMemberRole,
  createOrg,
  inviteToOrg,
  removeOrgMember,
} from "@tasks/core/domain";
import {
  org,
  orgInvite,
  orgMember,
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
    email: `${id}@org.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

function ctxFor(userId: string) {
  return { db, actorUserId: userId, source: "web" as const };
}

async function membersOf(orgId: string) {
  return db.select().from(orgMember).where(eq(orgMember.orgId, orgId));
}

it("createOrg makes the creator an owner", async () => {
  const created = await createOrg(ctxFor("og-a"), {
    slug: "og-acme",
    name: "  Acme  ",
  });

  expect(created.name).toBe("Acme");
  expect(await membersOf(created.id)).toMatchObject([
    { userId: "og-a", role: "owner" },
  ]);
});

it("createOrg rejects reserved and malformed slugs and accepts a valid one", async () => {
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
      createOrg(ctxFor("og-a"), { slug, name: "X" }),
    ).rejects.toMatchObject({ name: "DomainError" });
  }
  // `_next` and `.well-known` are unspellable as slugs anyway; the other six
  // are well-formed and only the denylist stops them.
  for (const slug of ["api", "login", "new", "settings", "consent", "authorize"]) {
    await expect(
      createOrg(ctxFor("og-a"), { slug, name: "X" }),
    ).rejects.toThrowError(/reserved/);
  }

  for (const slug of ["Acme", "a", "has space", "trailing-", "-leading", "a_b"]) {
    await expect(
      createOrg(ctxFor("og-a"), { slug, name: "X" }),
    ).rejects.toMatchObject({ name: "DomainError" });
  }

  const ok = await createOrg(ctxFor("og-a"), { slug: "og-v4lid-x", name: "X" });
  expect(ok.slug).toBe("og-v4lid-x");

  await expect(
    createOrg(ctxFor("og-b"), { slug: "og-v4lid-x", name: "X" }),
  ).rejects.toThrowError(/already taken/);
});

it("inviteToOrg refuses an address that already belongs to a member", async () => {
  const o = await createOrg(ctxFor("og-a"), { slug: "og-dup", name: "Dup" });

  // og-a's own address, in the casing Google would return it.
  await expect(
    inviteToOrg(ctxFor("og-a"), {
      orgId: o.id,
      email: "OG-A@Org.test",
      role: "member",
    }),
  ).rejects.toThrowError(/already a member/);
});

it("inviteToOrg upserts a removed-then-reinvited user, clearing acceptedAt", async () => {
  const o = await createOrg(ctxFor("og-a"), { slug: "og-re", name: "Re" });

  await inviteToOrg(ctxFor("og-a"), {
    orgId: o.id,
    email: "og-b@org.test",
    role: "member",
  });
  // Accepted, the way claimInvites would stamp it.
  await db
    .update(orgInvite)
    .set({ acceptedAt: now })
    .where(
      and(eq(orgInvite.orgId, o.id), eq(orgInvite.email, "og-b@org.test")),
    );
  await db.insert(orgMember).values({
    orgId: o.id,
    userId: "og-b",
    role: "member",
    createdAt: now,
  });

  await removeOrgMember(ctxFor("og-a"), { orgId: o.id, userId: "og-b" });

  await inviteToOrg(ctxFor("og-a"), {
    orgId: o.id,
    email: "  OG-B@org.test  ",
    role: "admin",
  });

  const invites = await db
    .select()
    .from(orgInvite)
    .where(eq(orgInvite.orgId, o.id));
  expect(invites).toHaveLength(1);
  expect(invites[0]).toMatchObject({
    email: "og-b@org.test",
    role: "admin",
    acceptedAt: null,
  });
});

it("refuses to remove or demote the final owner, and allows both once there are two", async () => {
  const o = await createOrg(ctxFor("og-a"), { slug: "og-last", name: "Last" });

  await expect(
    removeOrgMember(ctxFor("og-a"), { orgId: o.id, userId: "og-a" }),
  ).rejects.toThrowError(/at least one owner/);
  await expect(
    changeOrgMemberRole(ctxFor("og-a"), {
      orgId: o.id,
      userId: "og-a",
      role: "admin",
    }),
  ).rejects.toThrowError(/at least one owner/);

  await db.insert(orgMember).values({
    orgId: o.id,
    userId: "og-b",
    role: "owner",
    createdAt: now,
  });

  await changeOrgMemberRole(ctxFor("og-a"), {
    orgId: o.id,
    userId: "og-a",
    role: "admin",
  });
  await changeOrgMemberRole(ctxFor("og-b"), {
    orgId: o.id,
    userId: "og-a",
    role: "owner",
  });
  await removeOrgMember(ctxFor("og-b"), { orgId: o.id, userId: "og-b" });

  expect(await membersOf(o.id)).toMatchObject([
    { userId: "og-a", role: "owner" },
  ]);
});

it("an admin cannot grant or target owner, nor remove one", async () => {
  const o = await createOrg(ctxFor("og-a"), { slug: "og-admin", name: "Adm" });
  await db.insert(orgMember).values([
    { orgId: o.id, userId: "og-b", role: "admin", createdAt: now },
    { orgId: o.id, userId: "og-c", role: "member", createdAt: now },
  ]);

  await expect(
    changeOrgMemberRole(ctxFor("og-b"), {
      orgId: o.id,
      userId: "og-c",
      role: "owner",
    }),
    // A DomainError, so a stale form gets an inline sentence, not a 403.
  ).rejects.toMatchObject({ name: "DomainError" });

  await expect(
    changeOrgMemberRole(ctxFor("og-b"), {
      orgId: o.id,
      userId: "og-a",
      role: "member",
    }),
  ).rejects.toMatchObject({ reason: "forbidden" });

  await expect(
    removeOrgMember(ctxFor("og-b"), { orgId: o.id, userId: "og-a" }),
  ).rejects.toMatchObject({ reason: "forbidden" });

  await expect(
    inviteToOrg(ctxFor("og-b"), {
      orgId: o.id,
      email: "og-d@org.test",
      role: "owner",
    }),
  ).rejects.toMatchObject({ name: "DomainError" });

  // A plain member has none of this authority at all.
  await expect(
    changeOrgMemberRole(ctxFor("og-c"), {
      orgId: o.id,
      userId: "og-b",
      role: "member",
    }),
  ).rejects.toMatchObject({ reason: "forbidden" });

  // But an admin may still change a non-owner's role.
  await changeOrgMemberRole(ctxFor("og-b"), {
    orgId: o.id,
    userId: "og-c",
    role: "admin",
  });
  const [c] = await db
    .select()
    .from(orgMember)
    .where(and(eq(orgMember.orgId, o.id), eq(orgMember.userId, "og-c")));
  expect(c.role).toBe("admin");
});

it("removing an org member nulls their task assignments and drops their project_member rows", async () => {
  const o = await createOrg(ctxFor("og-a"), { slug: "og-casc", name: "Casc" });
  await db.insert(orgMember).values({
    orgId: o.id,
    userId: "og-b",
    role: "member",
    createdAt: now,
  });
  await db.insert(project).values({
    id: "og-casc-p",
    orgId: o.id,
    slug: "p",
    name: "P",
    key: "OGC",
    createdAt: now,
  });
  await db.insert(projectMember).values({
    orgId: o.id,
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

  // A second org whose task is assigned to the same user, to prove the update
  // is scoped to the org being left rather than nulling every assignment.
  const other = await createOrg(ctxFor("og-c"), {
    slug: "og-casc-other",
    name: "Other",
  });
  await db.insert(orgMember).values({
    orgId: other.id,
    userId: "og-b",
    role: "member",
    createdAt: now,
  });
  await db.insert(project).values({
    id: "og-casc-p2",
    orgId: other.id,
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

  await removeOrgMember(ctxFor("og-a"), { orgId: o.id, userId: "og-b" });

  const [t] = await db.select().from(task).where(eq(task.id, "og-casc-t"));
  expect(t.assigneeUserId).toBeNull();
  const [t2] = await db.select().from(task).where(eq(task.id, "og-casc-t2"));
  expect(t2.assigneeUserId).toBe("og-b");

  // The composite FK's ON DELETE CASCADE, not code in removeOrgMember.
  expect(
    await db
      .select()
      .from(projectMember)
      .where(eq(projectMember.projectId, "og-casc-p")),
  ).toEqual([]);

  expect(await membersOf(o.id)).toMatchObject([
    { userId: "og-a", role: "owner" },
  ]);
});
