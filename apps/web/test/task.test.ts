import { env } from "cloudflare:test";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  addComment,
  addProjectMember,
  archiveTask,
  createOrg,
  createProject,
  createProjectTaskType,
  createStatus,
  createTask,
  findMovedTaskByKey,
  getTask,
  getTaskDetail,
  listTaskMoveProjects,
  listTasks,
  moveTask,
  reorderStatus,
  setDefaultProjectTaskType,
  transferTask,
  unarchiveTask,
  updateTask,
} from "@tasks/core/domain";
import {
  activity,
  comment,
  orgMember,
  project,
  projectTaskType,
  status,
  task,
  user,
} from "@tasks/core/schema";

const db = drizzle(env.DB);
const now = new Date();

// Storage is shared across the whole run (§12: no per-test isolation), so
// every id here is prefixed `tk-`.
const IDS = ["tk-owner", "tk-admin", "tk-member", "tk-outsider"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@task.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

function ctxFor(userId: string) {
  return { db, actorUserId: userId, source: "web" as const };
}

/**
 * A project owned by `tk-owner`, with `tk-admin` an org admin and `tk-member`
 * a plain org member — neither holding a `project_member` row unless the test
 * adds one.
 */
async function freshProject(slug: string, key: string) {
  const org = await createOrg(ctxFor("tk-owner"), { slug, name: slug });
  await db.insert(orgMember).values([
    { orgId: org.id, userId: "tk-admin", role: "admin", createdAt: now },
    { orgId: org.id, userId: "tk-member", role: "member", createdAt: now },
  ]);
  const p = await createProject(ctxFor("tk-owner"), {
    orgId: org.id,
    slug: "web",
    name: "Web",
    key,
  });
  const statuses = await db
    .select()
    .from(status)
    .where(eq(status.projectId, p.id))
    .orderBy(asc(status.position), asc(status.id));
  return { org, project: p, todo: statuses[0], doing: statuses[1], done: statuses[2] };
}

function taskActivity(taskId: string) {
  return db
    .select()
    .from(activity)
    .where(eq(activity.taskId, taskId))
    .orderBy(asc(activity.createdAt), sql`"activity"."rowid"`);
}

function finishTaskSetup(taskId: string) {
  return db.update(task)
    .set({ createdAt: new Date(Date.now() - 10 * 60 * 1000) })
    .where(eq(task.id, taskId));
}

it("uses the next destination key, matches project fields and keeps archived work and its history", async () => {
  const { org, project: source } = await freshProject("tk-transfer-history", "TRH");
  const owner = ctxFor("tk-owner");
  const target = await createProject(owner, { orgId: org.id, slug: "target", key: "TRD", name: "Target" });
  const sourceStatus = await createStatus(owner, { projectId: source.id, name: "Needs Review" });
  const targetStatus = await createStatus(owner, { projectId: target.id, name: "Needs review" });
  const sourceType = await createProjectTaskType(owner, { projectId: source.id, name: "Follow-up" });
  const targetType = await createProjectTaskType(owner, { projectId: target.id, name: "Follow-Up" });
  const existing = await createTask(owner, { projectId: target.id, title: "Existing destination task" });
  const created = await createTask(owner, {
    projectId: source.id,
    title: "Original title",
    description: "Original description",
    statusId: sourceStatus.id,
    typeId: sourceType.id,
    assigneeUserId: owner.actorUserId,
    dueDate: "2028-02-29",
    priority: "high",
  });
  const message = await addComment(owner, { taskId: created.id, body: "Retain this comment" });
  const archived = await archiveTask(owner, { taskId: created.id });

  const result = await transferTask(owner, {
    taskId: created.id, sourceProjectId: source.id, destinationProjectId: target.id,
  });
  expect(result).toEqual({ projectSlug: target.slug, key: "TRD-2" });
  expect(await getTaskDetail(owner, { taskId: created.id })).toMatchObject({
    id: created.id,
    key: result.key,
    title: created.title,
    description: created.description,
    dueDate: created.dueDate,
    priority: created.priority,
    createdAt: created.createdAt,
    createdBy: created.createdBy,
    archivedAt: archived.archivedAt,
    assignee: { id: owner.actorUserId },
    status: { id: targetStatus.id },
    type: { id: targetType.id },
    comments: [{ id: message.id, body: message.body }],
    activity: [
      { type: "task.created" },
      { type: "comment.added" },
      { type: "task.archived" },
      { type: "task.transferred", data: { status: { from: sourceStatus.name, to: targetStatus.name } } },
    ],
  });
  expect(await listTasks(owner, { projectId: source.id, includeArchived: true })).toEqual([]);
  expect(await listTasks(owner, { projectId: target.id })).toMatchObject([{ id: existing.id }]);
  expect(await listTasks(owner, { projectId: target.id, archivedOnly: true })).toMatchObject([{ id: created.id }]);
  expect((await taskActivity(created.id)).map(({ projectId }) => projectId)).toEqual(Array(4).fill(target.id));
});

it("lets an organization member transfer work and retain the assignment across projects", async () => {
  const { org, project: source } = await freshProject("tk-transfer-access", "TRA");
  const owner = ctxFor("tk-owner");
  const member = ctxFor("tk-member");
  const target = await createProject(owner, { orgId: org.id, slug: "target", key: "TRB", name: "Target" });
  const { project: foreign } = await freshProject("tk-transfer-foreign", "TRF");
  const customStatus = await createStatus(owner, { projectId: source.id, name: "Waiting for review" });
  const customType = await createProjectTaskType(owner, { projectId: source.id, name: "Review" });
  const created = await createTask(owner, {
    projectId: source.id,
    title: "Task with a workspace destination",
    assigneeUserId: member.actorUserId,
    statusId: customStatus.id,
    typeId: customType.id,
  });
  const input = { taskId: created.id, sourceProjectId: source.id, destinationProjectId: target.id };

  expect(await listTaskMoveProjects(member, source.id)).toEqual([{ id: target.id, name: target.name }]);
  expect(await listTaskMoveProjects(member, target.id)).toEqual([{ id: source.id, name: source.name }]);
  await expect(transferTask(owner, { ...input, destinationProjectId: foreign.id })).rejects.toThrow("in this workspace");
  await expect(transferTask(owner, { ...input, destinationProjectId: source.id })).rejects.toThrow("another project");
  expect(await listTaskMoveProjects(owner, source.id)).toEqual([{ id: target.id, name: target.name }]);

  await transferTask(member, input);
  const destinationDefault = await createTask(owner, { projectId: target.id, title: "Default fields" });
  expect(await getTask(owner, { taskId: created.id })).toMatchObject({
    assignee: { id: member.actorUserId },
    status: { id: destinationDefault.status.id },
    type: { id: destinationDefault.type.id },
  });
});

it("rejects a stale transfer and resolves old keys to the latest project after repeated moves", async () => {
  const { org, project: source } = await freshProject("tk-transfer-aliases", "TAL");
  const owner = ctxFor("tk-owner");
  const middle = await createProject(owner, { orgId: org.id, slug: "middle", key: "MID", name: "Middle" });
  const target = await createProject(owner, { orgId: org.id, slug: "target", key: "TAT", name: "Target" });
  const created = await createTask(owner, { projectId: source.id, title: "Move me", description: "Initial" });
  const input = { taskId: created.id, sourceProjectId: source.id, destinationProjectId: middle.id };
  const originalKey = { projectId: source.id, key: created.key };

  await expect(transferTask(owner, input, async () => {
    await updateTask(owner, { taskId: created.id, description: "New edit" });
    return "Prepared stale description";
  })).rejects.toThrow("changed");
  expect(await findMovedTaskByKey(owner, originalKey)).toBeNull();
  expect(await getTask(owner, { taskId: created.id })).toMatchObject({ key: created.key, description: "New edit" });

  const moved = await transferTask(owner, input);
  await expect(transferTask(owner, input)).rejects.toMatchObject({ reason: "not_a_member" });
  const movedAgain = await transferTask(owner, { ...input, sourceProjectId: middle.id, destinationProjectId: target.id });
  expect(await findMovedTaskByKey(owner, originalKey)).toEqual(movedAgain);
  expect(await findMovedTaskByKey(owner, { projectId: middle.id, key: moved.key })).toEqual(movedAgain);
  expect((await taskActivity(created.id)).filter(({ type }) => type === "task.transferred")).toHaveLength(2);
});

it("saves the creator’s initial task edits and moves without writing activity", async () => {
  const { project: p, doing, done } = await freshProject("tk-initial-setup", "SET");
  const owner = ctxFor("tk-owner");
  const [bug] = await db.select().from(projectTaskType)
    .where(and(eq(projectTaskType.projectId, p.id), eq(projectTaskType.name, "Bug")));
  const created = await createTask(owner, { projectId: p.id, title: "Initial title" });
  await updateTask(owner, {
    taskId: created.id,
    title: "Setup title",
    description: "Initial description",
    statusId: doing.id,
    typeId: bug.id,
    priority: "high",
    dueDate: "2028-03-01",
    assigneeUserId: "tk-owner",
  });
  await moveTask(owner, { taskId: created.id, statusId: done.id, afterTaskId: null });

  expect(await getTaskDetail(owner, { taskId: created.id })).toMatchObject({
    title: "Setup title",
    description: "Initial description",
    status: { id: done.id },
    type: { id: bug.id },
    priority: "high",
    dueDate: "2028-03-01",
    assignee: { id: "tk-owner" },
  });
  expect((await taskActivity(created.id)).map(({ type }) => type)).toEqual(["task.created"]);

  await finishTaskSetup(created.id);
  await updateTask(owner, { taskId: created.id, priority: "low" });
  expect((await taskActivity(created.id)).map(({ type }) => type)).toEqual(["task.created", "task.updated"]);
});

it("ends the creator’s setup window when another user edits or someone comments", async () => {
  const { project: p } = await freshProject("tk-setup-interruption", "INT");
  const owner = ctxFor("tk-owner");
  const admin = ctxFor("tk-admin");
  const edited = await createTask(owner, { projectId: p.id, title: "Edited" });
  await updateTask(admin, { taskId: edited.id, priority: "high" });
  await updateTask(owner, { taskId: edited.id, title: "Creator follows up" });
  expect((await taskActivity(edited.id)).map(({ type }) => type))
    .toEqual(["task.created", "task.updated", "task.updated"]);

  const discussed = await createTask(owner, { projectId: p.id, title: "Discussed" });
  await addComment(owner, { taskId: discussed.id, body: "Ready to review" });
  await updateTask(owner, { taskId: discussed.id, priority: "low" });
  expect((await taskActivity(discussed.id)).map(({ type }) => type))
    .toEqual(["task.created", "comment.added", "task.updated"]);
});

it("saves consecutive description edits without adding rows until their recorded window ends", async () => {
  const { project: p } = await freshProject("tk-description-autosave", "DES");
  const owner = ctxFor("tk-owner");
  const created = await createTask(owner, { projectId: p.id, title: "Describe this" });
  await finishTaskSetup(created.id);

  await updateTask(owner, { taskId: created.id, description: "First" });
  await updateTask(owner, { taskId: created.id, description: "Second" });
  expect((await getTask(owner, { taskId: created.id })).description).toBe("Second");
  const [creation, firstSave] = await taskActivity(created.id);
  expect(firstSave).toMatchObject({ type: "task.updated" });
  expect(await taskActivity(created.id)).toHaveLength(2);

  const expired = Date.now() - 11 * 60 * 1000;
  await db.update(activity).set({ createdAt: new Date(expired - 1) }).where(eq(activity.id, creation.id));
  await db.update(activity).set({ createdAt: new Date(expired) }).where(eq(activity.id, firstSave.id));
  await updateTask(owner, { taskId: created.id, description: "Third" });
  expect(await taskActivity(created.id)).toHaveLength(3);

  await addComment(owner, { taskId: created.id, body: "Interruption" });
  await updateTask(owner, { taskId: created.id, description: "Fourth" });
  await updateTask(owner, { taskId: created.id, description: null });
  const detail = await getTaskDetail(owner, { taskId: created.id });
  expect(detail.description).toBeNull();
  expect(detail.activity.map(({ type }) => type)).toEqual([
    "task.created", "task.updated", "task.updated", "comment.added", "task.updated", "task.updated",
  ]);
});

it("defaults new tasks to medium priority with no due date", async () => {
  const { project: p } = await freshProject("tk-metadata-defaults", "MET");
  const ctx = ctxFor("tk-owner");
  const created = await createTask(ctx, { projectId: p.id, title: "Defaults" });

  expect(await listTasks(ctx, { projectId: p.id })).toMatchObject([
    {
      id: created.id,
      priority: "medium",
      type: { name: "Task" },
      dueDate: null,
      createdBy: { id: "tk-owner", displayName: "TK-OWNER" },
    },
  ]);
});

it("keeps existing task types when the default changes and records explicit edits", async () => {
  const { project: p } = await freshProject("tk-types", "TYP");
  const { project: other } = await freshProject("tk-other-types", "OTP");
  const ctx = ctxFor("tk-owner");
  const [bug] = await db.select().from(projectTaskType)
    .where(and(eq(projectTaskType.projectId, p.id), eq(projectTaskType.name, "Bug")));
  const [otherBug] = await db.select().from(projectTaskType)
    .where(and(eq(projectTaskType.projectId, other.id), eq(projectTaskType.name, "Bug")));
  const created = await createTask(ctx, { projectId: p.id, title: "Before" });
  expect(created.type.name).toBe("Task");

  await expect(createTask(ctx, {
    projectId: p.id,
    title: "Invalid type",
    typeId: otherBug.id,
  })).rejects.toThrow("No such task type in this project.");
  await expect(updateTask(ctx, {
    taskId: created.id,
    typeId: otherBug.id,
  })).rejects.toThrow("No such task type in this project.");

  await setDefaultProjectTaskType(ctx, { projectId: p.id, typeId: bug.id });
  const next = await createTask(ctx, { projectId: p.id, title: "After" });
  expect(next.type).toEqual({ id: bug.id, name: "Bug", color: "red", icon: "bug" });
  expect((await getTaskDetail(ctx, { taskId: created.id })).type).toEqual(created.type);

  await finishTaskSetup(created.id);
  await updateTask(ctx, { taskId: created.id, typeId: bug.id });
  const updated = await getTaskDetail(ctx, { taskId: created.id });
  expect(updated.type).toEqual(next.type);
  expect(updated.activity).toContainEqual(expect.objectContaining({
    type: "task.updated",
    data: { fields: { type: { from: "Task", to: "Bug" } } },
  }));
});

it("saves and clears a calendar due date and records priority changes without changing the creator", async () => {
  const { project: p } = await freshProject("tk-metadata-update", "MTU");
  const owner = ctxFor("tk-owner");
  const member = ctxFor("tk-member");
  await addProjectMember(owner, { projectId: p.id, userId: member.actorUserId });

  const created = await createTask(owner, {
    projectId: p.id,
    title: "Leap day",
    dueDate: "2028-02-29",
    priority: "high",
  });
  expect(created).toMatchObject({ dueDate: "2028-02-29", priority: "high" });

  const updated = await updateTask(member, {
    taskId: created.id,
    dueDate: "2028-03-01",
    priority: "low",
  });
  expect(updated).toMatchObject({
    dueDate: "2028-03-01",
    priority: "low",
    createdBy: { id: owner.actorUserId, displayName: "TK-OWNER" },
  });

  // Omitting the fields, or resubmitting their current values, should not
  // add activity or change their stored values.
  await updateTask(member, { taskId: created.id });
  await updateTask(member, {
    taskId: created.id,
    dueDate: "2028-03-01",
    priority: "low",
  });
  await updateTask(member, { taskId: created.id, dueDate: null });

  const detail = await getTaskDetail(owner, { taskId: created.id });
  expect(detail).toMatchObject({
    dueDate: null,
    priority: "low",
    createdBy: { id: owner.actorUserId },
  });
  expect(detail.activity.filter((entry) => entry.type === "task.updated")).toMatchObject([
    {
      actor: { id: member.actorUserId },
      data: {
        fields: {
          dueDate: { from: "2028-02-29", to: "2028-03-01" },
          priority: { from: "high", to: "low" },
        },
      },
    },
    {
      actor: { id: member.actorUserId },
      data: { fields: { dueDate: { from: "2028-03-01", to: null } } },
    },
  ]);
});

it("rejects calendar rollovers, ambiguous date strings, and unknown priorities", async () => {
  const { project: p } = await freshProject("tk-metadata-validation", "MTV");
  const ctx = ctxFor("tk-owner");
  const input = { projectId: p.id, title: "Validate metadata" };

  for (const dueDate of ["2027-02-29", "2028-04-31", "2028-2-29", "2028-02-29T00:00:00Z"]) {
    await expect(createTask(ctx, { ...input, dueDate })).rejects.toThrow("Enter a valid due date.");
  }
  await expect(createTask(ctx, { ...input, priority: "urgent" })).rejects.toThrow("Choose a valid priority.");

  const created = await createTask(ctx, input);
  await expect(updateTask(ctx, { taskId: created.id, dueDate: "2028-13-01" })).rejects.toThrow("Enter a valid due date.");
  await expect(updateTask(ctx, { taskId: created.id, priority: "HIGH" })).rejects.toThrow("Choose a valid priority.");
  expect(await getTaskDetail(ctx, { taskId: created.id })).toMatchObject({
    dueDate: null,
    priority: "medium",
    activity: [{ type: "task.created" }],
  });
});

it("allocates task numbers from the project counter, not from MAX(number)", async () => {
  const { project: p } = await freshProject("tk-keys", "KEY");

  const first = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "One",
  });
  const second = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "Two",
  });
  const third = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "Three",
  });
  expect([first.number, second.number, third.number]).toEqual([1, 2, 3]);
  expect([first.key, second.key, third.key]).toEqual([
    "KEY-1",
    "KEY-2",
    "KEY-3",
  ]);

  // The counter is the source: delete the highest-numbered task and the next
  // create still moves forward. A MAX(number)+1 implementation reuses 3 here.
  await db.delete(activity).where(eq(activity.taskId, third.id));
  await db.delete(task).where(eq(task.id, third.id));
  const fourth = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "Four",
  });
  expect(fourth.number).toBe(4);

  // §3: a failed insert after a successful bump leaves a gap, deliberately.
  await expect(
    createTask(ctxFor("tk-owner"), { projectId: p.id, title: "   " }),
  ).rejects.toThrowError(/title is required/);
  const [counter] = await db
    .select({ n: project.taskCounter })
    .from(project)
    .where(eq(project.id, p.id));
  // Validation runs before the bump, so this particular failure costs nothing.
  expect(counter.n).toBe(4);
});

