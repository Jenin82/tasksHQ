import {
  createOrg,
  createProject,
  createTask,
  setProjectMemberRole,
  setProjectTaskEditRestriction,
  setReportingLead,
} from "@tasks/core/domain";
import { activity, comment, org, orgMember, task, user } from "@tasks/core/schema";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_TASK_IMAGE_BYTES } from "@tasks/core/task-images";
import { call, callResult, db } from "./helpers";

// Storage is shared across the run, so every id and slug here is `mc-`-prefixed.
const now = new Date();
const OWNER = "mc-owner"; // owner of mc-acme
const MEMBER = "mc-member"; // plain member of mc-acme, with no project role
const BYSTANDER = "mc-bystander"; // another plain member of mc-acme
const OUTSIDER = "mc-outsider"; // owner of mc-other, nothing in mc-acme
const ADMIN = "mc-admin"; // admin of mc-acme, on no project directly

const ctx = (userId: string) => ({ db, actorUserId: userId, source: "web" as const });

let eng: { id: string };

beforeAll(async () => {
  await db.insert(user).values(
    [OWNER, MEMBER, BYSTANDER, OUTSIDER, ADMIN].map((id) => ({
      id,
      name: id.toUpperCase(),
      // Mixed case on purpose: lookups must be case-insensitive (§3).
      email: `${id}@Example.test`,
      createdAt: now,
      updatedAt: now,
    })),
  );

  const acme = await createOrg(ctx(OWNER), { slug: "mc-acme", name: "Acme" });
  await db.insert(orgMember).values([
    { orgId: acme.id, userId: MEMBER, role: "member", createdAt: now },
    { orgId: acme.id, userId: BYSTANDER, role: "member", createdAt: now },
    { orgId: acme.id, userId: ADMIN, role: "admin", createdAt: now },
  ]);
  eng = await createProject(ctx(OWNER), {
    orgId: acme.id,
    slug: "engineering",
    name: "Engineering",
    key: "ENG",
  });
  await createProject(ctx(OWNER), {
    orgId: acme.id,
    slug: "ops",
    name: "Ops",
    key: "OPS",
  });

  const other = await createOrg(ctx(OUTSIDER), { slug: "mc-other", name: "Other" });
  await createProject(ctx(OUTSIDER), {
    orgId: other.id,
    slug: "secret",
    name: "Secret",
    key: "SEC",
  });

  // ENG-1 … ENG-3
  for (const title of ["First", "Second", "Third"]) {
    await createTask(ctx(OWNER), { projectId: eng.id, title });
  }
});

describe("list_projects", () => {
  it("returns all organization projects with statuses and a default task type", async () => {
    const { isError, data } = await call(MEMBER, "list_projects");
    expect(isError).toBe(false);
    expect(data).toEqual([
      {
        key: "ENG",
        slug: "engineering",
        name: "Engineering",
        org: "mc-acme",
        statuses: [
          { name: "Todo", color: "gray" },
          { name: "In Progress", color: "blue" },
          { name: "Done", color: "green" },
          { name: "Blocked", color: "red" },
        ],
        taskTypes: expect.arrayContaining([
          { id: expect.any(String), name: "Task", color: "gray", icon: "task", isDefault: true },
          { id: expect.any(String), name: "Bug", color: "red", icon: "bug", isDefault: false },
          { id: expect.any(String), name: "Knowledge Transfer (KT)", color: "purple", icon: "book", isDefault: false },
        ]),
      },
      expect.objectContaining({ key: "OPS", slug: "ops", org: "mc-acme" }),
    ]);
  });

  it("gives an org admin every project in the org without a project_member row", async () => {
    const admin = await call(ADMIN, "list_projects");
    expect(admin.data.map((p: any) => p.key)).toEqual(["ENG", "OPS"]);
    const outsider = await call(OUTSIDER, "list_projects");
    expect(outsider.data.map((p: any) => p.key)).toEqual(["SEC"]);
    const bystander = await call(BYSTANDER, "list_projects");
    expect(bystander.data.map((p: any) => p.key)).toEqual(["ENG", "OPS"]);
  });

  it("keeps project access independent of reporting lines", async () => {
    const [acme] = await db.select({ id: org.id }).from(org).where(eq(org.slug, "mc-acme"));
    const reportingLine = { orgId: acme.id, userId: MEMBER };
    await setReportingLead(ctx(OWNER), { ...reportingLine, leadUserId: BYSTANDER });
    try {
      const result = await call(BYSTANDER, "list_projects");
      expect(result.isError).toBe(false);
      expect(result.data).toMatchObject([{ key: "ENG" }, { key: "OPS" }]);
      const detail = await call(BYSTANDER, "get_task", { task: "ENG-1" });
      expect(detail.isError).toBe(false);
    } finally {
      await setReportingLead(ctx(OWNER), { ...reportingLine, leadUserId: null });
    }
    expect((await call(BYSTANDER, "list_projects")).data).toMatchObject([{ key: "ENG" }, { key: "OPS" }]);
  });
});

