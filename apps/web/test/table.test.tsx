import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  archiveTask,
  createOrg,
  createProject,
  createTask,
  listTasks,
  listWorkspaceAssignments,
} from "@tasks/core/domain";
import { orgMember, status, user, type Status } from "@tasks/core/schema";
import { emptyProjectFilters, ProjectFiltersContext } from "@/components/project-filters-context";
import { statusDot } from "@/lib/status-style";

// Same seam as test/board.test.ts: the route layer reads the session through
// this module, and the pool gives no live request context.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@table.test`,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const { getProjectContext } = await import("@/lib/project-context");
const { toRows } = await import("@/app/[org]/[project]/table/rows");
const { TaskTable } = await import("@/app/[org]/[project]/table/task-table");
const { WorkspaceAssignmentTable } = await import("@/app/[org]/(org)/settings/workspace-assignment-table");
const { filterTasksByPeople } = await import("@/app/[org]/[project]/task-people-filters");
const TablePage = (await import("@/app/[org]/[project]/table/page")).default;

const db = drizzle(env.DB);
const now = new Date();

// Shared storage (§12: no per-test isolation), so every id and slug is `tb-`.
const IDS = ["tb-owner", "tb-member", "tb-stranger"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@table.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

const ownerCtx = { db, actorUserId: "tb-owner", source: "web" as const };

actor.id = "tb-owner";
const acme = await createOrg(ownerCtx, { slug: "tb-acme", name: "TB Acme" });
await db.insert(orgMember).values({
  orgId: acme.id,
  userId: "tb-member",
  role: "member",
  createdAt: now,
});

/** vinext's navigation errors carry Next's digest; 404 and 403 differ only there. */
const digest = (code: number) => ({
  digest: `NEXT_HTTP_ERROR_FALLBACK;${code}`,
});

async function freshProject(slug: string, key: string) {
  const project = await createProject(ownerCtx, {
    orgId: acme.id,
    slug,
    name: slug,
    key,
  });
  const statuses = await db
    .select({ id: status.id, name: status.name })
    .from(status)
    .where(eq(status.projectId, project.id))
    .orderBy(asc(status.position), asc(status.id));
  return { project, statuses };
}

it("filters the cross-organization table by project even when names, slugs, and task keys match", async () => {
  const orgs = await Promise.all([
    createOrg(ownerCtx, { slug: "tb-first", name: "TB First" }),
    createOrg(ownerCtx, { slug: "tb-second", name: "TB Second" }),
  ]);
  const taskLists = await Promise.all(orgs.map(async (organization) => {
    const project = await createProject(ownerCtx, {
      orgId: organization.id, slug: "shared", name: "Shared", key: "SHR",
    });
    await createTask(ownerCtx, { projectId: project.id, title: organization.name, assigneeUserId: ownerCtx.actorUserId });
    const tasks = await listWorkspaceAssignments(ownerCtx, { orgId: organization.id, view: "mine" });
    return tasks.map((task) => ({ ...task, orgSlug: organization.slug, orgName: organization.name }));
  }));
  const props = { title: "All My Tasks", editors: {}, emptyMessage: "No tasks.", filterScope: "tb-cross-org" };
  const combined = renderToStaticMarkup(
    <WorkspaceAssignmentTable {...props} tasks={taskLists.flat()} organizations={orgs} />,
  );
  expect(combined).toContain(">Organization");
  expect(combined).toContain('href="/tb-first/shared/SHR-1"');
  expect(combined).toContain('href="/tb-second/shared/SHR-1"');

  const filtered = renderToStaticMarkup(
    <ProjectFiltersContext.Provider value={{
      filters: { ...emptyProjectFilters(), projectId: taskLists[0][0].projectId },
      setFilters: () => {},
    }}>
      <WorkspaceAssignmentTable {...props} tasks={taskLists.flat()} organizations={orgs} />
    </ProjectFiltersContext.Provider>,
  );
  expect(filtered).toContain('href="/tb-first/shared/SHR-1"');
  expect(filtered).not.toContain('href="/tb-second/shared/SHR-1"');

  const single = renderToStaticMarkup(<WorkspaceAssignmentTable {...props} tasks={taskLists[0]} />);
  expect(single).not.toContain(">Organization");
});

/** What the page does, end to end: read, map, render. */
async function render(projectId: string, statuses: Pick<Status, "id" | "name">[]) {
  const tasks = await listTasks(ownerCtx, { projectId });
  return renderToStaticMarkup(
    <TaskTable
      statuses={statuses}
      rows={toRows(tasks, statuses, "/tb-acme/p")}
      boardHref="/tb-acme/p"
    />,
  );
}

/** The work item cell starts with the task key at every viewport size. */
const renderedKeys = (html: string) =>
  [...html.matchAll(/<tr\b[^>]*><td\b[^>]*><span\b[^>]*>([A-Z0-9]+-\d+)<\/span>/g)]
    .map((match) => match[1]);

it("matches any selected person within a filter and requires both filters to match", () => {
  const alex = { id: "alex", displayName: "Alex" };
  const sam = { id: "sam", displayName: "Sam" };
  const jamie = { id: "jamie", displayName: "Jamie" };
  const matchingAssignee = { assignee: alex, createdBy: sam };
  const matchingUnassigned = { assignee: null, createdBy: jamie };
  const wrongCreator = { assignee: alex, createdBy: alex };
  const wrongAssignee = { assignee: sam, createdBy: jamie };
  const rows = [matchingAssignee, matchingUnassigned, wrongCreator, wrongAssignee];

  expect(filterTasksByPeople(rows, new Set(), new Set())).toEqual(rows);
  expect(filterTasksByPeople(rows, new Set([alex.id, null]), new Set([sam.id, jamie.id])))
    .toEqual([matchingAssignee, matchingUnassigned]);
  expect(filterTasksByPeople(rows, new Set([null]), new Set())).toEqual([matchingUnassigned]);
  expect(filterTasksByPeople(rows, new Set(), new Set([jamie.id])))
    .toEqual([matchingUnassigned, wrongAssignee]);
});

it("the table's data path is a 404 for a non-member and for an unknown project", async () => {
  await freshProject("tb-reach", "TBR");

  actor.id = "tb-member";
  await expect(getProjectContext("tb-acme", "tb-reach")).resolves.toMatchObject({
    project: { slug: "tb-reach" }, projectRole: null,
  });
  await expect(getProjectContext("tb-acme", "tb-nope")).rejects.toMatchObject(
    digest(404),
  );

  // Someone outside the org never gets past the org check.
  actor.id = "tb-stranger";
  await expect(getProjectContext("tb-acme", "tb-reach")).rejects.toMatchObject(
    digest(404),
  );

  // The owner reaches it, so the 404s above are the rule and not a broken
  // query.
  actor.id = "tb-owner";
  const ctx = await getProjectContext("tb-acme", "tb-reach");
  expect(ctx.project.slug).toBe("tb-reach");
});

it("sorts the key column by number, so WEB-2 comes before WEB-10", async () => {
  actor.id = "tb-owner";
  const { project, statuses } = await freshProject("tb-keys", "WEB");

  for (let n = 1; n <= 10; n++) {
    await createTask(ownerCtx, { projectId: project.id, title: `Task ${n}` });
  }

  // Handed to the table backwards, or this would pass without the table
  // sorting anything: `listTasks` appends, so its own order is already
  // `WEB-1 … WEB-10`.
  const tasks = await listTasks(ownerCtx, { projectId: project.id });
  const rows = toRows(tasks, statuses, "/tb-acme/p").reverse();
  expect(rows[0].key).toBe("WEB-10");

  const keys = renderedKeys(
    renderToStaticMarkup(<TaskTable statuses={statuses} rows={rows} boardHref="/tb-acme/p" />),
  );
  expect(keys).toEqual([
    "WEB-1",
    "WEB-2",
    "WEB-3",
    "WEB-4",
    "WEB-5",
    "WEB-6",
    "WEB-7",
    "WEB-8",
    "WEB-9",
    "WEB-10",
  ]);

  // Not a tautology: a string sort of the same keys is a different order, and
  // it is the one a reader would notice first.
  expect([...keys].sort()).not.toEqual(keys);
  expect([...keys].sort()[1]).toBe("WEB-10");
});

it("leaves archived tasks out of the table by default", async () => {
  actor.id = "tb-owner";
  const { project, statuses } = await freshProject("tb-archive", "ARC");

  await createTask(ownerCtx, { projectId: project.id, title: "Still open" });
  const gone = await createTask(ownerCtx, {
    projectId: project.id,
    title: "Done with",
  });
  await archiveTask(ownerCtx, { taskId: gone.id });

  expect(renderedKeys(await render(project.id, statuses))).toEqual(["ARC-1"]);

  // The row exists and is reachable — it is the default that hides it, not a
  // missing task.
  const all = await listTasks(ownerCtx, {
    projectId: project.id,
    includeArchived: true,
  });
  expect(all.map((t) => t.key)).toEqual(["ARC-1", "ARC-2"]);
});

it("renders priority and due date as separate cells in the scrollable table", async () => {
  const { project, statuses } = await freshProject("tb-deadline", "TBD");
  await createTask(ownerCtx, {
    projectId: project.id,
    title: "Time-sensitive task",
    assigneeUserId: ownerCtx.actorUserId,
    dueDate: "2026-02-03",
    priority: "high",
  });
  await createTask(ownerCtx, { projectId: project.id, title: "Undated task" });

  const html = await render(project.id, statuses);
  const [dated, undated] = [...html.matchAll(/<tr\b[^>]*><td\b[\s\S]*?<\/tr>/g)]
    .map(([row]) => row);

  expect(html).toMatch(/<th\b[^>]*><button\b[^>]*>Priority</);
  expect(html).toMatch(/<th\b[^>]*><button\b[^>]*>Due date</);
  expect(dated).toContain(">TBD-1</span>");
  expect(dated.match(/<time dateTime="2026-02-03"[^>]*>3 Feb 2026<\/time>/g)).toHaveLength(1);
  expect(dated.match(/>High<\/span>/g)).toHaveLength(1);
  expect(undated).toContain('aria-label="No due date"');
  expect(undated).not.toContain("<time");
});

it("renders the stored status color and falls back to grey for a null color", async () => {
  actor.id = "tb-owner";
  const { project, statuses: [, , done, blocked] } = await freshProject("tb-color", "TBC");
  await db.update(status).set({ color: null }).where(eq(status.id, done.id));
  await createTask(ownerCtx, { projectId: project.id, title: "Waiting", statusId: blocked.id });
  await createTask(ownerCtx, { projectId: project.id, title: "Finished", statusId: done.id });

  const html = renderToStaticMarkup(
    await TablePage({ params: Promise.resolve({ org: acme.slug, project: project.slug }) }),
  );
  expect(html).not.toContain('aria-label="Filters and sort"');
  expect(html).not.toContain('aria-label="Filter by title"');
  expect(html).not.toContain('aria-label="Filter by assignee"');
  expect(html).not.toContain('aria-label="Filter by created by"');
  expect(html).not.toContain('aria-label="Sort by"');
  expect(html).toContain(
    `${statusDot("red")}"></span><span>Blocked</span>`,
  );
  expect(html).toContain(
    `${statusDot("gray")}"></span><span>Done</span>`,
  );
});
