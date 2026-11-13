import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  archiveTask,
  createOrg,
  createProject,
  createTask,
  deleteArchivedTask,
  findMovedTaskByKey,
  getTaskDetail,
  moveTask,
  setProjectMemberRole,
  setProjectTaskEditRestriction,
  transferTask,
  unarchiveTask,
  updateTask,
} from "@tasks/core/domain";
import { mailOutbox, orgMember, status, taskShare, user } from "@tasks/core/schema";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({ id: actor.id, name: actor.id, email: `${actor.id}@edit.test` });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const { default: SettingsPage } = await import("@/app/[org]/[project]/settings/page");
const { setProjectTaskEditRestrictionAction } = await import("@/app/[org]/[project]/settings/actions");
const { addCommentAction, editTaskAction } = await import("@/app/[org]/[project]/[task]/actions");
const { createTaskShareLink } = await import("@/app/[org]/[project]/[task]/share-task-action");
const { TaskDetailContent } = await import("@/app/[org]/[project]/[task]/task-detail-content");
const { readTaskDetail } = await import("@/app/[org]/[project]/[task]/task-detail-data");

const db = drizzle(env.DB);
const ownerId = "edit-owner";
const adminId = "edit-admin";
const projectAdminId = "edit-project-admin";
const assigneeId = "edit-assignee";
const readerId = "edit-reader";
const outsiderId = "edit-outsider";
await db.insert(user).values([ownerId, adminId, projectAdminId, assigneeId, readerId, outsiderId].map((id) => ({
  id,
  name: id.toUpperCase(),
  email: `${id}@edit.test`,
})));

const ctx = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });
const owner = ctx(ownerId);
const workspace = await createOrg(owner, { slug: "edit-policy", name: "Edit policy" });
await db.insert(orgMember).values([adminId, projectAdminId, assigneeId, readerId].map((userId) => ({
  orgId: workspace.id,
  userId,
  role: userId === adminId ? "admin" as const : "member" as const,
  createdAt: new Date(),
})));
const makeProject = (slug: string, key: string) => createProject(owner, {
  orgId: workspace.id,
  slug,
  key,
  name: slug,
});
const forbidEdit = { reason: "forbidden", message: "Only the creator, reporter, current assignee, or an admin can edit this task." };
const restrict = (projectId: string) => setProjectTaskEditRestriction(owner, { projectId, restricted: true });

