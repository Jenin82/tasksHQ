import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, expect, it, vi } from "vitest";
import {
  changeOrgMemberRole,
  claimInvites,
  createProject,
  createTask,
  createTeam,
  hasEligibleInvite,
  inviteToOrg,
  removeOrgMember,
  renameOrg,
  revokeOrgInvite,
  startTimer,
} from "@tasks/core/domain";
import {
  activity,
  mailOutbox,
  org,
  orgInvite,
  orgMember,
  projectMember,
  task,
  teamInvite,
  teamMember,
  timeEntry,
  user,
} from "@tasks/core/schema";
import { drainMailOutbox } from "@/lib/mail-outbox";
import { createTeam as createFixtureTeam } from "./helpers";

// Storage is shared across this file's tests, so beforeEach resets org state.
const db = drizzle(env.DB);
const now = new Date();
const OWNER = "og2-owner";
const ADMIN = "og2-admin";
const MEMBER = "og2-member";
const TARGET = "og2-target";
const ctx = (actorUserId: string, emailNotifications = false) =>
  ({ db, actorUserId, source: "web" as const, emailNotifications });

await db.insert(user).values([OWNER, ADMIN, MEMBER, TARGET].map((id) => ({
  id, name: id, email: `${id}@org.test`, emailVerified: true, createdAt: now, updatedAt: now,
})));
const ROLES = [[OWNER, "owner"], [ADMIN, "admin"], [MEMBER, "member"], [TARGET, "member"]] as const;

beforeEach(async () => {
  await db.batch([
    db.delete(orgInvite),
    db.delete(mailOutbox),
    db.delete(orgMember).where(eq(orgMember.role, "owner")),
    ...ROLES.map(([userId, role]) => db.insert(orgMember).values({ userId, role, createdAt: now })
      .onConflictDoUpdate({ target: orgMember.userId, set: { role } })),
  ]);
});

async function signUp(id: string, email: string) {
  await db.insert(user).values({ id, name: id, email, emailVerified: true, createdAt: now, updatedAt: now });
  await claimInvites(db, id, email);
  return (await db.select().from(orgMember).where(eq(orgMember.userId, id)))[0];
}

it("renames the org for owners and admins only", async () => {
  expect(await renameOrg(ctx(ADMIN), { name: "  Acme Inc  " })).toBe("Acme Inc");
  expect((await db.select().from(org))[0].name).toBe("Acme Inc");
  await expect(renameOrg(ctx(OWNER), { name: "  " })).rejects.toThrow(/name is required/);
  await expect(renameOrg(ctx(MEMBER), { name: "Nope" })).rejects.toMatchObject({ reason: "forbidden" });
  await expect(renameOrg(ctx("og2-nobody"), { name: "Nope" })).rejects.toMatchObject({ reason: "not_a_member" });
});

it("invites by email, mails the invite, and claims it with its role", async () => {
  await renameOrg(ctx(OWNER), { name: "Org Two" });
  await inviteToOrg(ctx(ADMIN, true), { email: "  New@Org.test ", role: "admin" });
  expect(await db.select().from(orgInvite)).toMatchObject([{ email: "new@org.test", role: "admin", invitedByUserId: ADMIN }]);
  expect(await hasEligibleInvite(db, "new@org.test")).toBe(true);

  const send = vi.fn(async (_message: { to: string; subject: string; text: string }) => {});
  await drainMailOutbox(db, "https://tasks.example", send);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    to: "new@org.test",
    subject: "You’re invited to join Org Two on TasksHQ",
    text: expect.stringContaining("https://tasks.example/"),
  }));

  expect(await signUp("og2-new", "new@org.test")).toMatchObject({ role: "admin" });
  expect((await db.select().from(orgInvite))[0].acceptedAt).not.toBeNull();

  await expect(inviteToOrg(ctx(ADMIN), { email: "og2-member@org.test", role: "member" })).rejects.toThrow(/already a member/);
  await expect(inviteToOrg(ctx(MEMBER), { email: "x@org.test", role: "member" })).rejects.toMatchObject({ reason: "forbidden" });
});

