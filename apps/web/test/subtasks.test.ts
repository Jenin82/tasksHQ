import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import {
  archiveTask,
  createOrg,
  createProject,
  createTask,
  deleteArchivedTask,
  deleteOrg,
  deleteProject,
  getTaskByKey,
  getTaskDetail,
  listTasks,
  setProjectTaskEditRestriction,
  transferTask,
  updateTask,
} from "@tasks/core/domain";
import { isTaskParentError } from "@tasks/core/errors";
import { orgMember, task, user } from "@tasks/core/schema";
import { readFilters } from "@/components/use-saved-task-filters";

const db = drizzle(env.DB);
const ownerId = "sub-owner";
const memberId = "sub-member";
await db.insert(user).values([ownerId, memberId].map((id) => ({
  id,
  name: id.toUpperCase(),
  email: `${id}@subtasks.test`,
})));

const ctx = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });
const owner = ctx(ownerId);
const member = ctx(memberId);
const workspace = await createOrg(owner, { slug: "subtasks", name: "Subtasks" });
await db.insert(orgMember).values({ orgId: workspace.id, userId: memberId, role: "member", createdAt: new Date() });
const makeProject = (slug: string, key: string) => createProject(owner, {
  orgId: workspace.id,
  slug,
  key,
  name: slug,
});
const forbidEdit = { reason: "forbidden", message: "Only the creator, reporter, current assignee, or an admin can edit this task." };
const forbidParent = { reason: "forbidden", message: "You need edit access to the parent task to add sub-tasks to it." };

async function expectTriggerRejects(write: Promise<unknown>) {
  const error = await write.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  expect(isTaskParentError(error)).toBe(true);
}

it("links sub-tasks to a parent in list, detail and creation activity", async () => {
  const project = await makeProject("links", "SUB");
  const parent = await createTask(owner, { projectId: project.id, title: "Parent" });
  const first = await createTask(owner, { projectId: project.id, title: "First child", parentTaskId: parent.id });
  const second = await createTask(owner, { projectId: project.id, title: "Second child", parentTaskId: parent.id });

  expect(first.parent).toEqual({ id: parent.id, key: parent.key, title: "Parent" });
  const listed = await listTasks(owner, { projectId: project.id });
  expect(listed.find((t) => t.id === parent.id)?.parent).toBeNull();
  for (const child of [first, second]) {
    expect(listed.find((t) => t.id === child.id)?.parent).toEqual({ id: parent.id, key: parent.key, title: "Parent" });
  }

  const byKey = await getTaskByKey(owner, { projectId: project.id, key: parent.key });
  expect(byKey.subtasks.map((t) => t.id)).toEqual([first.id, second.id]);
  expect(byKey.subtasks.map((t) => t.number)).toEqual([first.number, second.number]);
  expect(byKey.subtasks[0]).not.toHaveProperty("description");
  const detail = await getTaskDetail(owner, { taskId: parent.id });
  expect(detail.subtasks.map((t) => t.title)).toEqual(["First child", "Second child"]);
  expect((await getTaskDetail(owner, { taskId: first.id })).subtasks).toEqual([]);

  const childHistory = await getTaskDetail(owner, { taskId: first.id });
  const created = childHistory.activity.find((entry) => entry.type === "task.created");
  expect(created?.data).toMatchObject({ title: "First child", parent: { id: parent.id, key: parent.key } });
  const parentCreated = detail.activity.find((entry) => entry.type === "task.created");
  expect(parentCreated?.data).not.toHaveProperty("parent");
});

it("rejects invalid parents in the domain with readable messages", async () => {
  const project = await makeProject("rules", "RUL");
  const other = await makeProject("rules-other", "RUO");
  const parent = await createTask(owner, { projectId: project.id, title: "Parent" });
  const child = await createTask(owner, { projectId: project.id, title: "Child", parentTaskId: parent.id });
  const elsewhere = await createTask(owner, { projectId: other.id, title: "Elsewhere" });
  const loose = await createTask(owner, { projectId: project.id, title: "Loose" });

  await expect(createTask(owner, { projectId: project.id, title: "Cross", parentTaskId: elsewhere.id }))
    .rejects.toThrow("No such parent task in this project.");
  await expect(createTask(owner, { projectId: project.id, title: "Nested", parentTaskId: child.id }))
    .rejects.toThrow("A sub-task cannot have its own sub-tasks.");
  await expect(updateTask(owner, { taskId: loose.id, parentTaskId: loose.id }))
    .rejects.toThrow("A task cannot be its own parent.");
  await expect(updateTask(owner, { taskId: loose.id, parentTaskId: child.id }))
    .rejects.toThrow("A sub-task cannot have its own sub-tasks.");
  await expect(updateTask(owner, { taskId: parent.id, parentTaskId: loose.id }))
    .rejects.toThrow("A task with sub-tasks cannot become a sub-task.");

  const archived = await createTask(owner, { projectId: project.id, title: "Archived parent" });
  await archiveTask(owner, { taskId: archived.id });
  await expect(createTask(owner, { projectId: project.id, title: "Under archived", parentTaskId: archived.id }))
    .rejects.toThrow("Restore the parent task before adding sub-tasks to it.");
  await expect(updateTask(owner, { taskId: loose.id, parentTaskId: archived.id }))
    .rejects.toThrow("Restore the parent task before adding sub-tasks to it.");

  expect((await getTaskDetail(owner, { taskId: loose.id })).parent).toBeNull();
  expect((await getTaskDetail(owner, { taskId: parent.id })).parent).toBeNull();
});