it("allocates no duplicate numbers across a concurrent burst", async () => {
  const { project: p } = await freshProject("tk-burst", "BST");

  const created = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      createTask(ctxFor("tk-owner"), { projectId: p.id, title: `T${i}` }),
    ),
  );
  const numbers = created.map((t) => t.number).sort((a, b) => a - b);
  expect(new Set(numbers).size).toBe(8);
  expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

  // Honest about what this proves: workerd runs this isolate on one thread and
  // D1 serializes statements, so `Promise.all` interleaves awaits without ever
  // running two `UPDATE … RETURNING` statements at the same instant. The test
  // shows the interleaving does not corrupt the sequence; it does NOT prove
  // the statement is atomic under real parallelism. That rests on the single
  // `UPDATE project SET task_counter = task_counter + 1 … RETURNING` of §3.
});

it("defaults to the first board status after reordering", async () => {
  const { project, todo, doing } = await freshProject("tk-first-status", "FST");
  const ctx = ctxFor("tk-owner");
  await reorderStatus(ctx, { statusId: doing.id, afterStatusId: null });

  const implicit = await createTask(ctx, { projectId: project.id, title: "Implicit" });
  const explicit = await createTask(ctx, {
    projectId: project.id,
    title: "Explicit",
    statusId: todo.id,
  });
  expect(implicit.status).toEqual({ id: doing.id, name: doing.name, color: "blue" });
  expect(explicit.status).toEqual({ id: todo.id, name: todo.name, color: "gray" });
});

