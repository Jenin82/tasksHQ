import { env } from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  addProjectMember,
  createOrg,
  createProject,
  createTask,
  listProjectTaskTypes,
  listTasks,
  listWorkspaceAssignments,
} from "@tasks/core/domain";
import { activity, orgMember, status, task, user } from "@tasks/core/schema";
import { listAssignmentCreateProjects } from "@/app/[org]/(org)/settings/assignment-create-projects";
import type { BoardCard } from "@/app/[org]/[project]/board";
import { statusColorClass } from "@/lib/status-style";

// Same seam as test/routing.test.ts: the route layer reads the session through
// this module, and the pool gives no live request context.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@board.test`,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const { getProjectContext } = await import("@/lib/project-context");
const { createTaskAction, moveTaskAction } = await import(
  "@/app/[org]/[project]/actions"
);
const { default: BoardPage } = await import("@/app/[org]/[project]/page");
const { resolveVisibleMove } = await import("@/app/[org]/[project]/board");
const { TaskTypeEditContext } = await import("@/app/[org]/[project]/table/inline-task-field");

const db = drizzle(env.DB);
const now = new Date();

// Shared storage (§12: no per-test isolation), so every id and slug is `bd-`.
const IDS = ["bd-owner", "bd-member", "bd-stranger"];
const MEMBER_PHOTO = "https://example.com/board-member.jpg";
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@board.test`,
    image: id === "bd-member" ? MEMBER_PHOTO : null,
    createdAt: now,
    updatedAt: now,
  })),
);

const ownerCtx = { db, actorUserId: "bd-owner", source: "web" as const };

actor.id = "bd-owner";
const acme = await createOrg(ownerCtx, { slug: "bd-acme", name: "BD Acme" });
await db.insert(orgMember).values({
  orgId: acme.id,
  userId: "bd-member",
  role: "member",
  createdAt: now,
});

/** vinext's navigation errors carry Next's digest; 404 and 403 differ only there. */
const digest = (code: number) => ({
  digest: `NEXT_HTTP_ERROR_FALLBACK;${code}`,
});

async function freshBoard(slug: string, key: string) {
  const p = await createProject(ownerCtx, {
    orgId: acme.id,
    slug,
    name: slug,
    key,
  });
  const columns = await db
    .select()
    .from(status)
    .where(eq(status.projectId, p.id))
    .orderBy(asc(status.position), asc(status.id));
  return { project: p, todo: columns[0], doing: columns[1], done: columns[2] };
}

/** What the board renders: ids per column, in the order the page reads them. */
async function board(projectId: string, statusId: string) {
  const rows = await listTasks(ownerCtx, { projectId, statusId });
  return rows.map((t) => t.key);
}

it("places the key, title and footer inside a single task dialog button", async () => {
  actor.id = "bd-owner";
  const { project } = await freshBoard("bd-open", "BDP");
  const bug = (await listProjectTaskTypes(ownerCtx, { projectId: project.id })).find(({ name }) => name === "Bug");
  expect(bug).toBeDefined();
  const task = await createTask(ownerCtx, {
    projectId: project.id,
    title: "Open from the card",
    typeId: bug!.id,
    assigneeUserId: ownerCtx.actorUserId,
    dueDate: "2028-02-29",
    priority: "high",
  });
  const boardPage = await BoardPage({
    params: Promise.resolve({ org: acme.slug, project: project.slug }),
  });
  const html = renderToStaticMarkup(boardPage);
  const card = html.match(/<button[^>]*aria-label="Open BDP-1 Open from the card"[^>]*>(.*?)<\/button>/);
  expect(card?.[0]).toContain('aria-haspopup="dialog"');
  expect(card?.[1]).toContain(task.key);
  expect(card?.[1]).toContain(task.title);
  const badge = card?.[1].match(/title="Bug">(<svg[^>]*>)[\s\S]*?<span[^>]*>Bug<\/span>/);
  expect(badge?.[1]).toContain(statusColorClass("red"));
  expect(card?.[1]).toContain('title="BD-OWNER"');
  expect(card?.[1]).toContain('aria-label="High priority"');
  expect(card?.[1]).toMatch(/<time datetime="2028-02-29"/i);
  expect(card?.[1]).toContain("Due 29 Feb 2028");
  expect(html).not.toContain('aria-label="Filters"');
  expect(html).not.toContain('aria-label="Filter by title"');
  expect(html).not.toContain('aria-label="Filter by assignee"');
  expect(html).not.toContain('aria-label="Filter by created by"');

  const editable = renderToStaticMarkup(createElement(TaskTypeEditContext.Provider, {
    value: { boardHref: `/${acme.slug}/${project.slug}`, taskTypes: [bug!] },
  }, boardPage));
  expect(editable).toMatch(/aria-label="Open BDP-1 Open from the card"[^>]*>(?:(?!<button).)*<\/button>.*aria-label="Priority for BDP-1"/);
});

it("reads an assignee's profile photo and leaves unassigned cards null", async () => {
  const { project } = await freshBoard("bd-photo", "BDF");
  await addProjectMember(ownerCtx, { projectId: project.id, userId: "bd-member" });
  const assigned = await createTask(ownerCtx, {
    projectId: project.id,
    title: "Assigned task",
    assigneeUserId: "bd-member",
  });
  const unassigned = await createTask(ownerCtx, { projectId: project.id, title: "Unassigned task" });

  const rows = await listTasks(ownerCtx, { projectId: project.id });
  expect(rows.map(({ id, assignee }) => ({ id, assignee }))).toEqual([
    { id: assigned.id, assignee: { id: "bd-member", displayName: "BD-MEMBER", image: MEMBER_PHOTO } },
    { id: unassigned.id, assignee: null },
  ]);
});

it("keeps hidden tasks in order when a filtered board card moves", () => {
  const card = (id: string, statusId: string): BoardCard => ({
    id,
    statusId,
    key: id,
    title: id,
    assignee: null,
    createdBy: { id: "bd-owner", displayName: "Board Owner" },
    reportedBy: { id: "bd-owner", displayName: "Board Owner" },
    dueDate: null,
    priority: "medium",
    type: { id: "task", name: "Task", color: "gray", icon: "task" },
    updated: "1 Jan",
  });
  const moving = card("moving", "todo");
  const hiddenBefore = card("hidden-before", "todo");
  const visibleAfter = card("visible-after", "todo");
  const hiddenAfter = card("hidden-after", "todo");
  const hiddenDone = card("hidden-done", "done");
  const cards = [hiddenBefore, moving, visibleAfter, hiddenAfter, hiddenDone];
  const visible = [moving, visibleAfter];

  expect(resolveVisibleMove(cards, visible, moving, { statusId: "todo", index: 0 })).toBeNull();
  expect(resolveVisibleMove(cards, visible, visibleAfter, { statusId: "todo", index: 0 })).toEqual({
    taskId: visibleAfter.id,
    statusId: "todo",
    afterTaskId: hiddenBefore.id,
  });
  expect(resolveVisibleMove(cards, visible, moving, { statusId: "todo", index: 1 })).toEqual({
    taskId: moving.id,
    statusId: "todo",
    afterTaskId: hiddenAfter.id,
  });
  expect(resolveVisibleMove(cards, visible, moving, { statusId: "done", index: 0 })).toEqual({
    taskId: moving.id,
    statusId: "done",
    afterTaskId: hiddenDone.id,
  });
});

function move(
  projectSlug: string,
  input: { taskId: string; statusId: string; afterTaskId: string | null },
) {
  return moveTaskAction({ orgSlug: "bd-acme", projectSlug, ...input });
}

it("the move action persists a reorder within a column and a move across columns", async () => {
  actor.id = "bd-owner";
  const { project, todo, doing } = await freshBoard("bd-move", "BDM");

  const a = await createTask(ownerCtx, { projectId: project.id, title: "A" });
  const b = await createTask(ownerCtx, { projectId: project.id, title: "B" });
  const c = await createTask(ownerCtx, { projectId: project.id, title: "C" });
  expect(await board(project.id, todo.id)).toEqual(["BDM-1", "BDM-2", "BDM-3"]);
  const cardA = async () => renderToStaticMarkup(await BoardPage({
    params: Promise.resolve({ org: acme.slug, project: project.slug }),
  })).match(/<button[^>]*aria-label="Open BDM-1 A"[^>]*>/)?.[0];
  expect(await cardA()).toContain("[--status-color:var(--muted-foreground)]");

  // Within the column: C to the front.
  expect(
    await move("bd-move", {
      taskId: c.id,
      statusId: todo.id,
      afterTaskId: null,
    }),
  ).toEqual({});
  expect(await board(project.id, todo.id)).toEqual([
    "BDM-3",
    "BDM-1",
    "BDM-2",
  ]);

  // Across columns, and landing between two cards rather than at an end.
  await move("bd-move", { taskId: a.id, statusId: doing.id, afterTaskId: null });
  await move("bd-move", { taskId: b.id, statusId: doing.id, afterTaskId: a.id });
  await move("bd-move", { taskId: c.id, statusId: doing.id, afterTaskId: a.id });

  expect(await board(project.id, todo.id)).toEqual([]);
  expect(await board(project.id, doing.id)).toEqual([
    "BDM-1",
    "BDM-3",
    "BDM-2",
  ]);
  expect(await cardA()).toContain("[--status-color:var(--primary)]");

  // It reached D1, not just the read model: the row itself carries the new
  // column, and the position is a fractional key the client never computed.
  const [row] = await db.select().from(task).where(eq(task.id, c.id));
  expect(row.statusId).toBe(doing.id);
  expect(typeof row.position).toBe("string");
});

it("the board's data path is a 404 for a non-member and for an unknown project", async () => {
  await freshBoard("bd-reach", "BDR");

  actor.id = "bd-member";
  await expect(getProjectContext("bd-acme", "bd-reach")).resolves.toMatchObject({
    project: { slug: "bd-reach" }, projectRole: null,
  });
  await expect(getProjectContext("bd-acme", "bd-nope")).rejects.toMatchObject(
    digest(404),
  );

  // Someone outside the org never gets past the org check.
  actor.id = "bd-stranger";
  await expect(getProjectContext("bd-acme", "bd-reach")).rejects.toMatchObject(
    digest(404),
  );

  // The owner reaches it, so the 404s above are the rule and not a broken
  // query.
  actor.id = "bd-owner";
  const ctx = await getProjectContext("bd-acme", "bd-reach");
  expect(ctx.project.slug).toBe("bd-reach");

  // The move action also refuses an outsider.
  actor.id = "bd-stranger";
  await expect(
    move("bd-reach", {
      taskId: "bd-no-such-task",
      statusId: "bd-no-such-status",
      afterTaskId: null,
    }),
  ).rejects.toMatchObject(digest(404));
});

it("orders a column by (position, id) and keeps that order across a move", async () => {
  actor.id = "bd-owner";
  const { project, todo } = await freshBoard("bd-order", "BDO");

  const one = await createTask(ownerCtx, { projectId: project.id, title: "1" });
  const two = await createTask(ownerCtx, { projectId: project.id, title: "2" });
  const three = await createTask(ownerCtx, {
    projectId: project.id,
    title: "3",
  });

  // §18: equal positions are reachable — `deleteStatus` moves tasks without
  // repositioning them — so the id tiebreak is load-bearing, not theoretical.
  await db
    .update(task)
    .set({ position: "a0" })
    .where(eq(task.id, one.id));
  await db
    .update(task)
    .set({ position: "a0" })
    .where(eq(task.id, two.id));

  const byId = [one.id, two.id].sort();
  const keyOf = (id: string) =>
    id === one.id ? "BDO-1" : id === two.id ? "BDO-2" : "BDO-3";
  expect(await board(project.id, todo.id)).toEqual([
    keyOf(byId[0]),
    keyOf(byId[1]),
    "BDO-3",
  ]);

  // A move writes one position and nothing else is renumbered, so the tie and
  // its tiebreak both survive it.
  await move("bd-order", {
    taskId: three.id,
    statusId: todo.id,
    afterTaskId: null,
  });
  expect(await board(project.id, todo.id)).toEqual([
    "BDO-3",
    keyOf(byId[0]),
    keyOf(byId[1]),
  ]);

  const positions = await db
    .select({ id: task.id, position: task.position })
    .from(task)
    .where(eq(task.projectId, project.id))
    .orderBy(asc(task.position), asc(task.id));
  expect(positions.filter((p) => p.position === "a0")).toHaveLength(2);
});

function createForm(projectSlug: string, statusId: string, title: string) {
  const data = new FormData();
  data.set("org", "bd-acme");
  data.set("project", projectSlug);
  data.set("statusId", statusId);
  data.set("title", title);
  return data;
}

it("the create action appends a task to the given column, recorded as web", async () => {
  actor.id = "bd-owner";
  const { project, doing } = await freshBoard("bd-create", "BDC");
  await createTask(ownerCtx, {
    projectId: project.id,
    title: "Existing",
    statusId: doing.id,
  });

  expect(
    await createTaskAction({}, createForm("bd-create", doing.id, "  Fresh  ")),
  ).toEqual({
    task: {
      href: "/bd-acme/bd-create/BDC-2",
      key: "BDC-2",
      title: "Fresh",
      status: { name: doing.name, color: doing.color },
      assignee: null,
      updated: expect.any(String),
      dueDate: null,
      priority: "medium",
      type: { id: expect.any(String), name: "Task", color: "gray", icon: "task" },
    },
  });
  expect(await board(project.id, doing.id)).toEqual(["BDC-1", "BDC-2"]);

  const [row] = await db
    .select()
    .from(task)
    .where(and(eq(task.projectId, project.id), eq(task.number, 2)));
  expect(row.title).toBe("Fresh");
  expect(row.statusId).toBe(doing.id);
  expect(row.description).toBeNull();

  const [created] = await db
    .select()
    .from(activity)
    .where(eq(activity.taskId, row.id));
  expect(created).toMatchObject({
    type: "task.created",
    source: "web",
    actorUserId: "bd-owner",
  });
});

it("the create action saves a Markdown description in the default column", async () => {
  actor.id = "bd-owner";
  const { project, todo } = await freshBoard("bd-rich", "BDMD");
  const form = createForm("bd-rich", todo.id, "Rich work item");
  form.delete("statusId");
  const description = "## Details\n\n- **First step**\n- Second step";
  form.set("description", description);

  expect(await createTaskAction({}, form)).toMatchObject({
    task: {
      href: "/bd-acme/bd-rich/BDMD-1",
      key: "BDMD-1",
      title: "Rich work item",
      status: { name: todo.name, color: todo.color },
    },
  });

  const [row] = await db
    .select({ description: task.description, statusId: task.statusId })
    .from(task)
    .where(eq(task.projectId, project.id));
  expect(row).toEqual({ description, statusId: todo.id });
});

it("assigns to the signed-in member only when Assign yourself is checked", async () => {
  const { project, todo } = await freshBoard("bd-self", "BDS");
  await addProjectMember(ownerCtx, { projectId: project.id, userId: "bd-member" });
  actor.id = "bd-member";

  const checked = createForm(project.slug, todo.id, "Self assigned");
  checked.set("assignSelf", "on");
  checked.set("assigneeUserId", "bd-owner");
  expect(await createTaskAction({}, checked)).toMatchObject({
    task: { href: "/bd-acme/bd-self/BDS-1", assignee: "BD-MEMBER" },
  });

  const unchecked = createForm(project.slug, todo.id, "Unassigned");
  unchecked.set("assigneeUserId", "bd-owner");
  expect(await createTaskAction({}, unchecked)).toMatchObject({
    task: { href: "/bd-acme/bd-self/BDS-2", assignee: null },
  });

  const assignments = await listWorkspaceAssignments(
    { ...ownerCtx, actorUserId: "bd-member" },
    { orgId: acme.id, view: "mine" },
  );
  expect(assignments.filter(({ projectId }) => projectId === project.id).map(({ title }) => title))
    .toEqual(["Self assigned"]);
});

it("lets an organization member create and self-assign a task without a project row", async () => {
  const { project, todo } = await freshBoard("bd-org-self", "BDL");
  actor.id = "bd-member";

  const [workspace] = await listAssignmentCreateProjects([acme], actor.id);
  expect(workspace.projects).toContainEqual({
    slug: project.slug, name: project.name, key: project.key,
  });

  const checked = createForm(project.slug, todo.id, "Assigned to me");
  checked.set("assignSelf", "on");
  expect(await createTaskAction({}, checked)).toMatchObject({
    task: { href: "/bd-acme/bd-org-self/BDL-1", assignee: "BD-MEMBER" },
  });
});

it("the create action refuses a blank title and echoes it back", async () => {
  actor.id = "bd-owner";
  const { project, todo } = await freshBoard("bd-blank", "BDB");

  const state = await createTaskAction({}, createForm("bd-blank", todo.id, "   "));
  expect(state).toEqual({ error: expect.any(String), values: { title: "   " } });
  expect(await listTasks(ownerCtx, { projectId: project.id })).toEqual([]);
});