describe("create_task", () => {
  it("creates a bug in the first board status and resolves the assignee by email", async () => {
    const { isError, data } = await call(MEMBER, "create_task", {
      project: "eng",
      title: "From an agent",
      description: "**Body**",
      dueDate: "2026-11-09",
      priority: "high",
      type: "bug",
      assignee: "MC-MEMBER@example.test",
    });
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      key: "ENG-4",
      title: "From an agent",
      description: "**Body**",
      dueDate: "2026-11-09",
      priority: "high",
      type: "Bug",
      status: "Todo",
      assignee: { email: "mc-member@Example.test", displayName: "MC-MEMBER" },
    });
  });

  it("writes task.created with source mcp and the client's id and name", async () => {
    await call(MEMBER, "create_task", {
      project: "engineering",
      title: "Provenance",
      status: "in progress",
    });
    const [created] = await db
      .select({ id: task.id, number: task.number })
      .from(task)
      .where(and(eq(task.projectId, eng.id), eq(task.title, "Provenance")));
    const rows = await db
      .select()
      .from(activity)
      .where(eq(activity.taskId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "task.created",
      actorUserId: MEMBER,
      source: "mcp",
      clientId: `client-${MEMBER}`,
      clientName: "Claude Code",
    });
    expect(JSON.parse(rows[0].data).status.name).toBe("In Progress");
  });

  it("names the real statuses when given an unknown one", async () => {
    const { isError, data } = await call(MEMBER, "create_task", {
      project: "ENG",
      title: "x",
      status: "Waiting",
    });
    expect(isError).toBe(true);
    expect(data).toBe('No status named "Waiting" in ENG. Statuses: Todo, In Progress, Done, Blocked.');
  });

  it("refuses an assignee outside the organization and uses the same error for an unknown email", async () => {
    const offOrg = await call(MEMBER, "create_task", {
      project: "ENG",
      title: "x",
      assignee: `${OUTSIDER}@example.test`,
    });
    const unknown = await call(MEMBER, "create_task", {
      project: "ENG",
      title: "x",
      assignee: "nobody@example.test",
    });
    expect(offOrg.isError).toBe(true);
    expect(unknown).toEqual(offOrg);
  });
});

describe("list_tasks", () => {
  it("lists in board order, filters by status and assignee, and pages with a cursor", async () => {
    const first = await call(MEMBER, "list_tasks", { project: "ENG", status: "Todo", limit: 2 });
    expect(first.isError).toBe(false);
    expect(first.data.tasks.map((t: any) => t.key)).toEqual(["ENG-1", "ENG-2"]);
    expect(first.data.tasks[0]).toEqual({
      key: "ENG-1",
      title: "First",
      dueDate: null,
      priority: "medium",
      type: "Task",
      status: "Todo",
      assignee: null,
      reporter: { email: "mc-owner@Example.test", displayName: "MC-OWNER" },
      updatedAt: expect.any(String),
    });
    expect(first.data.cursor).toEqual(expect.any(String));

    const second = await call(MEMBER, "list_tasks", {
      project: "ENG",
      status: "Todo",
      limit: 2,
      cursor: first.data.cursor,
    });
    expect(second.data.tasks).toMatchObject([
      { key: "ENG-3", type: "Task" },
      { key: "ENG-4", type: "Bug" },
    ]);

    const mine = await call(MEMBER, "list_tasks", {
      project: "ENG",
      assignee: `${MEMBER}@example.test`,
    });
    expect(mine.data).toEqual({
      tasks: [expect.objectContaining({ key: "ENG-4" })],
    });
  });
});