it("derives the display key, so renaming project.key renames every task", async () => {
  const { project: p } = await freshProject("tk-derived", "OLD");
  await createTask(ctxFor("tk-owner"), { projectId: p.id, title: "One" });
  await createTask(ctxFor("tk-owner"), { projectId: p.id, title: "Two" });

  expect((await listTasks(ctxFor("tk-owner"), { projectId: p.id })).map((t) => t.key))
    .toEqual(["OLD-1", "OLD-2"]);

  // No migration, no backfill: nothing stores the key.
  await db.update(project).set({ key: "NEW" }).where(eq(project.id, p.id));

  expect((await listTasks(ctxFor("tk-owner"), { projectId: p.id })).map((t) => t.key))
    .toEqual(["NEW-1", "NEW-2"]);
  expect(await db.select({ c: sql<number>`count(*)` }).from(task).where(eq(task.projectId, p.id)))
    .toEqual([{ c: 2 }]);
});

it("logs task.moved — never task.updated — for a status change, through either function", async () => {
  const { project: p, todo, doing, done } = await freshProject("tk-moved", "MVD");

  const viaUpdate = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "Via update",
  });
  await finishTaskSetup(viaUpdate.id);
  // The call an MCP `update_task(status: …)` makes.
  await updateTask(ctxFor("tk-owner"), {
    taskId: viaUpdate.id,
    statusId: doing.id,
  });

  let rows = await taskActivity(viaUpdate.id);
  expect(rows.map((r) => r.type)).toEqual(["task.created", "task.moved"]);
  expect(JSON.parse(rows[0].data)).toEqual({
    title: "Via update",
    status: { id: todo.id, name: "Todo" },
  });
  expect(JSON.parse(rows[1].data)).toEqual({
    from: { id: todo.id, name: "Todo" },
    to: { id: doing.id, name: "In Progress" },
  });

  const viaMove = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "Via move",
  });
  await finishTaskSetup(viaMove.id);
  // The call a board drag makes. Same payload, same type.
  await moveTask(ctxFor("tk-owner"), {
    taskId: viaMove.id,
    statusId: doing.id,
    afterTaskId: null,
  });
  rows = await taskActivity(viaMove.id);
  expect(rows.map((r) => r.type)).toEqual(["task.created", "task.moved"]);
  expect(JSON.parse(rows[1].data)).toEqual({
    from: { id: todo.id, name: "Todo" },
    to: { id: doing.id, name: "In Progress" },
  });

  // A title and a status in one call split into two rows, and the
  // task.updated row carries no status field.
  await updateTask(ctxFor("tk-owner"), {
    taskId: viaUpdate.id,
    title: "Renamed",
    statusId: done.id,
  });
  rows = await taskActivity(viaUpdate.id);
  // Both rows land in the same millisecond, so they are compared as a set:
  // `createdAt, id` cannot order two writes one `await` apart.
  expect(rows.map((r) => r.type).sort()).toEqual([
    "task.created",
    "task.moved",
    "task.moved",
    "task.updated",
  ]);
  const updated = rows.filter((r) => r.type === "task.updated");
  expect(updated).toHaveLength(1);
  expect(JSON.parse(updated[0].data)).toEqual({
    fields: { title: { from: "Via update", to: "Renamed" } },
  });
  expect(
    rows.filter((r) => r.type === "task.moved").map((r) => JSON.parse(r.data)),
  ).toContainEqual({
    from: { id: doing.id, name: "In Progress" },
    to: { id: done.id, name: "Done" },
  });

  // No task.updated anywhere in this project mentions a status.
  const all = await db
    .select()
    .from(activity)
    .where(eq(activity.projectId, p.id));
  for (const row of all.filter((r) => r.type === "task.updated")) {
    expect(JSON.parse(row.data).fields).not.toHaveProperty("status");
    expect(JSON.parse(row.data).fields).not.toHaveProperty("statusId");
  }

  // A reorder inside one column is not a status change and logs nothing.
  const before = (await taskActivity(viaMove.id)).length;
  await moveTask(ctxFor("tk-owner"), {
    taskId: viaMove.id,
    statusId: doing.id,
    afterTaskId: null,
  });
  expect(await taskActivity(viaMove.id)).toHaveLength(before);
});

