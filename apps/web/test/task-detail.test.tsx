import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  addComment,
  createOrg,
  createProject,
  createTask,
  getTaskDetail,
  parseTaskKey,
  type TaskActivityEntry,
  type TaskDetail,
} from "@tasks/core/domain";
import { activity, orgMember, status, task as taskTable, user } from "@tasks/core/schema";

// Same seam as test/table.test.tsx: the route layer reads the session through
// this module, and the pool gives no live request context.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@detail.test`,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const { ActivityLog, groupDescriptionActivity, SourceBadge } = await import(
  "@/app/[org]/[project]/[task]/activity-log"
);
const { addCommentAction, editTaskAction, setStatusAction, transferTaskAction } = await import(
  "@/app/[org]/[project]/[task]/actions"
);
const { GET: readDialogDetails } = await import(
  "@/app/[org]/[project]/[task]/details/route"
);
const { TaskDetailContent } = await import("@/app/[org]/[project]/[task]/task-detail-content");
const { readTaskDetail } = await import("@/app/[org]/[project]/[task]/task-detail-data");
const TaskDetailPage = (
  await import("@/app/[org]/[project]/[task]/page")
).default;

const db = drizzle(env.DB);
const now = new Date();

// Shared storage (§12: no per-test isolation), so every id and slug is `td-`.
const IDS = ["td-owner", "td-member", "td-stranger"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@detail.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

const ownerCtx = { db, actorUserId: "td-owner", source: "web" as const };

function finishTaskSetup(taskId: string) {
  return db.update(taskTable)
    .set({ createdAt: new Date(Date.now() - 10 * 60 * 1000) })
    .where(eq(taskTable.id, taskId));
}

actor.id = "td-owner";
const acme = await createOrg(ownerCtx, { slug: "td-acme", name: "TD Acme" });
await db.insert(orgMember).values({
  orgId: acme.id,
  userId: "td-member",
  role: "member",
  createdAt: now,
});

const web = await createProject(ownerCtx, {
  orgId: acme.id,
  slug: "web",
  name: "Web",
  key: "TDW",
});
const destination = await createProject(ownerCtx, {
  orgId: acme.id,
  slug: "delivery",
  name: "Delivery",
  key: "TDD",
});
const statuses = await db
  .select()
  .from(status)
  .where(eq(status.projectId, web.id))
  .orderBy(asc(status.position), asc(status.id));

const tasks: TaskDetail[] = [];
for (const title of ["One", "Two", "Three", "Four", "Five"]) {
  tasks.push(await createTask(ownerCtx, { projectId: web.id, title }));
}

/** vinext's navigation errors carry Next's digest; 404 and 403 differ only there. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

const render = (node: React.ReactNode) => renderToStaticMarkup(node);

const page = (task: string) =>
  TaskDetailPage({
    params: Promise.resolve({ org: "td-acme", project: "web", task }),
  });

function dialogDetails(task: string, project = "web") {
  const request = new Request(`http://localhost:5173/td-acme/${project}/${task}/details`);
  return readDialogDetails(request, {
    params: Promise.resolve({ org: "td-acme", project, task }),
  });
}

// ---------------------------------------------------------------------------
// resolving the display key
// ---------------------------------------------------------------------------

it("parses a display key back, and refuses the shapes that are not one", () => {
  expect(parseTaskKey("TDW-5")).toEqual({ projectKey: "TDW", number: 5 });
  // Case is settled by `getTaskByKey`, not here.
  expect(parseTaskKey("tdw-5")).toEqual({ projectKey: "tdw", number: 5 });
  // The counter starts at one, so neither of these is a key any task has.
  expect(parseTaskKey("TDW-0")).toBeNull();
  expect(parseTaskKey("TDW-05")).toBeNull();
  expect(parseTaskKey("TDW")).toBeNull();
  expect(parseTaskKey("TDW-")).toBeNull();
  expect(parseTaskKey("5")).toBeNull();
  expect(parseTaskKey("TDW-5-1")).toBeNull();
});

it("resolves TDW-5 to the fifth task, case-insensitively on the project key", async () => {
  actor.id = "td-owner";

  const html = render(await page("TDW-5"));
  expect(html).toContain("TDW-5");
  expect(html).toContain("Five");
  expect(html).not.toContain("Four");

  // The URL's project half is lowercase, so a hand-typed lowercase key is the
  // ordinary case rather than a 404.
  expect(render(await page("tdw-5"))).toContain("Five");
});

it("gives an unknown key and an unreachable task the identical notFound()", async () => {
  actor.id = "td-owner";

  // A key no task has, a key that is not a key at all, and a key naming
  // another project — one answer for all three.
  await expect(page("TDW-999")).rejects.toMatchObject(NOT_FOUND);
  await expect(page("not-a-key")).rejects.toMatchObject(NOT_FOUND);
  await expect(page("OTH-1")).rejects.toMatchObject(NOT_FOUND);

  // A task that exists and is reachable — but not by this caller, who is a
  // plain org member with no `project_member` row.
  actor.id = "td-stranger";
  await expect(page("TDW-5")).rejects.toMatchObject(NOT_FOUND);
  await expect(page("TDW-999")).rejects.toMatchObject(NOT_FOUND);
});

it("keeps textarea mention offsets through multipart newline normalization", async () => {
  actor.id = "td-owner";
  const item = await createTask(ownerCtx, { projectId: web.id, title: "Comment mention offsets" });
  const body = "First line 📝\n@TD-MEMBER can you check this?";
  const start = body.indexOf("@");
  const end = start + "@TD-MEMBER".length;
  const form = new FormData();
  form.set("org", acme.slug);
  form.set("project", web.slug);
  form.set("taskId", item.id);
  form.set("body", body);
  form.set("mentions", JSON.stringify([{ userId: "td-member", start, end }]));
  const multipart = await new Request("https://tasks.example.test", { method: "POST", body: form }).formData();

  expect(await addCommentAction({}, multipart)).toEqual({});
  const data = await readTaskDetail(acme.slug, web.slug, item.key);
  expect(data.detail.comments).toMatchObject([{ body, mentions: [{ userId: "td-member", start, end }] }]);
  expect(renderToStaticMarkup(<TaskDetailContent data={data} />)).toMatch(/<span[^>]*font-semibold[^>]*>@TD-MEMBER<\/span>/);
});

it("loads private dialog details with comments, activity and editable options", async () => {
  actor.id = "td-owner";
  const task = await createTask(ownerCtx, {
    projectId: web.id,
    title: "Task opened in a dialog",
    description: "Loaded with the history",
    dueDate: "2028-02-29",
    priority: "high",
  });
  const entry = await addComment(
    { ...ownerCtx, source: "mcp", clientId: "private-client-id", clientName: "Claude" },
    { taskId: task.id, body: "First comment" },
  );

  const response = await dialogDetails(task.key);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    ids: { orgSlug: "td-acme", projectSlug: "web", taskId: task.id },
    statuses: statuses.map(({ id, name, color }) => ({ id, name, color })),
    assignable: [{ userId: "td-member", name: "TD-MEMBER" }, { userId: "td-owner", name: "TD-OWNER" }],
    moveTargets: expect.arrayContaining([{ id: destination.id, name: destination.name }]),
    detail: {
      key: task.key,
      title: task.title,
      description: task.description,
      dueDate: "2028-02-29",
      priority: "high",
      createdBy: { id: "td-owner", displayName: "TD-OWNER" },
      createdAt: task.createdAt.toISOString(),
      comments: [{ id: entry.id, body: entry.body, createdAt: entry.createdAt.toISOString() }],
      activity: [
        { type: "task.created", source: "web" },
        { type: "comment.added", source: "mcp", clientName: "Claude", clientId: null },
      ],
    },
  });
});

it("renders named task pickers and actions on the page and in the dialog", async () => {
  actor.id = "td-owner";
  const task = tasks[0];
  const data = await readTaskDetail(acme.slug, web.slug, task.key);
  const views = [render(await page(task.key)), render(<TaskDetailContent data={data} inDialog />)];

  for (const html of views) {
    const pickerNames = [...html.matchAll(/<button\b[^>]*\baria-labelledby="([^"]+)"[^>]*>[\s\S]*?<\/button>/g)]
      .map(([button, labels]) => labels.split(" ").map((id) => {
        const label = button.split(`id="${id}"`)[1];
        return label?.match(/^[^>]*>([^<]*)</)?.[1];
      }).join(" "));
    expect(pickerNames).toEqual(expect.arrayContaining([
      `Status ${task.status.name}`,
      "Assignee Unassigned",
      `Type ${task.type.name}`,
      "Priority Medium",
    ]));
    expect(html).toContain("Share</button>");
    expect(html).toContain("Move</button>");
    expect(html).toContain("Archive</button>");
  }
});

it("redirects the move form and old page to the new key for callers with access", async () => {
  actor.id = "td-owner";
  const task = await createTask(ownerCtx, { projectId: web.id, title: "Follow old task link" });
  const form = new FormData();
  form.set("org", acme.slug);
  form.set("project", web.slug);
  form.set("taskId", task.id);
  form.set("destinationProjectId", destination.id);

  const nextPath = `/${acme.slug}/${destination.slug}/TDD-1`;
  const redirect = {
    digest: expect.stringMatching(`^NEXT_REDIRECT;[^;]*;${encodeURIComponent(nextPath)}(;|$)`),
  };
  await expect(transferTaskAction({}, form)).rejects.toMatchObject(redirect);
  await expect(page(task.key)).rejects.toMatchObject(redirect);
  await expect(dialogDetails(task.key)).rejects.toMatchObject(NOT_FOUND);
  expect((await dialogDetails("TDD-1", destination.slug)).status).toBe(200);

  actor.id = "td-member";
  await expect(page(task.key)).rejects.toMatchObject(redirect);
  actor.id = "td-stranger";
  await expect(page(task.key)).rejects.toMatchObject(NOT_FOUND);
  actor.id = "td-owner";
});

it("saves task metadata from the detail forms and leaves omitted fields intact", async () => {
  actor.id = "td-owner";
  const task = await createTask(ownerCtx, { projectId: web.id, title: "Detail fields" });
  function fields() {
    const form = new FormData();
    form.set("org", acme.slug);
    form.set("project", web.slug);
    form.set("taskId", task.id);
    return form;
  }

  const date = fields();
  date.set("dueDate", "2028-02-29");
  expect(await editTaskAction({}, date)).toEqual({});

  const priority = fields();
  priority.set("priority", "high");
  expect(await editTaskAction({}, priority)).toEqual({});
  expect(await getTaskDetail(ownerCtx, { taskId: task.id })).toMatchObject({
    dueDate: "2028-02-29",
    priority: "high",
  });

  const clear = fields();
  clear.set("dueDate", "2028-02-29");
  clear.set("clearDueDate", "1");
  expect(await editTaskAction({}, clear)).toEqual({});
  expect(await getTaskDetail(ownerCtx, { taskId: task.id })).toMatchObject({
    dueDate: null,
    priority: "high",
  });
});

it("gives invalid keys, a different project and callers without reach the same dialog 404", async () => {
  actor.id = "td-owner";
  const otherProject = await createProject(ownerCtx, {
    orgId: acme.id,
    slug: "other",
    name: "Other",
    key: "TDO",
  });
  const otherTask = await createTask(ownerCtx, { projectId: otherProject.id, title: "Other project" });
  await expect(dialogDetails(otherTask.key)).rejects.toMatchObject(NOT_FOUND);
  await expect(dialogDetails(tasks[0].key, otherProject.slug)).rejects.toMatchObject(NOT_FOUND);
  await expect(dialogDetails("not-a-key")).rejects.toMatchObject(NOT_FOUND);

  actor.id = "td-stranger";
  await expect(dialogDetails(tasks[0].key)).rejects.toMatchObject(NOT_FOUND);
});

// ---------------------------------------------------------------------------
// §3's ordering rule
// ---------------------------------------------------------------------------

it("orders activity by rowid when two rows share a created_at millisecond", async () => {
  const task = tasks[0];
  // Deliberate collision: one instant, and an id on the first row that sorts
  // *after* the second's. `ORDER BY created_at, id` would return them
  // reversed; `ORDER BY created_at, rowid` returns them as written.
  const instant = new Date(now.getTime() + 60_000);
  const rows = [
    { id: "td-zz-first", type: "task.archived" as const },
    { id: "td-aa-second", type: "task.unarchived" as const },
  ];
  for (const row of rows) {
    await db.insert(activity).values({
      id: row.id,
      projectId: web.id,
      taskId: task.id,
      actorUserId: "td-owner",
      source: "web",
      clientId: null,
      clientName: null,
      type: row.type,
      data: "{}",
      createdAt: instant,
    });
  }

  const detail = await getTaskDetail(ownerCtx, { taskId: task.id });
  const written = detail.activity.filter((e) => e.id.startsWith("td-"));
  expect(written.map((e) => e.id)).toEqual(["td-zz-first", "td-aa-second"]);
});

it("keeps task.updated before task.moved when one call writes both", async () => {
  // §3's real-data case: one `updateTask` writes both rows one `await` apart.
  // Measured here, 4 pairs in 10 landed in the same millisecond — so this is
  // the scenario the rule exists for, but it is not deterministic, which is
  // why the test above constructs the collision instead of waiting for it.
  // Several rounds, each asserted, rather than one coin flip.
  const { updateTask } = await import("@tasks/core/domain");
  for (let round = 0; round < 6; round++) {
    const task = await createTask(ownerCtx, {
      projectId: web.id,
      title: `Both at once ${round}`,
    });
    await finishTaskSetup(task.id);
    await updateTask(ownerCtx, {
      taskId: task.id,
      title: `Renamed and moved ${round}`,
      statusId: statuses[2].id,
    });

    const detail = await getTaskDetail(ownerCtx, { taskId: task.id });
    expect(detail.activity.map((e) => e.type)).toEqual([
      "task.created",
      "task.updated",
      "task.moved",
    ]);
  }
});

// ---------------------------------------------------------------------------
// §3's precedence rule, through this page
// ---------------------------------------------------------------------------

it("logs task.moved — never task.updated — for a status change from the detail page", async () => {
  actor.id = "td-owner";
  const task = await createTask(ownerCtx, {
    projectId: web.id,
    title: "Status from the page",
  });
  await finishTaskSetup(task.id);

  const form = new FormData();
  form.set("org", "td-acme");
  form.set("project", "web");
  form.set("taskId", task.id);
  form.set("statusId", statuses[1].id);

  expect(await setStatusAction({}, form)).toEqual({});

  const detail = await getTaskDetail(ownerCtx, { taskId: task.id });
  const types = detail.activity.map((e) => e.type);
  expect(types).toContain("task.moved");
  expect(types).not.toContain("task.updated");

  const moved = detail.activity.find((e) => e.type === "task.moved");
  // §3's exact payload: reference fields are `{id, name}`, never a bare id.
  expect(moved?.data).toEqual({
    from: { id: statuses[0].id, name: statuses[0].name },
    to: { id: statuses[1].id, name: statuses[1].name },
  });
});

// ---------------------------------------------------------------------------
// the renderer
// ---------------------------------------------------------------------------

const meta = {
  actor: { id: "td-owner", displayName: "TD OWNER" },
  source: "web" as const,
  clientId: null,
  clientName: null,
  createdAt: now,
};

const todo = { id: "s1", name: "Todo" };
const done = { id: "s2", name: "Done" };

function descriptionSave(
  minute: number,
  from: string | null,
  to: string | null,
  actor = meta.actor,
): Extract<TaskActivityEntry, { type: "task.updated" }> {
  return {
    ...meta,
    id: `description-${minute}`,
    actor,
    createdAt: new Date(now.getTime() + minute * 60_000),
    type: "task.updated",
    data: { fields: { description: { from, to } } },
  };
}

it("groups description saves within ten minutes of the first save", () => {
  const first = descriptionSave(0, null, "Draft");
  const atLimit = descriptionSave(10, "Draft", "Polished");
  const later = descriptionSave(11, "Polished", "Final");

  expect(groupDescriptionActivity([first, atLimit, later])).toEqual([
    { ...atLimit, data: { fields: { description: { from: null, to: "Polished" } } } },
    later,
  ]);
  expect(atLimit.data.fields.description?.from).toBe("Draft");
});

it("keeps description saves separate across another actor or other activity", () => {
  const first = descriptionSave(0, "A", "B");
  const otherActor = descriptionSave(1, "B", "C", { ...meta.actor, id: "td-other" });
  const resumed = descriptionSave(2, "C", "D");
  const mixed = descriptionSave(3, "D", "E");
  mixed.data.fields.title = { from: "Old title", to: "New title" };
  const next = descriptionSave(4, "E", "F");
  const moved: TaskActivityEntry = {
    ...meta,
    id: "move",
    type: "task.moved",
    data: { from: todo, to: done },
    createdAt: new Date(now.getTime() + 5 * 60_000),
  };
  const last = descriptionSave(6, "F", "G");
  const removed = descriptionSave(7, "G", null);
  const entries = [first, otherActor, resumed, mixed, next, moved, last, removed];

  expect(groupDescriptionActivity(entries)).toEqual(entries);
});

/**
 * One entry per member of `TaskActivityType`. Adding a type to that union
 * without adding it here leaves this array short of the switch it is meant to
 * cover, and `describe`'s `never` default already refuses to compile without
 * the case itself.
 */
const EVERY_TYPE: TaskActivityEntry[] = [
  { ...meta, id: "a1", type: "task.created", data: { title: "One", status: todo } },
  {
    ...meta,
    id: "a2",
    type: "task.updated",
    data: {
      fields: {
        title: { from: "One", to: "Two" },
        description: { from: null, to: "A body" },
        assignee: { from: null, to: { id: "td-owner", displayName: "TD OWNER" } },
      },
    },
  },
  { ...meta, id: "a3", type: "task.moved", data: { from: todo, to: done } },
  { ...meta, id: "a4", type: "task.archived", data: {} },
  { ...meta, id: "a5", type: "task.unarchived", data: {} },
  {
    ...meta,
    id: "a6",
    type: "comment.added",
    data: { commentId: "c1", excerpt: "Looks right to me" },
  },
  {
    ...meta,
    id: "a7",
    type: "task.transferred",
    data: { status: { from: "Triage", to: "Backlog" }, fields: {} },
  },
];

it("renders every TaskActivityType, task.unarchived included", () => {
  const html = render(<ActivityLog entries={EVERY_TYPE} />);

  expect(html).toContain("created this task");
  expect(html).toContain("renamed this task to");
  expect(html).toContain("added a description");
  expect(html).toContain("assigned");
  expect(html).toContain("moved this task");
  expect(html).toContain("moved this task to another project");
  expect(html).toContain("archived this task");
  expect(html).toContain("unarchived this task");
  expect(html).toContain("Looks right to me");
  // §3: statuses render by name, never as a bare id.
  expect(html).toContain("Todo");
  expect(html).toContain("Done");
  expect(html).not.toContain("s1");
  expect(html).not.toContain("s2");

  // Every entry produced a row: nothing was silently swallowed.
  expect(html.match(/<li/g)).toHaveLength(EVERY_TYPE.length);
});

it("renders an MCP row with its client name differently from a web one", () => {
  const web = render(<SourceBadge source="web" />);
  const mcp = render(
    <SourceBadge source="mcp" clientName="Claude Desktop" />,
  );
  const anonymous = render(<SourceBadge source="mcp" />);

  expect(web).not.toEqual(mcp);
  expect(web).toContain('data-source="web"');
  expect(mcp).toContain('data-source="mcp"');
  // §5.7 records `clientName` at consent precisely so "which agent did this"
  // is answerable here.
  expect(mcp).toContain("Claude Desktop");
  expect(web).not.toContain("Claude Desktop");
  // A grant with no client name still says where it came from.
  expect(anonymous).toContain("mcp");
  expect(anonymous).not.toContain("Claude Desktop");
});

it("renders provenance on the page itself, not only in the badge", async () => {
  actor.id = "td-owner";
  const task = tasks[1];
  await db.insert(activity).values({
    id: "td-mcp-row",
    projectId: web.id,
    taskId: task.id,
    actorUserId: "td-owner",
    source: "mcp",
    clientId: "client-123",
    clientName: "Claude Desktop",
    type: "task.archived",
    data: "{}",
    createdAt: new Date(now.getTime() + 120_000),
  });

  const html = render(await page(task.key));
  expect(html).toContain('data-source="mcp"');
  expect(html).toContain("Claude Desktop");
  // The client id is provenance for the log, not something to put on screen.
  expect(html).not.toContain("client-123");
});