it("lets admins edit unrelated tasks with the setting on, scoped to the projects they administer", async () => {
  const project = await makeProject("project-policy", "EDT");
  const neighbor = await makeProject("neighbor", "EDN");
  const original = await createTask(owner, { projectId: project.id, title: "Original title" });
  const other = await createTask(owner, { projectId: neighbor.id, title: "Other project" });
  await setProjectMemberRole(owner, { projectId: project.id, userId: projectAdminId, role: "admin" });
  const renderSettings = async () => renderToStaticMarkup(await SettingsPage({
    params: Promise.resolve({ org: workspace.slug, project: project.slug }),
  }));
  const submit = (restricted: boolean) => {
    const form = new FormData();
    form.set("restricted", String(restricted));
    return setProjectTaskEditRestrictionAction(workspace.slug, project.slug, {}, form);
  };

  actor.id = projectAdminId;
  expect(await renderSettings()).toContain('role="switch" aria-checked="false"');
  expect(await updateTask(ctx(readerId), { taskId: original.id, title: "Open edit" }))
    .toMatchObject({ title: "Open edit" });
  actor.id = readerId;
  await expect(submit(true)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
  actor.id = projectAdminId;
  await expect(submit(true)).resolves.toEqual({});
  expect(await renderSettings()).toContain('role="switch" aria-checked="true"');
  await expect(updateTask(ctx(readerId), { taskId: original.id, title: "Denied edit" })).rejects.toMatchObject(forbidEdit);
  for (const userId of [projectAdminId, adminId]) {
    actor.id = userId;
    await expect(readTaskDetail(workspace.slug, project.slug, original.key)).resolves.toMatchObject({ canEdit: true });
    await expect(updateTask(ctx(userId), { taskId: original.id, title: `${userId} edit` }))
      .resolves.toMatchObject({ title: `${userId} edit` });
  }
  const memberTask = await createTask(ctx(readerId), { projectId: project.id, title: "Member task" });
  await expect(updateTask(owner, { taskId: memberTask.id, title: "Owner edit" }))
    .resolves.toMatchObject({ title: "Owner edit" });
  await expect(updateTask(ctx(readerId), { taskId: other.id, title: "Still open" }))
    .resolves.toMatchObject({ title: "Still open" });
  await restrict(neighbor.id);
  actor.id = projectAdminId;
  await expect(readTaskDetail(workspace.slug, neighbor.slug, other.key)).resolves.toMatchObject({ canEdit: false });
  await expect(updateTask(ctx(projectAdminId), { taskId: other.id, title: "Out of scope edit" }))
    .rejects.toMatchObject(forbidEdit);
  await expect(submit(false)).resolves.toEqual({});
  await expect(updateTask(ctx(readerId), { taskId: original.id, title: "Open again" }))
    .resolves.toMatchObject({ title: "Open again" });
});

it("keeps read and comment access while checking current assignment for task mutations", async () => {
  const project = await makeProject("lifecycle", "EDL");
  const destination = await makeProject("destination", "EDD");
  const original = await createTask(owner, {
    projectId: project.id,
    title: "Task for its participants",
    description: "**Readable description**",
    assigneeUserId: assigneeId,
  });
  const target = { taskId: original.id };
  const [done] = await db.select().from(status).where(and(eq(status.projectId, project.id), eq(status.name, "Done")));
  await restrict(project.id);

  const reader = ctx(readerId);
  await expect(moveTask(reader, { ...target, statusId: done.id, afterTaskId: null })).rejects.toMatchObject(forbidEdit);
  await expect(transferTask(reader, {
    ...target,
    sourceProjectId: project.id,
    destinationProjectId: destination.id,
  })).rejects.toMatchObject(forbidEdit);
  await expect(archiveTask(reader, target)).rejects.toMatchObject(forbidEdit);
  await expect(getTaskDetail(ctx(outsiderId), target)).rejects.toMatchObject({ reason: "not_a_member" });
  await expect(createTask(reader, { projectId: project.id, title: "A member's new task" }))
    .resolves.toMatchObject({ createdBy: { id: readerId } });

  actor.id = readerId;
  const form = new FormData();
  form.set("org", workspace.slug);
  form.set("project", project.slug);
  form.set("taskId", original.id);
  form.set("title", "Direct action edit");
  await expect(editTaskAction({}, form)).resolves.toMatchObject({ error: forbidEdit.message });
  form.set("body", "Reviewer's comment");
  await expect(addCommentAction({}, form)).resolves.toEqual({});
  const readerDetail = await readTaskDetail(workspace.slug, project.slug, original.key);
  expect(readerDetail).toMatchObject({ canEdit: false, detail: { description: "**Readable description**" } });
  const html = renderToStaticMarkup(<TaskDetailContent data={readerDetail} inDialog />);
  expect(html).toContain(original.title);
  expect(html).toContain('role="region" aria-label="Description"');
  expect(html).toContain("Reviewer&#x27;s comment");
  expect(html).toContain(">Comment</button>");
  expect(html).not.toContain('aria-label="Task title"');
  expect(html).not.toContain(">Archive</button>");

  const assignee = ctx(assigneeId);
  await expect(updateTask(assignee, { ...target, title: "Assignee edit", assigneeUserId: null }))
    .resolves.toMatchObject({ title: "Assignee edit", assignee: null });
  expect((await getTaskDetail(reader, target)).activity).toContainEqual(expect.objectContaining({
    type: "task.updated",
    actor: expect.objectContaining({ id: assigneeId }),
    data: expect.objectContaining({ fields: expect.objectContaining({
      assignee: { from: { id: assigneeId, displayName: assigneeId.toUpperCase() }, to: null },
    }) }),
  }));
  await expect(updateTask(assignee, { ...target, title: "Former assignee edit" })).rejects.toMatchObject(forbidEdit);

  await expect(updateTask(owner, { ...target, title: "Creator edit" })).resolves.toMatchObject({ title: "Creator edit" });
  await setProjectMemberRole(owner, { projectId: project.id, userId: projectAdminId, role: "admin" });
  await archiveTask(ctx(projectAdminId), target);
  await expect(unarchiveTask(reader, target)).rejects.toMatchObject(forbidEdit);
  const deletion = { ...target, projectId: project.id, confirmation: original.key };
  await expect(deleteArchivedTask(ctx(projectAdminId), deletion)).rejects.toMatchObject({
    reason: "forbidden", message: 'A member cannot perform "task:delete_archived".',
  });
  expect((await getTaskDetail(reader, target)).comments).toHaveLength(1);
  await expect(unarchiveTask(ctx(projectAdminId), target)).resolves.toMatchObject({ archivedAt: null });
  await archiveTask(owner, target);
  await deleteArchivedTask(ctx(adminId), deletion);
  await expect(getTaskDetail(reader, target)).rejects.toMatchObject({ reason: "not_a_member" });
});

it("lets the reporter edit a restricted task that a plain member cannot", async () => {
  const project = await makeProject("reporter-policy", "EDP");
  const reported = await createTask(owner, { projectId: project.id, title: "Reported", reporterUserId: readerId });
  await restrict(project.id);

  actor.id = readerId;
  await expect(readTaskDetail(workspace.slug, project.slug, reported.key)).resolves.toMatchObject({ canEdit: true });
  await expect(updateTask(ctx(readerId), { taskId: reported.id, title: "Reporter edit" }))
    .resolves.toMatchObject({ title: "Reporter edit" });
  actor.id = assigneeId;
  await expect(readTaskDetail(workspace.slug, project.slug, reported.key)).resolves.toMatchObject({ canEdit: false });
  await expect(updateTask(ctx(assigneeId), { taskId: reported.id, title: "Member edit" })).rejects.toMatchObject(forbidEdit);

  // Handing the reporter role on moves the edit right with it.
  await updateTask(ctx(readerId), { taskId: reported.id, reporterUserId: assigneeId });
  await expect(updateTask(ctx(assigneeId), { taskId: reported.id, title: "New reporter edit" }))
    .resolves.toMatchObject({ title: "New reporter edit" });
  await expect(updateTask(ctx(readerId), { taskId: reported.id, title: "Former reporter edit" }))
    .rejects.toMatchObject(forbidEdit);
});

it("rejects a transfer if the setting changes during preparation", async () => {
  const project = await makeProject("race-source", "EDR");
  const destination = await makeProject("race-target", "EDTGT");
  const original = await createTask(owner, {
    projectId: project.id, title: "Pending transfer", description: "Original description",
  });
  const target = { taskId: original.id };
  const reader = ctx(readerId);
  const before = await getTaskDetail(reader, target);

  await expect(transferTask(reader, {
    ...target,
    sourceProjectId: project.id,
    destinationProjectId: destination.id,
  }, async () => {
    await restrict(project.id);
    return "Prepared description";
  })).rejects.toMatchObject(forbidEdit);

  await expect(getTaskDetail(reader, target)).resolves.toEqual(before);
  await expect(findMovedTaskByKey(reader, { projectId: project.id, key: original.key })).resolves.toBeNull();
});

it("rejects a write if assignment changes after reading it and skips edit side effects", async () => {
  const project = await makeProject("race-edit", "EDW");
  const original = await createTask(owner, {
    projectId: project.id, title: "Pending edit", assigneeUserId: assigneeId,
  });
  const target = { taskId: original.id };
  await restrict(project.id);

  const racingDb = drizzle(env.DB);
  const batch = racingDb.batch.bind(racingDb);
  const intercepted = vi.spyOn(racingDb, "batch").mockImplementation(async (queries) => {
    await updateTask(owner, { ...target, assigneeUserId: null });
    return batch(queries);
  });
  await expect(updateTask({ ...ctx(assigneeId), db: racingDb, emailNotifications: true }, {
    ...target,
    title: "Stale edit",
    assigneeUserId: readerId,
  })).rejects.toMatchObject(forbidEdit);
  expect(intercepted).toHaveBeenCalledTimes(1);
  const after = await getTaskDetail(owner, target);
  expect(after).toMatchObject({ title: original.title, assignee: null });
  expect(after.activity).toEqual([expect.objectContaining({ type: "task.created" })]);
  expect(await db.select().from(mailOutbox).where(eq(mailOutbox.targetId, original.id))).toEqual([]);
});

it("rejects a pending edit if the project admin loses their role before the write", async () => {
  const project = await makeProject("race-admin", "EDA");
  const original = await createTask(owner, { projectId: project.id, title: "Pending admin edit" });
  const target = { taskId: original.id };
  const role = { projectId: project.id, userId: projectAdminId };
  await restrict(project.id);
  await setProjectMemberRole(owner, { ...role, role: "admin" });
  const before = await getTaskDetail(owner, target);

  const racingDb = drizzle(env.DB);
  const batch = racingDb.batch.bind(racingDb);
  vi.spyOn(racingDb, "batch").mockImplementationOnce(async (queries) => {
    await setProjectMemberRole(owner, { ...role, role: "member" });
    return batch(queries);
  });
  await expect(updateTask({ ...ctx(projectAdminId), db: racingDb }, { ...target, title: "Stale admin edit" }))
    .rejects.toMatchObject(forbidEdit);
  await expect(getTaskDetail(owner, target)).resolves.toEqual(before);
});

it("copies the task link for a reader without publishing its preview", async () => {
  const project = await makeProject("share", "EDS");
  const original = await createTask(owner, { projectId: project.id, title: "Participant preview" });
  await restrict(project.id);
  const input = { orgSlug: workspace.slug, projectSlug: project.slug, taskKey: original.key };
  const link = { ok: true, path: `/${workspace.slug}/${project.slug}/${original.key}` };
  const shares = () => db.select().from(taskShare).where(eq(taskShare.taskId, original.id));

  actor.id = readerId;
  await expect(createTaskShareLink(input)).resolves.toEqual(link);
  await expect(shares()).resolves.toEqual([]);

  await setProjectMemberRole(owner, { projectId: project.id, userId: projectAdminId, role: "admin" });
  actor.id = projectAdminId;
  await expect(createTaskShareLink(input)).resolves.toEqual(link);
  await expect(shares()).resolves.toEqual([expect.objectContaining({ canonicalPreview: true })]);
});