it("backs the domain rules with database triggers", async () => {
  const project = await makeProject("triggers", "TRG");
  const other = await makeProject("triggers-other", "TRO");
  const parent = await createTask(owner, { projectId: project.id, title: "Parent" });
  const child = await createTask(owner, { projectId: project.id, title: "Child", parentTaskId: parent.id });
  const loose = await createTask(owner, { projectId: project.id, title: "Loose" });
  const elsewhere = await createTask(owner, { projectId: other.id, title: "Elsewhere" });
  const [template] = await db.select().from(task).where(eq(task.id, loose.id));
  const now = new Date();
  const raw = (values: Partial<typeof template>) => db.insert(task).values({
    ...template, id: crypto.randomUUID(), number: 900 + Math.floor(Math.random() * 1000), createdAt: now, updatedAt: now, ...values,
  });

  await expectTriggerRejects(raw({ parentTaskId: child.id }));
  await expectTriggerRejects(raw({ parentTaskId: elsewhere.id }));
  const selfId = crypto.randomUUID();
  await expectTriggerRejects(raw({ id: selfId, parentTaskId: selfId }));

  await expectTriggerRejects(db.update(task).set({ parentTaskId: child.id }).where(eq(task.id, loose.id)));
  await expectTriggerRejects(db.update(task).set({ parentTaskId: elsewhere.id }).where(eq(task.id, loose.id)));
  await expectTriggerRejects(db.update(task).set({ parentTaskId: loose.id }).where(eq(task.id, parent.id)));
  await expectTriggerRejects(db.update(task).set({ projectId: other.id }).where(eq(task.id, child.id)));
  await expectTriggerRejects(db.update(task).set({ projectId: other.id }).where(eq(task.id, parent.id)));

  // A valid raw link still passes.
  await db.update(task).set({ parentTaskId: parent.id }).where(eq(task.id, loose.id));
  const [linked] = await db.select({ parentTaskId: task.parentTaskId }).from(task).where(eq(task.id, loose.id));
  expect(linked.parentTaskId).toBe(parent.id);
});

it("clears a parent and records the change", async () => {
  const project = await makeProject("clear", "CLR");
  const parent = await createTask(owner, { projectId: project.id, title: "Parent" });
  const child = await createTask(owner, { projectId: project.id, title: "Child", parentTaskId: parent.id });

  // Another actor stays outside the creator's five-minute setup grouping.
  const cleared = await updateTask(member, { taskId: child.id, parentTaskId: null });
  expect(cleared.parent).toBeNull();
  const history = await getTaskDetail(owner, { taskId: child.id });
  const updated = history.activity.filter((entry) => entry.type === "task.updated");
  expect(updated).toHaveLength(1);
  expect(updated[0]).toMatchObject({
    actor: { id: memberId },
    data: { fields: { parent: { from: { id: parent.id, key: parent.key }, to: null } } },
  });
  expect((await getTaskDetail(owner, { taskId: parent.id })).subtasks).toEqual([]);

  const relinked = await updateTask(member, { taskId: child.id, parentTaskId: parent.id });
  expect(relinked.parent).toEqual({ id: parent.id, key: parent.key, title: "Parent" });
  const after = (await getTaskDetail(owner, { taskId: child.id })).activity.filter((entry) => entry.type === "task.updated");
  expect(after.at(-1)?.data).toEqual({ fields: { parent: { from: null, to: { id: parent.id, key: parent.key } } } });
});