describe("get_task", () => {
  it("returns the task with comments and activity", async () => {
    const { isError, data } = await call(MEMBER, "get_task", { task: "eng-4" });
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      key: "ENG-4",
      title: "From an agent",
      description: "**Body**",
      dueDate: "2026-11-09",
      priority: "high",
      type: "Bug",
      status: "Todo",
      assignee: { email: "mc-member@Example.test" },
      comments: [],
      activity: [
        {
          type: "task.created",
          source: "mcp",
          clientName: "Claude Code",
          actor: { displayName: "MC-MEMBER" },
        },
      ],
    });
  });
});

describe("update_task", () => {
  it("changes fields, logging a status change as task.moved", async () => {
    const { isError, data } = await call(MEMBER, "update_task", {
      task: "ENG-1",
      title: "First, renamed",
      dueDate: "2026-11-09",
      priority: "low",
      type: "Bug",
      status: "Done",
      assignee: `${MEMBER}@example.test`,
    });
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      key: "ENG-1",
      title: "First, renamed",
      dueDate: "2026-11-09",
      priority: "low",
      type: "Bug",
      status: "Done",
      assignee: { displayName: "MC-MEMBER" },
    });

    const detail = await call(MEMBER, "get_task", { task: "ENG-1" });
    const types = detail.data.activity.map((a: any) => [a.type, a.source]);
    expect(types).toEqual([
      ["task.created", "web"],
      ["task.updated", "mcp"],
      ["task.moved", "mcp"],
    ]);
  });

  it("clears due date and assignee and resets priority with null", async () => {
    const { data } = await call(MEMBER, "update_task", {
      task: "ENG-1",
      assignee: null,
      dueDate: null,
      priority: null,
    });
    expect(data).toMatchObject({ assignee: null, dueDate: null, priority: "medium", type: "Bug" });
  });

  it("rejects an unknown task type and points callers to the project's types", async () => {
    const { isError, data } = await call(MEMBER, "update_task", {
      task: "ENG-1",
      type: "unknown",
    });
    expect(isError).toBe(true);
    expect(data).toContain('No task type named "unknown" in ENG.');
    expect(data).toContain("Task types:");
  });
});

describe("project images", () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

  it("uploads a private WebP image and returns Markdown for the project", async () => {
    const { isError, data } = await call(MEMBER, "upload_project_image", {
      project: "ENG",
      base64: png,
    });
    expect(isError, String(data)).toBe(false);
    const { imageId, path, markdown } = data;
    expect(path).toBe(`/mc-acme/engineering/images/${imageId}`);
    expect(markdown).toBe(`![Task image](${path})`);

    const result = await callResult(MEMBER, "get_project_image", { project: "ENG", imageId });
    expect(result.isError).not.toBe(true);
    const [image] = result.content;
    expect(image?.type).toBe("image");
    if (image?.type !== "image") throw new Error("Expected an image tool result");
    expect(image.mimeType).toBe("image/webp");
    const header = atob(image.data).slice(0, 12);
    expect(header.startsWith("RIFF")).toBe(true);
    expect(header.slice(8)).toBe("WEBP");

    const inaccessible = await call(OUTSIDER, "get_project_image", { project: "ENG", imageId });
    expect(inaccessible).toEqual({ isError: true, data: "No such project." });
    const otherProject = await call(OWNER, "get_project_image", { project: "OPS", imageId });
    expect(otherProject).toEqual({ isError: true, data: "No such image." });
  });

  it("checks project access and rejects invalid or oversized base64", async () => {
    const inaccessible = await call(OUTSIDER, "upload_project_image", { project: "ENG", base64: png });
    expect(inaccessible).toEqual({ isError: true, data: "No such project." });
    const invalid = await call(MEMBER, "upload_project_image", {
      project: "ENG",
      base64: `data:image/png;base64,${png}`,
    });
    expect(invalid).toEqual({
      isError: true,
      data: "Provide valid base64 image data without a data URL prefix.",
    });
    // A decoded value one byte over the limit can still pass the encoded-length check.
    const oversized = await call(MEMBER, "upload_project_image", {
      project: "ENG",
      base64: "AAAA".repeat(Math.ceil(MAX_TASK_IMAGE_BYTES / 3)),
    });
    expect(oversized).toEqual({ isError: true, data: "Images must be 5 MB or smaller." });
  });
});

