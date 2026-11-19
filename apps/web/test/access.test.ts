import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  AccessError,
  can,
  canProject,
  requireCapability,
  requireTeamMember,
  requireProjectMember,
} from "@tasks/core/access";
import { createStatus, removeTeamMember, removeProjectMember, setProjectMemberRole, setReportingLead } from "@tasks/core/domain";
import {
  team,
  teamMember,
  teamReportingLine,
  project,
  projectMember,
  user,
} from "@tasks/core/schema";

const db = drizzle(env.DB);
const now = new Date();

// Storage is shared across the run, so every id here is prefixed `ac-`.
const USERS = {
  owner: "ac-owner",
  admin: "ac-admin",
  member: "ac-member",
  projectMember: "ac-project-member",
  stranger: "ac-stranger",
};

await db.insert(user).values(
  Object.values(USERS).map((id) => ({
    id,
    name: id,
    email: `${id}@access.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

await db.insert(team).values({
  id: "ac-team",
  slug: "ac-team",
  name: "Access",
  createdAt: now,
});
await db.insert(teamMember).values([
  { teamId: "ac-team", userId: USERS.owner, role: "owner", createdAt: now },
  { teamId: "ac-team", userId: USERS.admin, role: "admin", createdAt: now },
  { teamId: "ac-team", userId: USERS.member, role: "member", createdAt: now },
  {
    teamId: "ac-team",
    userId: USERS.projectMember,
    role: "member",
    createdAt: now,
  },
]);
await db.insert(project).values({
  id: "ac-project",
  teamId: "ac-team",
  slug: "ac-project",
  name: "Access",
  key: "ACC",
  createdAt: now,
});
// Only this one plain member gets an explicit row.
await db.insert(projectMember).values({
  teamId: "ac-team",
  projectId: "ac-project",
  userId: USERS.projectMember,
});

it("requireTeamMember returns the member row, and hides the team from a stranger", async () => {
  expect(await requireTeamMember(db, "ac-team", USERS.admin)).toMatchObject({
    role: "admin",
  });

  await expect(
    requireTeamMember(db, "ac-team", USERS.stranger),
  ).rejects.toMatchObject({ name: "AccessError", reason: "not_a_member" });
});

it("requireProjectMember admits a team owner and admin with no project_member row", async () => {
  // §3's rule most likely to be implemented twice and diverge: implicit access
  // for owner/admin is what makes "manage project statuses/members" coherent.
  const rows = await db
    .select()
    .from(projectMember)
    .where(eq(projectMember.projectId, "ac-project"));
  expect(rows.map((r) => r.userId)).toEqual([USERS.projectMember]);

  expect(
    await requireProjectMember(db, "ac-project", USERS.owner),
  ).toMatchObject({ member: { role: "owner" } });
  expect(
    await requireProjectMember(db, "ac-project", USERS.admin),
  ).toMatchObject({ member: { role: "admin" } });
});

it("requireProjectMember admits a team member without a project role", async () => {
  expect(await requireProjectMember(db, "ac-project", USERS.member)).toMatchObject({
    project: { key: "ACC" }, member: { role: "member" }, projectRole: null,
  });

  expect(
    await requireProjectMember(db, "ac-project", USERS.projectMember),
  ).toMatchObject({ project: { key: "ACC" }, member: { role: "member" } });
});

it("requireProjectMember hides a project in a team the caller is not in", async () => {
  await expect(
    requireProjectMember(db, "ac-project", USERS.stranger),
  ).rejects.toMatchObject({ reason: "not_a_member" });
});

await db.insert(project).values({
  id: "ac-second",
  teamId: "ac-team",
  slug: "ac-second",
  name: "Second",
  key: "SEC",
  createdAt: now,
});

it("revokes access to every project when a member leaves the team", async () => {
  const userId = "ac-leaving";
  await db.insert(user).values({ id: userId, name: "Leaving", email: "leaving@access.test" });
  await db.insert(teamMember).values({ teamId: "ac-team", userId, role: "member", createdAt: now });
  const owner = { db, actorUserId: USERS.owner, source: "web" as const };

  for (const id of ["ac-project", "ac-second"]) {
    await expect(requireProjectMember(db, id, userId)).resolves.toMatchObject({ member: { userId } });
  }
  await removeTeamMember(owner, { teamId: "ac-team", userId });
  for (const id of ["ac-project", "ac-second"]) {
    await expect(requireProjectMember(db, id, userId)).rejects.toMatchObject({ reason: "not_a_member" });
  }
});

it("grants project administration without team or other project privileges", async () => {
  const owner = { db, actorUserId: USERS.owner, source: "web" as const };
  const projectAdmin = { ...owner, actorUserId: USERS.member };
  const scope = { projectId: "ac-project", userId: USERS.member };
  await setProjectMemberRole(owner, { ...scope, role: "admin" });

  const { projectRole } = await requireProjectMember(db, scope.projectId, USERS.member);
  expect(projectRole).toBe("admin");
  expect(canProject("member", projectRole, "project:manage_members")).toBe(true);
  expect(canProject("member", projectRole, "team:manage_members")).toBe(false);
  expect(canProject("member", projectRole, "project:delete")).toBe(false);
  await expect(createStatus(projectAdmin, { projectId: scope.projectId, name: "Review" }))
    .resolves.toMatchObject({ name: "Review" });
  await expect(requireProjectMember(db, "ac-second", USERS.member)).resolves.toMatchObject({ projectRole: null });
  await expect(createStatus(projectAdmin, { projectId: "ac-second", name: "Review" }))
    .rejects.toMatchObject({ reason: "forbidden" });
  await expect(removeProjectMember(projectAdmin, scope)).rejects.toMatchObject({ reason: "forbidden" });
  await expect(setProjectMemberRole(projectAdmin, { ...scope, role: "member" }))
    .rejects.toMatchObject({ reason: "forbidden" });
  await setProjectMemberRole(owner, { ...scope, role: "member" });
  await expect(requireProjectMember(db, scope.projectId, USERS.member)).resolves.toMatchObject({
    member: { role: "member" },
  });
  await expect(createStatus(projectAdmin, { projectId: scope.projectId, name: "Planning" }))
    .rejects.toMatchObject({ reason: "forbidden" });
});

it("prevents concurrent reporting changes from creating a cycle", async () => {
  const owner = { db, actorUserId: USERS.owner, source: "web" as const };
  const teamId = "ac-team";
  const outcomes = await Promise.allSettled([
    setReportingLead(owner, { teamId, userId: USERS.member, leadUserId: USERS.projectMember }),
    setReportingLead(owner, { teamId, userId: USERS.projectMember, leadUserId: USERS.member }),
  ]);
  expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
    reason: { message: "This reporting line would create a cycle." },
  });
  expect(await db.select().from(teamReportingLine).where(eq(teamReportingLine.teamId, teamId))).toHaveLength(1);
});

it("keeps a reporting line intact when a form submits an outdated lead", async () => {
  const owner = { db, actorUserId: USERS.owner, source: "web" as const };
  const report = { teamId: "ac-team", userId: USERS.admin };
  const readLine = () => db.select().from(teamReportingLine).where(and(
    eq(teamReportingLine.teamId, report.teamId),
    eq(teamReportingLine.userId, report.userId),
  ));
  const stale = { message: "This reporting line changed. Refresh the page and try again." };

  await setReportingLead(owner, { ...report, leadUserId: USERS.member, expectedLeadUserId: null });
  await expect(setReportingLead(owner, { ...report, leadUserId: USERS.owner, expectedLeadUserId: null }))
    .rejects.toMatchObject(stale);

  await setReportingLead(owner, { ...report, leadUserId: USERS.owner, expectedLeadUserId: USERS.member });
  await expect(setReportingLead(owner, { ...report, leadUserId: USERS.projectMember, expectedLeadUserId: USERS.member }))
    .rejects.toMatchObject(stale);
  await expect(setReportingLead(owner, { ...report, leadUserId: null, expectedLeadUserId: USERS.member }))
    .rejects.toMatchObject(stale);
  expect(await readLine()).toEqual([{ ...report, leadUserId: USERS.owner }]);

  await setReportingLead(owner, { ...report, leadUserId: null, expectedLeadUserId: USERS.owner });
  expect(await readLine()).toEqual([]);
});

it("the role matrix matches PLAN §3", async () => {
  for (const capability of ["team:delete", "project:delete"] as const) {
    expect(can("owner", capability)).toBe(true);
    expect(can("admin", capability)).toBe(false);
    expect(can("member", capability)).toBe(false);
  }

  for (const capability of [
    "team:manage_members",
    "team:change_role",
    "project:create",
    "project:manage_statuses",
    "project:manage_members",
  ] as const) {
    expect([capability, can("owner", capability)]).toEqual([capability, true]);
    expect([capability, can("admin", capability)]).toEqual([capability, true]);
    expect([capability, can("member", capability)]).toEqual([capability, false]);
  }

  expect(() => requireCapability("member", "project:create")).toThrow(
    AccessError,
  );
  expect(() => requireCapability("admin", "team:delete")).toThrowError(
    /cannot perform "team:delete"/,
  );
});
