import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { claimInvites, createProject } from "@tasks/core/domain";
import { org, orgInvite, orgMember, projectInvite, projectMember, user } from "@tasks/core/schema";
import { auth } from "@/lib/auth";

const db = drizzle(env.DB);
const now = new Date();

// org_invite.invited_by_user_id is a FK to user, so every invite needs one.
await db.insert(user).values({
  id: "inv-inviter",
  name: "inviter",
  email: "inviter@invites.test",
  createdAt: now,
  updatedAt: now,
});

// Storage is shared across the run — no per-test isolation — so each test owns
// its own org ids and email addresses.
async function seedOrg(id: string) {
  await db.insert(org).values({ id, slug: id, name: id, createdAt: now });
  await db.insert(orgMember).values({
    orgId: id,
    userId: "inv-inviter",
    role: "owner",
    createdAt: now,
  });
}

async function seedInvite(
  orgId: string,
  email: string,
  role: "owner" | "admin" | "member" = "member",
) {
  await db.insert(orgInvite).values({
    orgId,
    email,
    role,
    invitedByUserId: "inv-inviter",
    createdAt: now,
    acceptedAt: null,
  });
}

async function seedUser(id: string, email: string, emailVerified = true) {
  await db
    .insert(user)
    .values({ id, name: id, email, emailVerified, createdAt: now, updatedAt: now });
}

function membersOf(userId: string) {
  return db.select().from(orgMember).where(eq(orgMember.userId, userId));
}

async function inviteRow(orgId: string, email: string) {
  const [row] = await db
    .select()
    .from(orgInvite)
    .where(and(eq(orgInvite.orgId, orgId), eq(orgInvite.email, email)));
  return row;
}

// Drives Better Auth's own user-creation seam, so the databaseHooks in
// lib/auth.ts fire exactly as they do on a real Google sign-up. The Google
// callback leg itself needs real credentials (§13) and is not exercised here.
async function createUserThroughBetterAuth(name: string, email: string) {
  const ctx = await auth.$context;
  return ctx.internalAdapter.createUser(
    { name, email, emailVerified: true },
    { method: "oauth", oauth: { providerId: "google" } },
  );
}

async function createSessionThroughBetterAuth(userId: string) {
  const ctx = await auth.$context;
  return ctx.internalAdapter.createSession(userId);
}

it("claims an invite sent before the user existed, on user create", async () => {
  await seedOrg("inv-before");
  await seedInvite("inv-before", "before@invites.test", "admin");

  const created = await createUserThroughBetterAuth(
    "Before",
    "before@invites.test",
  );

  const members = await membersOf(created.id);
  expect(members).toHaveLength(1);
  expect(members[0]).toMatchObject({ orgId: "inv-before", role: "admin" });
  expect(
    (await inviteRow("inv-before", "before@invites.test")).acceptedAt,
  ).not.toBeNull();
});

it("claims an invite sent after the user existed, on session create", async () => {
  const created = await createUserThroughBetterAuth(
    "After",
    "after@invites.test",
  );
  expect(await membersOf(created.id)).toHaveLength(0);

  await seedOrg("inv-after");
  await seedInvite("inv-after", "after@invites.test", "member");

  await createSessionThroughBetterAuth(created.id);

  const members = await membersOf(created.id);
  expect(members).toHaveLength(1);
  expect(members[0]).toMatchObject({ orgId: "inv-after", role: "member" });
  expect(
    (await inviteRow("inv-after", "after@invites.test")).acceptedAt,
  ).not.toBeNull();
});

it("is idempotent: a second call inserts nothing and does not throw", async () => {
  await seedOrg("inv-idem");
  await seedUser("inv-u-idem", "idem@invites.test");
  await seedInvite("inv-idem", "idem@invites.test");

  await claimInvites(db, "inv-u-idem", "idem@invites.test");
  await claimInvites(db, "inv-u-idem", "idem@invites.test");

  expect(await membersOf("inv-u-idem")).toHaveLength(1);
});

it("survives a re-invite to a user who is still a member", async () => {
  // §3's dead end: re-inviting is an upsert that clears acceptedAt, so a user
  // who never left can reach claimInvites again with a live org_member row.
  await seedOrg("inv-reinvite");
  await seedUser("inv-u-reinvite", "reinvite@invites.test");
  await db.insert(orgMember).values({
    orgId: "inv-reinvite",
    userId: "inv-u-reinvite",
    role: "member",
    createdAt: now,
  });
  await seedInvite("inv-reinvite", "reinvite@invites.test", "admin");

  await claimInvites(db, "inv-u-reinvite", "reinvite@invites.test");

  const members = await membersOf("inv-u-reinvite");
  expect(members).toHaveLength(1);
  // The existing row wins — onConflictDoNothing does not overwrite the role.
  expect(members[0]).toMatchObject({ orgId: "inv-reinvite", role: "member" });
  expect(
    (await inviteRow("inv-reinvite", "reinvite@invites.test")).acceptedAt,
  ).not.toBeNull();
});