it("logs assignee changes as task.updated, with null meaningful on either side", async () => {
  const { project: p } = await freshProject("tk-assignee", "ASG");
  await addProjectMember(ctxFor("tk-owner"), {
    projectId: p.id,
    userId: "tk-member",
  });

  const t = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "Assign me",
  });
  await finishTaskSetup(t.id);

  await updateTask(ctxFor("tk-owner"), {
    taskId: t.id,
    assigneeUserId: "tk-member",
  });
  await updateTask(ctxFor("tk-owner"), {
    taskId: t.id,
    assigneeUserId: "tk-owner",
  });
  await updateTask(ctxFor("tk-owner"), { taskId: t.id, assigneeUserId: null });

  const rows = (await taskActivity(t.id)).slice(1);
  expect(rows.map((r) => r.type)).toEqual([
    "task.updated",
    "task.updated",
    "task.updated",
  ]);
  expect(JSON.parse(rows[0].data)).toEqual({
    fields: {
      assignee: { from: null, to: { id: "tk-member", displayName: "TK-MEMBER" } },
    },
  });
  expect(JSON.parse(rows[1].data)).toEqual({
    fields: {
      assignee: {
        from: { id: "tk-member", displayName: "TK-MEMBER" },
        to: { id: "tk-owner", displayName: "TK-OWNER" },
      },
    },
  });
  expect(JSON.parse(rows[2].data)).toEqual({
    fields: {
      assignee: { from: { id: "tk-owner", displayName: "TK-OWNER" }, to: null },
    },
  });

  // Re-applying the same value changes nothing and logs nothing.
  await updateTask(ctxFor("tk-owner"), { taskId: t.id, assigneeUserId: null });
  expect(await taskActivity(t.id)).toHaveLength(4);

  // Description is a scalar `{from, to}`.
  await updateTask(ctxFor("tk-owner"), { taskId: t.id, description: "Why" });
  const latest = (await taskActivity(t.id)).at(-1);
  expect(JSON.parse(latest!.data)).toEqual({
    fields: { description: { from: null, to: "Why" } },
  });
});