describe("add_comment", () => {
  it("adds a comment marked mcp", async () => {
    const { isError, data } = await call(MEMBER, "add_comment", {
      task: "ENG-2",
      body: "Looking into it",
    });
    expect(isError).toBe(false);
    expect(data).toEqual({ commentId: expect.any(String), createdAt: expect.any(String) });

    const [row] = await db.select().from(comment).where(eq(comment.id, data.commentId));
    expect(row).toMatchObject({ userId: MEMBER, body: "Looking into it", source: "mcp" });

    const detail = await call(MEMBER, "get_task", { task: "ENG-2" });
    expect(detail.data.comments).toEqual([
      expect.objectContaining({ id: data.commentId, body: "Looking into it", source: "mcp" }),
    ]);
  });
});

describe("archive_task", () => {
  it("archives, and archived tasks leave list_tasks unless asked for", async () => {
    const { isError, data } = await call(MEMBER, "archive_task", { task: "ENG-3" });
    expect(isError).toBe(false);
    expect(data).toEqual({ key: "ENG-3", archivedAt: expect.any(String) });

    const listed = await call(MEMBER, "list_tasks", { project: "ENG", limit: 200 });
    expect(listed.data.tasks.map((t: any) => t.key)).not.toContain("ENG-3");
    const withArchived = await call(MEMBER, "list_tasks", {
      project: "ENG",
      includeArchived: true,
      limit: 200,
    });
    expect(withArchived.data.tasks.map((t: any) => t.key)).toContain("ENG-3");
  });
});

describe("reach", () => {
  it("answers another org's task exactly as it answers a task that does not exist", async () => {
    const real = await call(OUTSIDER, "get_task", { task: "ENG-2" });
    const missing = await call(OUTSIDER, "get_task", { task: "ENG-999" });
    expect(real).toEqual({ isError: true, data: "No such task." });
    expect(missing).toEqual(real);

    const project = await call(OUTSIDER, "list_tasks", { project: "ENG" });
    expect(project).toEqual({ isError: true, data: "No such project." });
  });

  it("refuses every mutation from a non-member and changes nothing", async () => {
    const before = await db.select().from(activity).where(eq(activity.projectId, eng.id));

    for (const [name, args] of [
      ["update_task", { task: "ENG-2", title: "Hijacked" }],
      ["add_comment", { task: "ENG-2", body: "hi" }],
      ["archive_task", { task: "ENG-2" }],
      ["create_task", { project: "ENG", title: "Hijacked" }],
    ] as const) {
      const result = await call(OUTSIDER, name, args);
      expect(result.isError, name).toBe(true);
      expect(result.data, name).toMatch(/^No such (task|project)\.$/);
    }

    const after = await db.select().from(activity).where(eq(activity.projectId, eng.id));
    expect(after).toHaveLength(before.length);
  });

  it("lets a plain org member read and assign tasks without a project role", async () => {
    expect(await call(BYSTANDER, "get_task", { task: "ENG-2" })).toMatchObject({
      isError: false, data: { key: "ENG-2" },
    });
    expect(await call(MEMBER, "create_task", {
      project: "OPS", title: "Assign a workspace member", assignee: `${BYSTANDER}@example.test`,
    })).toMatchObject({ isError: false, data: { key: "OPS-1", assignee: { displayName: "MC-BYSTANDER" } } });
  });
});

it("refuses a cursor it did not issue", async () => {
  const result = await call(MEMBER, "list_tasks", { project: "ENG", cursor: "%%%" });
  expect(result).toEqual({ isError: true, data: "Invalid cursor." });
});

