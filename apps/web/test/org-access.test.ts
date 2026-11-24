import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import { AccessError, requireProjectMember, requireTeamMember } from "@tasks/core/access";
import {
  addComment,
  claimInvites,
  createProject,
  createTask,
  createTimeEntry,
  deleteProject,
  deleteTeam,
  getWorkSummaryData,
  inviteToTeam,
  renameProject,
  setProjectTaskEditRestriction,
  startTimer,
  updateTask,
} from "@tasks/core/domain";
import { createTeam } from "./helpers";
import { orgMember, project, team, teamInvite, teamMember, user } from "@tasks/core/schema";
import { WorkspaceAssignmentPage } from "@/app/[team]/(team)/settings/workspace-assignment-page";
import { listUserTeams } from "@/lib/team-context";
import { GET as exportTeamTime } from "@/app/settings/time/export/route";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: actor.id, name: actor.id, email: `${actor.id}@org-access.test` }),
}));

const db = drizzle(env.DB);
const now = new Date();
const ctx = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });

// Storage is shared across the run, so every id and slug here is `oa-`-prefixed.
const OWNER = "oa-team-owner"; // real owner of every team below
const ORG_OWNER = "oa-org-owner"; // org owner, in no team
const ORG_ADMIN = "oa-org-admin"; // org admin, a real member of oa-home only
const ORG_MEMBER = "oa-org-member"; // org member, in no team

await db.insert(user).values([OWNER, ORG_OWNER, ORG_ADMIN, ORG_MEMBER].map((id) => ({
  id, name: id, email: `${id}@org-access.test`, emailVerified: true, createdAt: now, updatedAt: now,
})));
await db.insert(orgMember).values([
  { userId: ORG_OWNER, role: "owner" as const, createdAt: now },
  { userId: ORG_ADMIN, role: "admin" as const, createdAt: now },
  { userId: ORG_MEMBER, role: "member" as const, createdAt: now },
]);

const home = await createTeam(ctx(OWNER), { slug: "oa-home", name: "OA Home" });
const away = await createTeam(ctx(OWNER), { slug: "oa-away", name: "OA Away" });
await db.insert(teamMember).values({ teamId: home.id, userId: ORG_ADMIN, role: "member", createdAt: now });
const awayProject = await createProject(ctx(OWNER), { teamId: away.id, slug: "web", name: "Web", key: "WEB" });
await setProjectTaskEditRestriction(ctx(OWNER), { projectId: awayProject.id, restricted: true });
const awayTask = await createTask(ctx(OWNER), { projectId: awayProject.id, title: "Restricted task" });

it("gives org owners and admins implicit team access, and org members none", async () => {
  expect(await requireTeamMember(db, away.id, ORG_ADMIN)).toEqual({
    teamId: away.id, userId: ORG_ADMIN, role: "admin", implicit: true,
  });
  // Org owners and admins alike are implicit team admins.
  expect(await requireTeamMember(db, away.id, ORG_OWNER)).toMatchObject({ role: "admin", implicit: true });
  // A real membership keeps implicit false and takes the higher org role.
  expect(await requireTeamMember(db, home.id, ORG_ADMIN)).toMatchObject({ role: "admin", implicit: false });
  expect(await requireTeamMember(db, away.id, OWNER)).toMatchObject({ role: "admin", implicit: false });

  const opened = await requireProjectMember(db, awayProject.id, ORG_ADMIN);
  expect(opened.project.id).toBe(awayProject.id);
  expect(opened.member).toMatchObject({ role: "admin", implicit: true });

  await expect(requireTeamMember(db, away.id, ORG_MEMBER)).rejects.toMatchObject({ reason: "not_a_member" });
  await expect(requireProjectMember(db, awayProject.id, ORG_MEMBER)).rejects.toMatchObject({ reason: "not_a_member" });
  await expect(requireTeamMember(db, "oa-missing", ORG_OWNER)).rejects.toMatchObject({ reason: "not_a_member" });
});

it("lets an implicit admin edit restricted tasks, comment, and change project settings", async () => {
  const edited = await updateTask(ctx(ORG_ADMIN), { projectId: awayProject.id, taskId: awayTask.id, title: "Edited by org admin" });
  expect(edited.title).toBe("Edited by org admin");

  const added = await addComment(ctx(ORG_ADMIN), { projectId: awayProject.id, taskId: awayTask.id, body: "Looks good" });
  expect(added.userId).toBe(ORG_ADMIN);

  await setProjectTaskEditRestriction(ctx(ORG_ADMIN), { projectId: awayProject.id, restricted: false });
  await setProjectTaskEditRestriction(ctx(ORG_ADMIN), { projectId: awayProject.id, restricted: true });
  const [row] = await db.select({ restricted: project.restrictTaskEdits }).from(project).where(eq(project.id, awayProject.id));
  expect(row.restricted).toBe(true);
  await renameProject(ctx(ORG_ADMIN), { projectId: awayProject.id, name: "Web App", slug: "web" });

  await expect(updateTask(ctx(ORG_MEMBER), { projectId: awayProject.id, taskId: awayTask.id, title: "Nope" }))
    .rejects.toBeInstanceOf(AccessError);
});