it("assigns organization members without project role rows and rejects outsiders", async () => {
  const { project: p } = await freshProject("tk-assignable", "ABL");
  const owner = ctxFor("tk-owner");
  const member = ctxFor("tk-member");
  const outsider = "tk-outsider";
  const item = await createTask(member, {
    projectId: p.id, title: "Self-assignment", assigneeUserId: member.actorUserId,
  });
  expect(item.assignee).toEqual({ id: member.actorUserId, displayName: "TK-MEMBER" });

  await expect(createTask(owner, { projectId: p.id, title: "Outside", assigneeUserId: outsider }))
    .rejects.toThrowError(/member of this organization/);
  await expect(updateTask(owner, { taskId: item.id, assigneeUserId: outsider }))
    .rejects.toMatchObject({ name: "DomainError" });

  const admin = ctxFor("tk-admin");
  const assigned = await updateTask(member, { taskId: item.id, assigneeUserId: admin.actorUserId });
  expect(assigned.assignee).toEqual({ id: admin.actorUserId, displayName: "TK-ADMIN" });
});

it("orders per (projectId, statusId), writes one row per move, and breaks ties on id", async () => {
  const { project: p, todo, doing } = await freshProject("tk-order", "ORD");

  const a = await createTask(ctxFor("tk-owner"), { projectId: p.id, title: "A" });
  const b = await createTask(ctxFor("tk-owner"), { projectId: p.id, title: "B" });
  const c = await createTask(ctxFor("tk-owner"), { projectId: p.id, title: "C" });
  expect(
    (await listTasks(ctxFor("tk-owner"), { projectId: p.id, statusId: todo.id })).map(
      (t) => t.title,
    ),
  ).toEqual(["A", "B", "C"]);

  const snapshot = async () =>
    Object.fromEntries(
      (
        await db
          .select({
            id: task.id,
            statusId: task.statusId,
            position: task.position,
          })
          .from(task)
          .where(eq(task.projectId, p.id))
      ).map((t) => [t.id, `${t.statusId}/${t.position}`]),
    );

  const before = await snapshot();
  await moveTask(ctxFor("tk-owner"), {
    taskId: c.id,
    statusId: todo.id,
    afterTaskId: a.id,
  });
  const after = await snapshot();
  const changed = Object.keys(after).filter((id) => after[id] !== before[id]);
  expect(changed).toEqual([c.id]);
  expect(
    (await listTasks(ctxFor("tk-owner"), { projectId: p.id, statusId: todo.id })).map(
      (t) => t.title,
    ),
  ).toEqual(["A", "C", "B"]);

  // First in the column.
  await moveTask(ctxFor("tk-owner"), {
    taskId: b.id,
    statusId: todo.id,
    afterTaskId: null,
  });
  expect(
    (await listTasks(ctxFor("tk-owner"), { projectId: p.id, statusId: todo.id })).map(
      (t) => t.title,
    ),
  ).toEqual(["B", "A", "C"]);

  // Scope is the column: a task moved into an empty column gets a key
  // generated from that column alone, which may equal one already in use in
  // another column. Ordering stays correct in both.
  await moveTask(ctxFor("tk-owner"), {
    taskId: a.id,
    statusId: doing.id,
    afterTaskId: null,
  });
  expect(
    (await listTasks(ctxFor("tk-owner"), { projectId: p.id, statusId: todo.id })).map(
      (t) => t.title,
    ),
  ).toEqual(["B", "C"]);
  expect(
    (await listTasks(ctxFor("tk-owner"), { projectId: p.id, statusId: doing.id })).map(
      (t) => t.title,
    ),
  ).toEqual(["A"]);

  // Ties break on id: two rows sharing a position, which is reachable because
  // deleteStatus moves tasks between columns without repositioning them.
  const tied = await db
    .select({ id: task.id, position: task.position })
    .from(task)
    .where(eq(task.statusId, todo.id));
  await db
    .update(task)
    .set({ position: "a0" })
    .where(eq(task.projectId, p.id));
  const byId = tied.map((t) => t.id).sort();
  expect(
    (await listTasks(ctxFor("tk-owner"), { projectId: p.id, statusId: todo.id })).map(
      (t) => t.id,
    ),
  ).toEqual(byId);

  // And a move into that column lands exactly where asked: no key exists
  // between two equal positions, so `positionIn` re-keys the run first.
  await moveTask(ctxFor("tk-owner"), {
    taskId: a.id,
    statusId: todo.id,
    afterTaskId: byId[0],
  });
  const order = (
    await listTasks(ctxFor("tk-owner"), { projectId: p.id, statusId: todo.id })
  ).map((t) => t.id);
  expect(order).toEqual([byId[0], a.id, byId[1]]);
});

