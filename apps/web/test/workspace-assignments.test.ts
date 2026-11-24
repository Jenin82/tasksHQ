import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { requireProjectMember } from "@tasks/core/access";
import {
  archiveTask,
  createProject,
  createTask,
  listWorkspaceAssignments,
  updateTask,
} from "@tasks/core/domain";
import { createTeam } from "./helpers";
import { teamMember, user } from "@tasks/core/schema";

it("lists active tasks assigned to and by the viewer in one team", async () => {
  const db = drizzle(env.DB);
  const now = new Date();
  const ownerId = "assignments-owner";
  const leadId = "assignments-lead";
  const reportId = "assignments-report";
  const indirectId = "assignments-indirect";
  await db.insert(user).values([ownerId, leadId, reportId, indirectId].map((id) => ({
    id, name: id, email: `${id}@tasks.test`, createdAt: now, updatedAt: now,
  })));

  const owner = { db, actorUserId: ownerId, source: "web" as const };
  const lead = { ...owner, actorUserId: leadId };
  const team = await createTeam(owner, { name: "Assignments", slug: "assignments" });
  const other = await createTeam(owner, { name: "Other assignments", slug: "other-assignments" });
  await db.insert(teamMember).values([
    ...[leadId, reportId, indirectId].map((userId) => ({
      teamId: team.id, userId, role: "member" as const, createdAt: now,
    })),
    { teamId: other.id, userId: leadId, role: "member", createdAt: now },
  ]);
  const makeProject = (key: string, teamId = team.id) =>
    createProject(owner, { teamId, name: key, slug: key.toLowerCase(), key });
  const directProject = await makeProject("REP");
  const indirectProject = await makeProject("IND");
  const personalProject = await makeProject("MINE");
  const otherProject = await makeProject("OUT", other.id);
  await expect(requireProjectMember(db, directProject.id, leadId)).resolves.toMatchObject({ projectRole: null });

  const addTask = (projectId: string, assigneeUserId: string, title: string) =>
    createTask(owner, { projectId, assigneeUserId, title });
  await addTask(directProject.id, reportId, "Assigned by the owner");
  await addTask(indirectProject.id, indirectId, "Someone else's assignment");
  const archived = await addTask(personalProject.id, leadId, "Archived assignment");
  await archiveTask(owner, { taskId: archived.id });
  const personal = await addTask(personalProject.id, leadId, "Personal assignment");
  await addTask(otherProject.id, leadId, "Outside this workspace");

  expect(await listWorkspaceAssignments(lead, { teamId: team.id, view: "mine" }))
    .toMatchObject([{ id: personal.id, projectName: "MINE" }]);

  const leadAssignedAtCreation = await createTask(lead, {
    projectId: directProject.id,
    assigneeUserId: reportId,
    title: "Assigned by the lead at creation",
  });
  const leadReassigned = await createTask(owner, {
    projectId: directProject.id,
    title: "Reassigned by the lead",
  });
  await updateTask(lead, { taskId: leadReassigned.id, assigneeUserId: reportId });
  const selfAssigned = await createTask(lead, {
    projectId: personalProject.id,
    assigneeUserId: leadId,
    title: "Assigned to myself",
  });
  const assignedByLead = async () => (await listWorkspaceAssignments(lead, {
    teamId: team.id,
    view: "assigned",
  })).map(({ id }) => id).sort();

  expect(await assignedByLead()).toEqual([leadAssignedAtCreation.id, leadReassigned.id].sort());
  expect(await listWorkspaceAssignments(lead, { teamId: team.id, view: "mine" }))
    .toEqual(expect.arrayContaining([expect.objectContaining({ id: selfAssigned.id })]));

  await updateTask(owner, { taskId: leadReassigned.id, title: "Renamed by the owner" });
  expect(await assignedByLead()).toEqual([leadAssignedAtCreation.id, leadReassigned.id].sort());
  await updateTask(owner, { taskId: leadReassigned.id, assigneeUserId: ownerId });
  await updateTask(owner, { taskId: leadReassigned.id, assigneeUserId: reportId });
  expect(await assignedByLead()).toEqual([leadAssignedAtCreation.id]);
  await updateTask(owner, { taskId: leadAssignedAtCreation.id, assigneeUserId: null });
  expect(await assignedByLead()).toEqual([]);

  await expect(addTask(directProject.id, leadId, "Lead assignment")).resolves.toMatchObject({ assignee: { id: leadId } });
});