it("requires edit rights on the parent to link a sub-task in a restricted project", async () => {
  const project = await makeProject("restricted", "RST");
  const parent = await createTask(owner, { projectId: project.id, title: "Parent" });
  const child = await createTask(owner, { projectId: project.id, title: "Child", parentTaskId: parent.id });
  await setProjectTaskEditRestriction(owner, { projectId: project.id, restricted: true });

  await expect(updateTask(member, { taskId: child.id, parentTaskId: null })).rejects.toMatchObject(forbidEdit);
  expect((await getTaskDetail(owner, { taskId: child.id })).parent?.id).toBe(parent.id);

  await expect(createTask(member, { projectId: project.id, title: "Member sub-task", parentTaskId: parent.id }))
    .rejects.toMatchObject(forbidParent);
  const mine = await createTask(member, { projectId: project.id, title: "Member task" });
  await expect(updateTask(member, { taskId: mine.id, parentTaskId: parent.id })).rejects.toMatchObject(forbidParent);
  expect((await getTaskDetail(owner, { taskId: parent.id })).subtasks.map((t) => t.id)).toEqual([child.id]);

  // The assignee can edit the parent, so they can link sub-tasks to it.
  await updateTask(owner, { taskId: parent.id, assigneeUserId: memberId });
  const added = await createTask(member, { projectId: project.id, title: "Member sub-task", parentTaskId: parent.id });
  expect(added).toMatchObject({ parent: { id: parent.id }, createdBy: { id: memberId } });
  expect(await updateTask(member, { taskId: mine.id, parentTaskId: parent.id })).toMatchObject({ parent: { id: parent.id } });
  expect((await getTaskDetail(owner, { taskId: parent.id })).subtasks.map((t) => t.id)).toEqual([child.id, mine.id, added.id]);
});

it("blocks moving sub-tasks and parents to another project", async () => {
  const project = await makeProject("transfer", "TRF");
  const destination = await makeProject("transfer-to", "TRT");
  const parent = await createTask(owner, { projectId: project.id, title: "Parent" });
  const child = await createTask(owner, { projectId: project.id, title: "Child", parentTaskId: parent.id });
  const move = (taskId: string) => transferTask(owner, {
    taskId,
    sourceProjectId: project.id,
    destinationProjectId: destination.id,
  });

  await expect(move(child.id)).rejects.toThrow("Remove the parent before moving this task.");
  await expect(move(parent.id)).rejects.toThrow("Move or detach its sub-tasks before moving this task.");
  expect((await listTasks(owner, { projectId: destination.id }))).toEqual([]);
});

it("archives a parent without archiving its sub-tasks", async () => {
  const project = await makeProject("archive", "ARC");
  const parent = await createTask(owner, { projectId: project.id, title: "Parent" });
  const child = await createTask(owner, { projectId: project.id, title: "Child", parentTaskId: parent.id });

  await archiveTask(owner, { taskId: parent.id });
  const active = await listTasks(owner, { projectId: project.id });
  expect(active.map((t) => t.id)).toEqual([child.id]);
  expect(active[0]).toMatchObject({ archivedAt: null, parent: { id: parent.id } });
});

it("detaches sub-tasks when their parent is deleted, and deletes projects holding both", async () => {
  const project = await makeProject("delete", "DEL");
  const parent = await createTask(owner, { projectId: project.id, title: "Parent" });
  const child = await createTask(owner, { projectId: project.id, title: "Child", parentTaskId: parent.id });

  await archiveTask(owner, { taskId: parent.id });
  await deleteArchivedTask(owner, { projectId: project.id, taskId: parent.id, confirmation: parent.key });
  const [row] = await db.select({ parentTaskId: task.parentTaskId }).from(task).where(eq(task.id, child.id));
  expect(row.parentTaskId).toBeNull();
  expect((await getTaskDetail(owner, { taskId: child.id })).parent).toBeNull();

  const doomed = await makeProject("delete-project", "DPR");
  const doomedParent = await createTask(owner, { projectId: doomed.id, title: "Parent" });
  await createTask(owner, { projectId: doomed.id, title: "Child", parentTaskId: doomedParent.id });
  await deleteProject(owner, { projectId: doomed.id, confirmation: doomed.slug });
  expect(await db.select().from(task).where(eq(task.projectId, doomed.id))).toEqual([]);
});

it("deletes an organization holding a parent and its sub-task", async () => {
  const doomed = await createOrg(owner, { slug: "subtasks-doomed", name: "Doomed" });
  const project = await createProject(owner, { orgId: doomed.id, slug: "doomed", key: "DOO", name: "doomed" });
  const parent = await createTask(owner, { projectId: project.id, title: "Parent" });
  await createTask(owner, { projectId: project.id, title: "Child", parentTaskId: parent.id });

  await deleteOrg(owner, { orgId: doomed.id, confirmation: doomed.slug });
  expect(await db.select().from(task).where(eq(task.projectId, project.id))).toEqual([]);
});

it("defaults hideSubtasks off for saved filters from before sub-tasks", () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null });
  try {
    const old = { query: "", status: "", type: "", assignees: [], creators: [], reporters: [] };
    stored.set("old", JSON.stringify(old));
    stored.set("hidden", JSON.stringify({ ...old, hideSubtasks: true }));
    stored.set("odd", JSON.stringify({ ...old, hideSubtasks: "yes" }));
    expect(readFilters("old")?.hideSubtasks).toBe(false);
    expect(readFilters("hidden")?.hideSubtasks).toBe(true);
    expect(readFilters("odd")?.hideSubtasks).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