it("raises an existing org role on claim but never lowers one", async () => {
  // A team invite's trigger made them an org member first.
  await db.insert(user).values({ id: "og2-joined", name: "J", email: "joined@org.test", emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(orgMember).values({ userId: "og2-joined", role: "member", createdAt: now });
  await db.insert(orgInvite).values({ email: "joined@org.test", role: "admin", invitedByUserId: OWNER, createdAt: now });
  await claimInvites(db, "og2-joined", "joined@org.test");
  expect((await db.select().from(orgMember).where(eq(orgMember.userId, "og2-joined")))[0].role).toBe("admin");

  await db.insert(orgInvite).values({ email: "og2-owner@org.test", role: "member", invitedByUserId: ADMIN, createdAt: now });
  await claimInvites(db, OWNER, "og2-owner@org.test");
  expect((await db.select().from(orgMember).where(eq(orgMember.userId, OWNER)))[0].role).toBe("owner");
});

it("drops an invite whose inviter no longer manages the org: not claimable and not mailed", async () => {
  await inviteToOrg(ctx(ADMIN, true), { email: "stale@org.test", role: "member" });
  await db.update(orgMember).set({ role: "member" }).where(eq(orgMember.userId, ADMIN));

  expect(await hasEligibleInvite(db, "stale@org.test")).toBe(false);
  const send = vi.fn(async (_message: { to: string }) => {});
  await drainMailOutbox(db, "https://tasks.example", send);
  expect(send).not.toHaveBeenCalled();
  expect(await signUp("og2-stale", "stale@org.test")).toBeUndefined();
});

it("lets only an owner grant owner, including through an invite", async () => {
  await expect(inviteToOrg(ctx(ADMIN), { email: "boss@org.test", role: "owner" })).rejects.toThrow(/Only a Super admin/);
  await inviteToOrg(ctx(OWNER), { email: "boss@org.test", role: "owner" });
  // An admin can neither overwrite nor revoke a pending owner invite.
  await expect(inviteToOrg(ctx(ADMIN), { email: "boss@org.test", role: "member" })).rejects.toThrow(/pending Super admin invite/);
  await revokeOrgInvite(ctx(ADMIN), { email: "boss@org.test" });
  expect(await db.select().from(orgInvite)).toHaveLength(1);

  // An owner invite whose inviter is now only an admin is no longer claimable.
  await db.update(orgMember).set({ role: "admin" }).where(eq(orgMember.userId, OWNER));
  expect(await hasEligibleInvite(db, "boss@org.test")).toBe(false);
  await db.update(orgMember).set({ role: "owner" }).where(eq(orgMember.userId, OWNER));
  expect(await signUp("og2-boss", "boss@org.test")).toMatchObject({ role: "owner" });
});

it("changes roles within the matrix and keeps an owner", async () => {
  await expect(changeOrgMemberRole(ctx(ADMIN), { userId: OWNER, role: "member" })).rejects.toMatchObject({ reason: "forbidden" });
  await expect(changeOrgMemberRole(ctx(ADMIN), { userId: MEMBER, role: "owner" })).rejects.toThrow(/Only a Super admin/);
  await expect(changeOrgMemberRole(ctx(MEMBER), { userId: TARGET, role: "admin" })).rejects.toMatchObject({ reason: "forbidden" });
  await changeOrgMemberRole(ctx(ADMIN), { userId: MEMBER, role: "admin" });

  await expect(changeOrgMemberRole(ctx(OWNER), { userId: OWNER, role: "admin" })).rejects.toThrow(/at least one Super admin/);
  await changeOrgMemberRole(ctx(OWNER), { userId: MEMBER, role: "owner" });
  await changeOrgMemberRole(ctx(OWNER), { userId: OWNER, role: "admin" });
  expect(await db.select({ userId: orgMember.userId }).from(orgMember).where(eq(orgMember.role, "owner")))
    .toEqual([{ userId: MEMBER }]);
});

it("removes someone from the org and every team in one batch", async () => {
  const first = await createTeam(ctx(ADMIN), { slug: "og2-first", name: "First" });
  const second = await createTeam(ctx(ADMIN), { slug: "og2-second", name: "Second" });
  const elsewhere = await createFixtureTeam(ctx(ADMIN), { slug: "og2-elsewhere", name: "Elsewhere" });
  await db.insert(teamMember).values([first.id, second.id].map((teamId) => ({ teamId, userId: TARGET, role: "member" as const, createdAt: now })));
  const p1 = await createProject(ctx(ADMIN), { teamId: first.id, slug: "one", name: "One", key: "ONE" });
  const p2 = await createProject(ctx(ADMIN), { teamId: second.id, slug: "two", name: "Two", key: "TWO" });
  const p3 = await createProject(ctx(ADMIN), { teamId: elsewhere.id, slug: "three", name: "Three", key: "THR" });
  await db.insert(projectMember).values({ teamId: first.id, projectId: p1.id, userId: TARGET, role: "admin" });
  const t1 = await createTask(ctx(ADMIN), { projectId: p1.id, title: "One", assigneeUserId: TARGET });
  const t2 = await createTask(ctx(ADMIN), { projectId: p2.id, title: "Two", assigneeUserId: TARGET });
  // Outside their teams: a stale assignment the removal leaves alone.
  const t3 = await createTask(ctx(ADMIN), { projectId: p3.id, title: "Three" });
  await db.update(task).set({ assigneeUserId: TARGET }).where(eq(task.id, t3.id));
  const timer = await startTimer(ctx(TARGET), { taskId: t1.id, projectId: p1.id });
  // Pending invites go with them; an accepted one is history and stays.
  const invite = { email: `${TARGET}@org.test`, role: "member" as const, invitedByUserId: ADMIN, createdAt: now };
  await db.insert(teamInvite).values([
    { ...invite, teamId: elsewhere.id },
    { ...invite, teamId: second.id, acceptedAt: now },
  ]);
  await db.insert(orgInvite).values(invite);

  await removeOrgMember(ctx(ADMIN), { userId: TARGET });

  expect(await db.select({ teamId: teamInvite.teamId }).from(teamInvite).where(eq(teamInvite.email, invite.email)))
    .toEqual([{ teamId: second.id }]);
  expect(await db.select().from(orgInvite).where(eq(orgInvite.email, invite.email))).toEqual([]);

  const assignees = await db.select({ id: task.id, assignee: task.assigneeUserId }).from(task);
  expect(assignees.find((t) => t.id === t1.id)?.assignee).toBeNull();
  expect(assignees.find((t) => t.id === t2.id)?.assignee).toBeNull();
  expect(assignees.find((t) => t.id === t3.id)?.assignee).toBe(TARGET);
  for (const t of [t1, t2]) {
    const log = await db.select().from(activity).where(and(eq(activity.taskId, t.id), eq(activity.type, "task.updated")));
    expect(log).toHaveLength(1);
    expect(JSON.parse(String(log[0].data))).toEqual({ fields: { assignee: { from: { id: TARGET, displayName: TARGET }, to: null } } });
  }
  expect((await db.select().from(timeEntry).where(eq(timeEntry.id, timer.id)))[0].endedAt).not.toBeNull();
  expect(await db.select().from(teamMember).where(eq(teamMember.userId, TARGET))).toEqual([]);
  expect(await db.select().from(projectMember).where(eq(projectMember.userId, TARGET))).toEqual([]);
  expect(await db.select().from(orgMember).where(eq(orgMember.userId, TARGET))).toEqual([]);
});

it("refuses to remove the last owner, and an admin cannot remove an owner", async () => {
  const team = await createTeam(ctx(OWNER), { slug: "og2-keep", name: "Keep" });
  const p = await createProject(ctx(OWNER), { teamId: team.id, slug: "keep", name: "Keep", key: "KEP" });
  const t = await createTask(ctx(OWNER), { projectId: p.id, title: "Mine", assigneeUserId: OWNER });
  const invite = { email: `${OWNER}@org.test`, role: "member" as const, invitedByUserId: ADMIN, createdAt: now };
  await db.insert(teamInvite).values({ ...invite, teamId: team.id });

  await expect(removeOrgMember(ctx(OWNER), { userId: OWNER })).rejects.toThrow(/at least one Super admin/);
  await expect(removeOrgMember(ctx(ADMIN), { userId: OWNER })).rejects.toMatchObject({ reason: "forbidden" });
  await expect(removeOrgMember(ctx(MEMBER), { userId: TARGET })).rejects.toMatchObject({ reason: "forbidden" });
  // The refused batch rolled back its unassignment.
  expect((await db.select().from(task).where(eq(task.id, t.id)))[0].assigneeUserId).toBe(OWNER);
  expect(await db.select().from(orgMember).where(eq(orgMember.userId, OWNER))).toHaveLength(1);
  // ...and its invite cleanup.
  expect(await db.select().from(teamInvite).where(eq(teamInvite.email, invite.email))).toHaveLength(1);
});

it("lets an org admin remove a team admin from the org", async () => {
  const owned = await createFixtureTeam(ctx(ADMIN), { slug: "og2-owned", name: "Owned" });
  await db.insert(teamMember).values({ teamId: owned.id, userId: TARGET, role: "admin", createdAt: now });

  await removeOrgMember(ctx(ADMIN), { userId: TARGET });
  expect(await db.select().from(orgMember).where(eq(orgMember.userId, TARGET))).toEqual([]);
  expect(await db.select().from(teamMember).where(eq(teamMember.userId, TARGET))).toEqual([]);
});

it("lets only org owners and admins create teams", async () => {
  await expect(createTeam(ctx(MEMBER), { slug: "og2-nope", name: "Nope" })).rejects.toMatchObject({ reason: "forbidden" });
  await expect(createTeam(ctx("og2-nobody"), { slug: "og2-nope", name: "Nope" })).rejects.toMatchObject({ reason: "not_a_member" });
  const created = await createTeam(ctx(ADMIN), { slug: "og2-made", name: "Made" });
  expect(await db.select().from(teamMember).where(eq(teamMember.teamId, created.id)))
    .toMatchObject([{ userId: ADMIN, role: "admin" }]);
});