it("archives and unarchives, and list_tasks hides archived by default", async () => {
  const { project: p } = await freshProject("tk-archive", "ARC");
  const keep = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "Keep",
  });
  const gone = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "Gone",
  });

  const archived = await archiveTask(ctxFor("tk-owner"), { taskId: gone.id });
  expect(archived.archivedAt).toBeInstanceOf(Date);

  // §5.7: includeArchived defaults to false.
  expect(
    (await listTasks(ctxFor("tk-owner"), { projectId: p.id })).map((t) => t.title),
  ).toEqual(["Keep"]);
  expect(
    (
      await listTasks(ctxFor("tk-owner"), {
        projectId: p.id,
        includeArchived: true,
      })
    ).map((t) => t.title),
  ).toEqual(["Keep", "Gone"]);
  // Still individually readable.
  expect((await getTask(ctxFor("tk-owner"), { taskId: gone.id })).title).toBe("Gone");

  // Archiving twice writes one row.
  await archiveTask(ctxFor("tk-owner"), { taskId: gone.id });
  await unarchiveTask(ctxFor("tk-owner"), { taskId: gone.id });
  await unarchiveTask(ctxFor("tk-owner"), { taskId: gone.id });

  const rows = await taskActivity(gone.id);
  expect(rows.map((r) => r.type)).toEqual([
    "task.created",
    "task.archived",
    // §3's table has no unarchive type; this is the documented addition.
    "task.unarchived",
  ]);
  expect(JSON.parse(rows[1].data)).toEqual({});
  expect(JSON.parse(rows[2].data)).toEqual({});
  expect(
    (await listTasks(ctxFor("tk-owner"), { projectId: p.id })).map((t) => t.title),
  ).toEqual(["Keep", "Gone"]);
  expect(keep.archivedAt).toBeNull();
});