it("gives an implicit admin the team's time report and a work summary of their tasks", async () => {
  actor.id = ORG_ADMIN;
  const response = await exportTeamTime(new Request("http://local/settings/time/export?team=oa-away&week=2026-03-02"));
  expect(response.status).toBe(200);

  // They commented on awayTask above.
  const summary = await getWorkSummaryData(ctx(ORG_ADMIN), {
    teamId: away.id, from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 60_000),
  });
  expect(summary.totalMinutes).toBe(0);
  expect(summary.tasks).toEqual([expect.objectContaining({ key: "WEB-1", minutes: 0, comments: [expect.anything()] })]);
});

it("keeps implicit admins out of assignment, mentions, and time tracking", async () => {
  await expect(updateTask(ctx(OWNER), { projectId: awayProject.id, taskId: awayTask.id, assigneeUserId: ORG_ADMIN }))
    .rejects.toThrow("That user must be a member of this team.");
  const body = `@${ORG_ADMIN} hi`;
  await expect(addComment(ctx(OWNER), {
    projectId: awayProject.id, taskId: awayTask.id, body,
    mentions: [{ userId: ORG_ADMIN, start: 0, end: ORG_ADMIN.length + 1 }],
  })).rejects.toThrow("Choose people from the mention list again.");

  await expect(startTimer(ctx(ORG_ADMIN), { projectId: awayProject.id, taskId: awayTask.id }))
    .rejects.toThrow("Join this team to track time.");
  await expect(createTimeEntry(ctx(ORG_ADMIN), {
    projectId: awayProject.id, taskId: awayTask.id,
    startedAt: new Date(Date.now() - 60 * 60_000), endedAt: new Date(Date.now() - 30 * 60_000),
  })).rejects.toThrow("Join this team to track time.");
});

it("lists every team for an org admin, but All My Tasks counts only real teams", async () => {
  const teams = await listUserTeams(ORG_ADMIN);
  expect(teams).toEqual(expect.arrayContaining([
    expect.objectContaining({ slug: "oa-home", role: "admin", implicit: false }),
    expect.objectContaining({ slug: "oa-away", role: "admin", implicit: true }),
  ]));
  expect(await listUserTeams(ORG_MEMBER)).toEqual([]);

  // One real team, so All My Tasks sends the org admin back to Your Tasks.
  actor.id = ORG_ADMIN;
  await expect(WorkspaceAssignmentPage({ teamSlug: "oa-home", view: "mine", allTeams: true }))
    .rejects.toMatchObject({ digest: expect.stringContaining("%2Foa-home%2Fsettings%2Fyour-tasks") });
});

it("makes an org admin's team invites claimable, admin grants included", async () => {
  await inviteToTeam(ctx(ORG_ADMIN), { teamId: away.id, email: "oa-invitee@org-access.test", role: "member" });
  await inviteToTeam(ctx(ORG_ADMIN), { teamId: away.id, email: "oa-granted@org-access.test", role: "admin" });
  // An invite from someone who no longer manages the team is not claimable.
  await db.insert(teamInvite).values(
    { teamId: away.id, email: "oa-stale@org-access.test", role: "admin", invitedByUserId: ORG_MEMBER, createdAt: now, acceptedAt: null },
  );
  const invitees = ["oa-invitee", "oa-stale", "oa-granted"];
  await db.insert(user).values(invitees.map((id) => ({
    id, name: id, email: `${id}@org-access.test`, emailVerified: true, createdAt: now, updatedAt: now,
  })));
  for (const id of invitees) await claimInvites(db, id, `${id}@org-access.test`);

  const roleOf = async (teamId: string, userId: string) => (await db.select({ role: teamMember.role }).from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId))))[0]?.role ?? null;
  expect(await roleOf(away.id, "oa-invitee")).toBe("member");
  expect(await roleOf(away.id, "oa-stale")).toBeNull();
  expect(await roleOf(away.id, "oa-granted")).toBe("admin");
});

it("lets org owners and admins delete projects, but only org owners delete teams", async () => {
  const doomed = await createTeam(ctx(OWNER), { slug: "oa-doomed", name: "OA Doomed" });
  const doomedProject = await createProject(ctx(OWNER), { teamId: doomed.id, slug: "gone", name: "Gone", key: "GON" });
  await createProject(ctx(OWNER), { teamId: doomed.id, slug: "also", name: "Also", key: "ALS" });

  await expect(deleteTeam(ctx(ORG_ADMIN), { teamId: doomed.id, confirmation: doomed.slug }))
    .rejects.toMatchObject({ reason: "forbidden" });
  await deleteProject(ctx(ORG_ADMIN), { projectId: doomedProject.id, confirmation: "gone" });
  expect(await db.select().from(project).where(eq(project.id, doomedProject.id))).toEqual([]);

  await deleteTeam(ctx(ORG_OWNER), { teamId: doomed.id, confirmation: doomed.slug });
  expect(await db.select().from(team).where(eq(team.id, doomed.id))).toEqual([]);
  expect(await db.select().from(teamMember).where(eq(teamMember.teamId, doomed.id))).toEqual([]);
  expect(await db.select().from(project).where(eq(project.teamId, doomed.id))).toEqual([]);
});
