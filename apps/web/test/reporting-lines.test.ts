import { env } from "cloudflare:test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, expect, it } from "vitest";
import { setReportingLead } from "@tasks/core/domain";
import { orgMember, reportingLine, team, teamMember, user } from "@tasks/core/schema";

const db = drizzle(env.DB);
const now = new Date();

// Storage is shared across the run, so every id here is prefixed `rl-`.
const U = {
  orgAdmin: "rl-org-admin", // org admin, in no team
  demoted: "rl-demoted", // org admin, demoted to member in one test
  teamAdmin: "rl-team-admin", // admin of T1, plain member of T2
  p1: "rl-p1", // T1
  p2: "rl-p2", // T1
  p3: "rl-p3", // T2 only
  p4: "rl-p4", // T1 and T2
  outsider: "rl-outsider", // not in the org
};
await db.insert(user).values(Object.values(U).map((id) => ({ id, name: id, email: `${id}@rl.test` })));
await db.insert(team).values([
  { id: "rl-t1", slug: "rl-t1", name: "One", createdAt: now },
  { id: "rl-t2", slug: "rl-t2", name: "Two", createdAt: now },
]);
await db.insert(teamMember).values([
  { teamId: "rl-t1", userId: U.teamAdmin, role: "admin", createdAt: now },
  { teamId: "rl-t1", userId: U.p1, role: "member", createdAt: now },
  { teamId: "rl-t1", userId: U.p2, role: "member", createdAt: now },
  { teamId: "rl-t1", userId: U.p4, role: "member", createdAt: now },
  { teamId: "rl-t2", userId: U.teamAdmin, role: "member", createdAt: now },
  { teamId: "rl-t2", userId: U.p3, role: "member", createdAt: now },
  { teamId: "rl-t2", userId: U.p4, role: "member", createdAt: now },
]);
await db.insert(orgMember).values([
  { userId: U.orgAdmin, role: "admin", createdAt: now },
  { userId: U.demoted, role: "admin", createdAt: now },
]);

const ctx = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });
const orgAdmin = ctx(U.orgAdmin);
const leadOf = async (userId: string) =>
  (await db.select().from(reportingLine).where(eq(reportingLine.userId, userId)))[0]?.leadUserId ?? null;
const cannotManage = { reason: "forbidden", message: "You cannot manage reporting lines." };

beforeEach(async () => {
  await db.delete(reportingLine).where(like(reportingLine.userId, "rl-%"));
  await db.update(orgMember).set({ role: "admin" }).where(eq(orgMember.userId, U.demoted));
});

it("lets an org admin set, overwrite and clear any line, across teams and themselves, without a team role", async () => {
  await setReportingLead(orgAdmin, { userId: U.p1, leadUserId: U.p2 });
  await setReportingLead(orgAdmin, { userId: U.p1, leadUserId: U.p3, expectedLeadUserId: U.p2 });
  await setReportingLead(orgAdmin, { userId: U.p2, leadUserId: U.orgAdmin });
  expect(await leadOf(U.p1)).toBe(U.p3);
  expect(await leadOf(U.p2)).toBe(U.orgAdmin);
  await setReportingLead(orgAdmin, { userId: U.p1, leadUserId: null, expectedLeadUserId: U.p3 });
  expect(await leadOf(U.p1)).toBeNull();
});

it("refuses org members, including real team admins", async () => {
  await expect(setReportingLead(ctx(U.p1), { userId: U.p2, leadUserId: U.p4 })).rejects.toMatchObject(cannotManage);
  await expect(setReportingLead(ctx(U.teamAdmin), { userId: U.p1, leadUserId: U.p2 })).rejects.toMatchObject(cannotManage);
  await setReportingLead(orgAdmin, { userId: U.p1, leadUserId: U.p2 });
  await expect(setReportingLead(ctx(U.teamAdmin), { userId: U.p1, leadUserId: null })).rejects.toMatchObject(cannotManage);
  await expect(setReportingLead(ctx(U.outsider), { userId: U.p1, leadUserId: U.p4 }))
    .rejects.toMatchObject({ reason: "not_a_member" });
  expect(await leadOf(U.p1)).toBe(U.p2);
});

it("refuses an org admin demoted after loading the page, loudly", async () => {
  await db.update(orgMember).set({ role: "member" }).where(eq(orgMember.userId, U.demoted));
  await expect(setReportingLead(ctx(U.demoted), { userId: U.p1, leadUserId: U.p2 })).rejects.toMatchObject(cannotManage);
  // Even clearing a line that does not exist.
  await expect(setReportingLead(ctx(U.demoted), { userId: U.p1, leadUserId: null })).rejects.toMatchObject(cannotManage);
  expect(await leadOf(U.p1)).toBeNull();
});

it("refuses a cycle", async () => {
  await setReportingLead(orgAdmin, { userId: U.p4, leadUserId: U.p3 });
  await setReportingLead(orgAdmin, { userId: U.p3, leadUserId: U.p1 });
  await expect(setReportingLead(orgAdmin, { userId: U.p1, leadUserId: U.p4 }))
    .rejects.toMatchObject({ message: "This reporting line would create a cycle." });
  expect(await leadOf(U.p1)).toBeNull();
});

it("treats clearing a line that is already gone as done, whatever lead was expected", async () => {
  await setReportingLead(orgAdmin, { userId: U.p1, leadUserId: null });
  await setReportingLead(orgAdmin, { userId: U.p1, leadUserId: null, expectedLeadUserId: null });
  await setReportingLead(orgAdmin, { userId: U.p1, leadUserId: null, expectedLeadUserId: U.p2 });
  expect(await leadOf(U.p1)).toBeNull();
});

it("refuses self lines, stale edits and people outside the org", async () => {
  await expect(setReportingLead(orgAdmin, { userId: U.p1, leadUserId: U.p1 }))
    .rejects.toMatchObject({ message: "A person cannot be their own lead." });
  await setReportingLead(orgAdmin, { userId: U.p1, leadUserId: U.p2 });
  const stale = { message: "This reporting line changed. Refresh the page and try again." };
  await expect(setReportingLead(orgAdmin, { userId: U.p1, leadUserId: U.p4, expectedLeadUserId: null })).rejects.toMatchObject(stale);
  await expect(setReportingLead(orgAdmin, { userId: U.p1, leadUserId: null, expectedLeadUserId: U.p4 })).rejects.toMatchObject(stale);
  await expect(setReportingLead(orgAdmin, { userId: U.outsider, leadUserId: U.p1 }))
    .rejects.toMatchObject({ message: "Both people must be members of this organization." });
  expect(await leadOf(U.p1)).toBe(U.p2);
});