it("records a comment with its source, and logs comment.added", async () => {
  const { project: p } = await freshProject("tk-comment", "CMT");
  const t = await createTask(ctxFor("tk-owner"), {
    projectId: p.id,
    title: "Talk",
  });

  const long = `${"word ".repeat(60)}end`;
  const c = await addComment(
    { db, actorUserId: "tk-owner", source: "mcp", clientId: "cli", clientName: "Claude" },
    { taskId: t.id, body: long },
  );

  const [stored] = await db.select().from(comment).where(eq(comment.id, c.id));
  // §3: comment.source duplicates the activity row's source on purpose.
  expect(stored.source).toBe("mcp");

  const row = (await taskActivity(t.id)).at(-1)!;
  expect(row.type).toBe("comment.added");
  expect(row.source).toBe("mcp");
  expect(row.clientName).toBe("Claude");
  const data = JSON.parse(row.data);
  expect(data.commentId).toBe(c.id);
  expect(data.excerpt).toHaveLength(140);
  expect(data.excerpt.endsWith("…")).toBe(true);
  expect(Object.keys(data).sort()).toEqual(["commentId", "excerpt"]);

  await expect(
    addComment(ctxFor("tk-owner"), { taskId: t.id, body: "  " }),
  ).rejects.toThrowError(/cannot be empty/);
});

