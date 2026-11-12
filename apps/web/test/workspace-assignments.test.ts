import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { requireProjectMember } from "@tasks/core/access";
import {
  archiveTask,
  createOrg,
  createProject,
  createTask,
  listWorkspaceAssignments,
  setReportingLead,
  updateTask,
} from "@tasks/core/domain";
import { orgMember, user } from "@tasks/core/schema";

it("uses organization access and limits team assignments to direct reports", async () => {
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
  const org = await createOrg(owner, { name: "Assignments", slug: "assignments" });
  const other = await createOrg(owner, { name: "Other assignments", slug: "other-assignments" });
  await db.insert(orgMember).values([
    ...[leadId, reportId, indirectId].map((userId) => ({
      orgId: org.id, userId, role: "member" as const, createdAt: now,
    })),
    { orgId: other.id, userId: leadId, role: "member", createdAt: now },
  ]);
  const makeProject = (key: string, orgId = org.id) =>
    createProject(owner, { orgId, name: key, slug: key.toLowerCase(), key });
  const directProject = await makeProject("REP");
  const indirectProject = await makeProject("IND");
  const personalProject = await makeProject("MINE");
  const otherProject = await makeProject("OUT", other.id);
  await expect(requireProjectMember(db, directProject.id, leadId)).resolves.toMatchObject({ projectRole: null });
  await setReportingLead(owner, { orgId: org.id, userId: reportId, leadUserId: leadId });
  await setReportingLead(owner, { orgId: org.id, userId: indirectId, leadUserId: reportId });
  await expect(requireProjectMember(db, directProject.id, leadId)).resolves.toMatchObject({ projectRole: null });
  await expect(requireProjectMember(db, indirectProject.id, leadId)).resolves.toMatchObject({ projectRole: null });

  const addTask = (projectId: string, assigneeUserId: string, title: string) =>
    createTask(owner, { projectId, assigneeUserId, title });
  const reportTask = await addTask(directProject.id, reportId, "Assigned by the owner");
  const archived = await addTask(directProject.id, reportId, "Archived report assignment");
  await archiveTask(owner, { taskId: archived.id });
  await addTask(indirectProject.id, indirectId, "Indirect report assignment");
  const personal = await addTask(personalProject.id, leadId, "Personal assignment");
  await addTask(otherProject.id, leadId, "Outside this workspace");

  expect(await listWorkspaceAssignments(lead, { orgId: org.id, view: "team" }))
    .toMatchObject([{ id: reportTask.id, projectName: "REP", projectSlug: "rep" }]);
  expect(await listWorkspaceAssignments(lead, { orgId: org.id, view: "mine" }))
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
    orgId: org.id,
    view: "assigned",
  })).map(({ id }) => id).sort();

  expect(await assignedByLead()).toEqual([leadAssignedAtCreation.id, leadReassigned.id].sort());
  expect(await listWorkspaceAssignments(lead, { orgId: org.id, view: "mine" }))
    .toEqual(expect.arrayContaining([expect.objectContaining({ id: selfAssigned.id })]));

  await updateTask(owner, { taskId: leadReassigned.id, title: "Renamed by the owner" });
  expect(await assignedByLead()).toEqual([leadAssignedAtCreation.id, leadReassigned.id].sort());
  await updateTask(owner, { taskId: leadReassigned.id, assigneeUserId: ownerId });
  await updateTask(owner, { taskId: leadReassigned.id, assigneeUserId: reportId });
  expect(await assignedByLead()).toEqual([leadAssignedAtCreation.id]);
  await updateTask(owner, { taskId: leadAssignedAtCreation.id, assigneeUserId: null });
  expect(await assignedByLead()).toEqual([]);

  await expect(addTask(directProject.id, leadId, "Lead assignment")).resolves.toMatchObject({ assignee: { id: leadId } });
  await setReportingLead(owner, { orgId: org.id, userId: reportId, leadUserId: null });
  await expect(requireProjectMember(db, directProject.id, leadId)).resolves.toMatchObject({ projectRole: null });
  expect(await listWorkspaceAssignments(lead, { orgId: org.id, view: "team" })).toEqual([]);
});
