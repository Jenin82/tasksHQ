import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import { archiveTask, createOrg, createProject, createTask } from "@tasks/core/domain";
import { orgMember, user } from "@tasks/core/schema";

const actor = vi.hoisted(() => ({ id: "ws-member" }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: actor.id, name: actor.id, email: `${actor.id}@search.test` }),
}));
const { GET } = await import("@/app/api/workspaces/[org]/search/route");

it("searches all projects in the active workspace without exposing other workspaces or archived work", async () => {
  const db = drizzle(env.DB);
  const now = new Date();
  await db.insert(user).values(["ws-owner", "ws-member"].map((id) => ({
    id, name: id, email: `${id}@search.test`, createdAt: now, updatedAt: now,
  })));
  const owner = { db, actorUserId: "ws-owner", source: "web" as const };
  const org = await createOrg(owner, { name: "Search workspace", slug: "ws-search" });
  const other = await createOrg(owner, { name: "Other workspace", slug: "ws-other" });
  await db.insert(orgMember).values([
    { orgId: org.id, userId: "ws-member", role: "member", createdAt: now },
    { orgId: other.id, userId: "ws-member", role: "member", createdAt: now },
  ]);
  const makeProject = (key: string, orgId = org.id) =>
    createProject(owner, { orgId, name: `Searchable ${key}`, slug: key.toLowerCase(), key });
  const projects = await Promise.all([makeProject("WSA"), makeProject("WSB"), makeProject("WSC"), makeProject("WSD", other.id)]);
  await Promise.all(projects.map((project) =>
    createTask(owner, { projectId: project.id, title: "Searchable task" }),
  ));
  const archived = await createTask(owner, { projectId: projects[0].id, title: "Searchable archived" });
  await archiveTask(owner, { taskId: archived.id });

  const search = (q: string, slug = org.slug) => GET(
    new Request(`http://local/api/workspaces/${slug}/search?${new URLSearchParams({ q })}`),
    { params: Promise.resolve({ org: slug }) },
  );
  const response = await search("searchable");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const results = await response.json<{ projects: { key: string }[]; tasks: { key: string }[] }>();
  expect(results.projects.map(({ key }) => key)).toEqual(["WSA", "WSB", "WSC"]);
  expect(results.tasks.map(({ key }) => key).sort()).toEqual(["WSA-1", "WSB-1", "WSC-1"]);
  expect(await (await search("wsb-1")).json()).toMatchObject({
    projects: [],
    tasks: [{ key: "WSB-1", project: "Searchable WSB", status: "Todo", href: "/ws-search/wsb/WSB-1" }],
  });
  expect(await (await search("WSD-1")).json()).toEqual({ projects: [], tasks: [] });
});