it("accepts a selected organization member and rejects malformed or out-of-organization mentions", async () => {
  const { project: p } = await freshProject("tk-mentions", "TMN");
  const owner = ctxFor("tk-owner");
  const item = await createTask(owner, { projectId: p.id, title: "Mention validation" });
  const body = "  @TK-MEMBER please review";
  const memberMention = { userId: "tk-member", start: 2, end: 12 };
  const rejection = /choose people from the mention list again/i;

  for (const input of [
    { body, mentions: [{ ...memberMention, end: 11 }] },
    { body, mentions: [memberMention, memberMention] },
    { body: "@TK-OUTSIDER", mentions: [{ userId: "tk-outsider", start: 0, end: 12 }] },
  ]) {
    await expect(addComment(owner, { taskId: item.id, ...input })).rejects.toThrow(rejection);
  }
  expect((await getTaskDetail(owner, { taskId: item.id })).comments).toEqual([]);
  expect(await taskActivity(item.id)).toHaveLength(1);

  await addComment(owner, { taskId: item.id, body, mentions: [memberMention] });
  expect((await getTaskDetail(owner, { taskId: item.id })).comments).toMatchObject([{
    body: body.trim(),
    mentions: [{ userId: "tk-member", start: 0, end: 10 }],
  }]);
});

it("admits an org admin with no project_member row, and refuses an outsider everywhere", async () => {
  const { project: p, doing } = await freshProject("tk-access", "ACC");

  // §3: owner/admin reach every project in their org without a row.
  const [rows] = await db
    .select({ c: sql<number>`count(*)` })
    .from(project)
    .where(eq(project.id, p.id));
  expect(rows.c).toBe(1);

  const byAdmin = await createTask(ctxFor("tk-admin"), {
    projectId: p.id,
    title: "Admin can",
  });
  await updateTask(ctxFor("tk-admin"), { taskId: byAdmin.id, title: "Still can" });
  await moveTask(ctxFor("tk-admin"), {
    taskId: byAdmin.id,
    statusId: doing.id,
    afterTaskId: null,
  });
  await addComment(ctxFor("tk-admin"), { taskId: byAdmin.id, body: "Hi" });
  await archiveTask(ctxFor("tk-admin"), { taskId: byAdmin.id });
  await unarchiveTask(ctxFor("tk-admin"), { taskId: byAdmin.id });

  const outsider = ctxFor("tk-outsider");
  await expect(
    createTask(outsider, { projectId: p.id, title: "No" }),
  ).rejects.toMatchObject({ name: "AccessError", reason: "not_a_member" });
  for (const call of [
    () => updateTask(outsider, { taskId: byAdmin.id, title: "No" }),
    () =>
      moveTask(outsider, {
        taskId: byAdmin.id,
        statusId: doing.id,
        afterTaskId: null,
      }),
    () => archiveTask(outsider, { taskId: byAdmin.id }),
    () => unarchiveTask(outsider, { taskId: byAdmin.id }),
    () => addComment(outsider, { taskId: byAdmin.id, body: "No" }),
    () => getTask(outsider, { taskId: byAdmin.id }),
    () => listTasks(outsider, { projectId: p.id }),
  ]) {
    await expect(call()).rejects.toMatchObject({
      name: "AccessError",
      reason: "not_a_member",
    });
  }

  await expect(listTasks(ctxFor("tk-member"), { projectId: p.id }))
    .resolves.toMatchObject([{ id: byAdmin.id }]);
  await expect(
    getTask(ctxFor("tk-owner"), { taskId: "tk-does-not-exist" }),
  ).rejects.toMatchObject({ name: "AccessError", reason: "not_a_member" });
});