it("lets MCP members create and comment while restricting edits to task participants and admins", async () => {
  const [workspace] = await db.select({ id: org.id }).from(org).where(eq(org.slug, "mc-acme"));
  const project = await createProject(ctx(OWNER), {
    orgId: workspace.id,
    slug: "restricted",
    name: "Restricted",
    key: "MCR",
  });
  const created = await createTask(ctx(OWNER), {
    projectId: project.id,
    title: "Participant task",
    assigneeUserId: MEMBER,
  });
  await setProjectTaskEditRestriction(ctx(ADMIN), { projectId: project.id, restricted: true });
  const task = created.key;
  const forbidden = { isError: true, data: "Only the creator, reporter, current assignee, or an admin can edit this task." };
  expect(await call(ADMIN, "update_task", { task, title: "Workspace admin edit" })).toMatchObject({
    isError: false, data: { title: "Workspace admin edit" },
  });
  expect(await call(BYSTANDER, "archive_task", { task })).toEqual(forbidden);
  expect(await call(BYSTANDER, "create_task", { project: "MCR", title: "A member's task" })).toMatchObject({
    isError: false, data: { title: "A member's task" },
  });
  expect(await call(MEMBER, "update_task", { task, title: "Assignee edit" })).toMatchObject({
    isError: false, data: { title: "Assignee edit" },
  });
  expect(await call(BYSTANDER, "add_comment", { task, body: "A reader's comment" })).toMatchObject({
    isError: false, data: { commentId: expect.any(String) },
  });
  expect(await call(BYSTANDER, "get_task", { task })).toMatchObject({
    isError: false,
    data: { title: "Assignee edit", comments: [{ body: "A reader's comment", source: "mcp" }] },
  });
  await setProjectMemberRole(ctx(OWNER), { projectId: project.id, userId: BYSTANDER, role: "admin" });
  expect(await call(BYSTANDER, "update_task", { task, title: "Project admin edit" })).toMatchObject({
    isError: false, data: { title: "Project admin edit" },
  });
});

it("sets the reporter by email on create and update, and returns it from every task view", async () => {
  const created = await call(MEMBER, "create_task", { project: "OPS", title: "Default reporter" });
  expect(created).toMatchObject({
    isError: false, data: { reporter: { email: "mc-member@Example.test", displayName: "MC-MEMBER" } },
  });

  const reported = await call(MEMBER, "create_task", {
    project: "OPS", title: "Reported by someone else", reporter: "MC-BYSTANDER@example.test",
  });
  expect(reported).toMatchObject({
    isError: false, data: { reporter: { email: "mc-bystander@Example.test", displayName: "MC-BYSTANDER" } },
  });
  const outside = await call(MEMBER, "create_task", {
    project: "OPS", title: "x", reporter: `${OUTSIDER}@example.test`,
  });
  expect(outside).toEqual({ isError: true, data: "That user must be a member of this organization." });

  const key = reported.data.key;
  // Another member edits, so the creator's setup window does not hide the activity row.
  expect(await call(BYSTANDER, "update_task", { task: key, reporter: `${ADMIN}@example.test` })).toMatchObject({
    isError: false, data: { reporter: { displayName: "MC-ADMIN" } },
  });
  const detail = await call(MEMBER, "get_task", { task: key });
  expect(detail.data.reporter).toEqual({ email: "mc-admin@Example.test", displayName: "MC-ADMIN" });
  expect(detail.data.activity.at(-1)).toMatchObject({ type: "task.updated", source: "mcp", actor: { displayName: "MC-BYSTANDER" } });
  const listed = await call(MEMBER, "list_tasks", { project: "OPS" });
  expect(listed.data.tasks.find((t: any) => t.key === key).reporter)
    .toEqual({ email: "mc-admin@Example.test", displayName: "MC-ADMIN" });
  expect(await call(MEMBER, "update_task", { task: key, reporter: `${OUTSIDER}@example.test` }))
    .toEqual({ isError: true, data: "That user must be a member of this organization." });
});