it("matches a mixed-case sign-in email against the lowercased invite", async () => {
  await seedOrg("inv-case");
  await seedUser("inv-u-case", "Casey@Example.com");
  await seedInvite("inv-case", "casey@example.com");

  await claimInvites(db, "inv-u-case", "Casey@Example.com");

  expect(await membersOf("inv-u-case")).toHaveLength(1);
  expect(
    (await inviteRow("inv-case", "casey@example.com")).acceptedAt,
  ).not.toBeNull();
});

it("claims every pending invite for one email across orgs", async () => {
  await seedOrg("inv-multi-a");
  await seedOrg("inv-multi-b");
  await seedUser("inv-u-multi", "multi@invites.test");
  await seedInvite("inv-multi-a", "multi@invites.test", "owner");
  await seedInvite("inv-multi-b", "multi@invites.test", "member");

  await claimInvites(db, "inv-u-multi", "multi@invites.test");

  const members = await membersOf("inv-u-multi");
  expect(
    members.map((m) => [m.orgId, m.role]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  ).toEqual([
    ["inv-multi-a", "owner"],
    ["inv-multi-b", "member"],
  ]);
});

it("leaves another address's invite untouched", async () => {
  await seedOrg("inv-other");
  await seedUser("inv-u-other", "mine@invites.test");
  await seedInvite("inv-other", "mine@invites.test");
  await seedInvite("inv-other", "theirs@invites.test");

  await claimInvites(db, "inv-u-other", "mine@invites.test");

  expect(await membersOf("inv-u-other")).toHaveLength(1);
  const theirs = await inviteRow("inv-other", "theirs@invites.test");
  expect(theirs.acceptedAt).toBeNull();
  const members = await db.select().from(orgMember).where(eq(orgMember.orgId, "inv-other"));
  expect(members.map((member) => member.userId).sort()).toEqual(["inv-inviter", "inv-u-other"]);
});

it("requires an org invite claim to use the verified account address", async () => {
  const orgId = "inv-verified-org";
  const userId = "inv-u-verified-org";
  const email = "verified-org@invites.test";
  await seedOrg(orgId);
  await seedUser(userId, email, false);
  await seedInvite(orgId, email);
  await seedInvite(orgId, "unrelated-org@invites.test", "admin");

  await claimInvites(db, userId, email);
  expect(await membersOf(userId)).toEqual([]);

  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
  await claimInvites(db, userId, "unrelated-org@invites.test");
  expect(await membersOf(userId)).toEqual([]);

  await claimInvites(db, userId, email);
  expect(await membersOf(userId)).toEqual([expect.objectContaining({ orgId, role: "member" })]);
  expect((await inviteRow(orgId, "unrelated-org@invites.test")).acceptedAt).toBeNull();
});


it("leaves legacy project invites inactive on verified signup and sign-in", async () => {
  const orgId = "inv-legacy-project";
  const inviter = { db, actorUserId: "inv-inviter", source: "web" as const };
  await seedOrg(orgId);
  const project = await createProject(inviter, { orgId, slug: "invite-target", name: "Invite target", key: "INVT" });
  const email = "legacy-project@invites.test";
  await db.insert(projectInvite).values({ projectId: project.id, email, invitedByUserId: inviter.actorUserId, createdAt: now });

  const created = await createUserThroughBetterAuth("Legacy invitee", email);
  expect(await membersOf(created.id)).toEqual([]);
  await createSessionThroughBetterAuth(created.id);
  expect(await membersOf(created.id)).toEqual([]);
  expect(await db.select().from(projectMember).where(eq(projectMember.userId, created.id))).toEqual([]);

  await seedInvite(orgId, email);
  await createSessionThroughBetterAuth(created.id);
  expect(await membersOf(created.id)).toEqual([expect.objectContaining({ orgId, role: "member" })]);
  expect(await db.select().from(projectMember).where(eq(projectMember.userId, created.id))).toEqual([]);
  expect(await db.select().from(projectInvite).where(eq(projectInvite.projectId, project.id))).toHaveLength(1);
});
