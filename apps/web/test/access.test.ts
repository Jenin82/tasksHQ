import { env } from "cloudflare:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  AccessError,
  CAPABILITIES,
  can,
  canOrg,
  canProject,
  requireCapability,
  requireTeamMember,
  requireProjectMember,
} from "@tasks/core/access";
import { createStatus, removeTeamMember, removeProjectMember, setProjectMemberRole, setReportingLead } from "@tasks/core/domain";
import {
  orgMember,
  team,
  teamMember,
  reportingLine,
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
  { teamId: "ac-team", userId: USERS.owner, role: "admin", createdAt: now },
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

it("requireProjectMember admits team admins with no project_member row", async () => {
  // §3's rule most likely to be implemented twice and diverge: implicit access
  // for admins is what makes "manage project statuses/members" coherent.
  const rows = await db
    .select()
    .from(projectMember)
    .where(eq(projectMember.projectId, "ac-project"));
  expect(rows.map((r) => r.userId)).toEqual([USERS.projectMember]);

  expect(
    await requireProjectMember(db, "ac-project", USERS.owner),
  ).toMatchObject({ member: { role: "admin" } });
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

// Only org owners and admins manage reporting lines.
const orgAdmin = { db, actorUserId: "ac-org-admin", source: "web" as const };
await db.insert(user).values({ id: orgAdmin.actorUserId, name: "ac-org-admin", email: "ac-org-admin@access.test", createdAt: now, updatedAt: now });
await db.insert(orgMember).values({ userId: orgAdmin.actorUserId, role: "admin", createdAt: now });

it("prevents concurrent reporting changes from creating a cycle", async () => {
  const owner = orgAdmin;
  const outcomes = await Promise.allSettled([
    setReportingLead(owner, { userId: USERS.member, leadUserId: USERS.projectMember }),
    setReportingLead(owner, { userId: USERS.projectMember, leadUserId: USERS.member }),
  ]);
  expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
    reason: { message: "This reporting line would create a cycle." },
  });
  const lines = await db.select().from(reportingLine)
    .where(inArray(reportingLine.userId, [USERS.member, USERS.projectMember]));
  expect(lines).toHaveLength(1);
  await db.delete(reportingLine).where(inArray(reportingLine.userId, [USERS.member, USERS.projectMember]));
});

it("keeps a reporting line intact when a form submits an outdated lead", async () => {
  const owner = orgAdmin;
  const report = { userId: USERS.admin };
  const readLine = () => db.select({ userId: reportingLine.userId, leadUserId: reportingLine.leadUserId })
    .from(reportingLine).where(eq(reportingLine.userId, report.userId));
  const stale = { message: "This reporting line changed. Refresh the page and try again." };

  await setReportingLead(owner, { ...report, leadUserId: USERS.member, expectedLeadUserId: null });
  await expect(setReportingLead(owner, { ...report, leadUserId: USERS.projectMember, expectedLeadUserId: null }))
    .rejects.toMatchObject(stale);

  await setReportingLead(owner, { ...report, leadUserId: USERS.projectMember, expectedLeadUserId: USERS.member });
  await expect(setReportingLead(owner, { ...report, leadUserId: USERS.member, expectedLeadUserId: USERS.member }))
    .rejects.toMatchObject(stale);
  await expect(setReportingLead(owner, { ...report, leadUserId: null, expectedLeadUserId: USERS.member }))
    .rejects.toMatchObject(stale);
  expect(await readLine()).toEqual([{ ...report, leadUserId: USERS.projectMember }]);

  await setReportingLead(owner, { ...report, leadUserId: null, expectedLeadUserId: USERS.projectMember });
  expect(await readLine()).toEqual([]);
});

it("the role matrix matches PLAN §3", async () => {
  // Teams have admins and members only; deleting a team is org-level.
  expect(CAPABILITIES).not.toContain("team:delete");
  expect(canOrg("owner", "org:delete_team")).toBe(true);
  expect(canOrg("admin", "org:delete_team")).toBe(false);
  expect(canOrg("member", "org:delete_team")).toBe(false);

  for (const capability of [
    "project:delete",
    "team:manage_members",
    "team:change_role",
    "project:create",
    "project:manage_statuses",
    "project:manage_members",
  ] as const) {
    expect([capability, can("admin", capability)]).toEqual([capability, true]);
    expect([capability, can("member", capability)]).toEqual([capability, false]);
  }

  expect(() => requireCapability("member", "project:create")).toThrow(
    AccessError,
  );
  expect(() => requireCapability("member", "project:delete")).toThrowError(
    /cannot perform "project:delete"/,
  );
});
