import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Buffer } from "node:buffer";
import { headersContextFromRequest, runWithHeadersContext } from "vinext/shims/headers";
import { expect, it, vi } from "vitest";
import { createOrg, createProject, createTask, findProjectByAlias, renameProject, setProjectMemberRole } from "@tasks/core/domain";
import { activity, orgMember, project as projectTable, projectSlugAlias, task as taskTable, taskShare, user } from "@tasks/core/schema";
import type { TaskPreview } from "@/lib/task-preview";

const viewer = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({ id: viewer.id, name: viewer.id, email: `${viewer.id}@rename.test` });
  return { getUser: async () => viewer.id ? current() : null, requireUser: async () => current() };
});
vi.mock("@/lib/task-preview-image", () => ({
  taskPreviewImage: (task: TaskPreview, headers: HeadersInit) => Response.json(task, { headers }),
}));

const { getProjectContext } = await import("@/lib/project-context");
const { createTaskShareLink } = await import("@/app/[org]/[project]/[task]/share-task-action");
const { GET: legacyPage } = await import("@/app/share/tasks/[org]/[project]/[task]/route");
const { renderCanonicalTaskShare } = await import("@/lib/task-share-page");

const db = drizzle(env.DB);
const now = new Date();
// Shared storage, so every id and slug here is prefixed `rn-`.
const OWNER = "rn-owner";
const ADMIN = "rn-admin";
const MEMBER = "rn-member";
const PROJECT_ADMIN = "rn-project-admin";
const STRANGER = "rn-stranger";
await db.insert(user).values([OWNER, ADMIN, MEMBER, PROJECT_ADMIN, STRANGER].map((id) => ({
  id, name: id, email: `${id}@rename.test`, createdAt: now, updatedAt: now,
})));
const ctx = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });
const org = await createOrg(ctx(OWNER), { slug: "rn-acme", name: "RN Acme" });
await db.insert(orgMember).values([ADMIN, MEMBER, PROJECT_ADMIN].map((userId) => ({
  orgId: org.id, userId, role: userId === ADMIN ? "admin" as const : "member" as const, createdAt: now,
})));

let keySeq = 0;
async function newProject(slug: string, name = slug) {
  const key = `RN${String.fromCharCode(65 + keySeq++)}`;
  return createProject(ctx(OWNER), { orgId: org.id, slug, name, key });
}
const aliasesOf = (projectId: string) => db.select({ slug: projectSlugAlias.slug }).from(projectSlugAlias)
  .where(eq(projectSlugAlias.projectId, projectId)).orderBy(projectSlugAlias.slug).then((rows) => rows.map((r) => r.slug));
const renames = (projectId: string) => db.select({ data: activity.data }).from(activity)
  .where(and(eq(activity.projectId, projectId), eq(activity.type, "project.renamed")))
  .then((rows) => rows.map((r) => JSON.parse(r.data)));
const redirectTo = (path: string) => ({
  digest: expect.stringMatching(`^NEXT_REDIRECT;[^;]*;${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
});
const notFound = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
function withRequest<T>(headers: Record<string, string>, fn: () => Promise<T>) {
  return runWithHeadersContext(headersContextFromRequest(new Request("http://localhost:5173/", { headers })), fn);
}

it("renames a project, records activity, and only a slug change leaves an alias", async () => {
  const p = await newProject("rn-alpha", "Alpha");

  await expect(renameProject(ctx(OWNER), { projectId: p.id, name: "  Alpha Two ", slug: "rn-alpha" }))
    .resolves.toEqual({ slug: "rn-alpha" });
  expect(await aliasesOf(p.id)).toEqual([]);

  await renameProject(ctx(ADMIN), { projectId: p.id, name: "Alpha Two", slug: "rn-beta" });
  const [row] = await db.select().from(projectTable).where(eq(projectTable.id, p.id));
  expect(row).toMatchObject({ name: "Alpha Two", slug: "rn-beta", key: p.key });
  expect(await aliasesOf(p.id)).toEqual(["rn-alpha"]);
  expect(await findProjectByAlias(db, org.id, "rn-alpha")).toEqual({ projectId: p.id, projectSlug: "rn-beta" });

  await renameProject(ctx(OWNER), { projectId: p.id, name: "Alpha Two", slug: "rn-gamma" });
  expect(await aliasesOf(p.id)).toEqual(["rn-alpha", "rn-beta"]);
  expect(await findProjectByAlias(db, org.id, "rn-alpha")).toEqual({ projectId: p.id, projectSlug: "rn-gamma" });

  // Renaming back removes that alias, so nothing chains.
  await renameProject(ctx(OWNER), { projectId: p.id, name: "Alpha Two", slug: "rn-alpha" });
  expect(await aliasesOf(p.id)).toEqual(["rn-beta", "rn-gamma"]);
  expect(await findProjectByAlias(db, org.id, "rn-alpha")).toBeNull();

  // A no-op writes nothing.
  await renameProject(ctx(OWNER), { projectId: p.id, name: "Alpha Two", slug: "rn-alpha" });
  expect(await renames(p.id)).toEqual([
    { from: { name: "Alpha", slug: "rn-alpha" }, to: { name: "Alpha Two", slug: "rn-alpha" } },
    { from: { name: "Alpha Two", slug: "rn-alpha" }, to: { name: "Alpha Two", slug: "rn-beta" } },
    { from: { name: "Alpha Two", slug: "rn-beta" }, to: { name: "Alpha Two", slug: "rn-gamma" } },
    { from: { name: "Alpha Two", slug: "rn-gamma" }, to: { name: "Alpha Two", slug: "rn-alpha" } },
  ]);
});

it("refuses taken, invalid and reserved slugs and bad names", async () => {
  const p = await newProject("rn-delta");
  await newProject("rn-taken");
  const rename = (slug: string, name = "Delta") => renameProject(ctx(OWNER), { projectId: p.id, name, slug });

  await expect(rename("rn-taken")).rejects.toThrow('A project with the slug "rn-taken" already exists.');
  await expect(rename("settings")).rejects.toThrow('"settings" is reserved.');
  await expect(rename("Bad Slug")).rejects.toThrow("lowercase letters");
  await expect(rename("x")).rejects.toThrow("between 2 and 48");
  await expect(rename("rn-delta", "   ")).rejects.toThrow("Project name is required.");
  await expect(rename("rn-delta", "n".repeat(81))).rejects.toThrow("at most 80");
  expect(await renames(p.id)).toEqual([]);
});

it("lets only organization owners and admins rename", async () => {
  const p = await newProject("rn-epsilon");
  await setProjectMemberRole(ctx(OWNER), { projectId: p.id, userId: PROJECT_ADMIN, role: "admin" });
  for (const actor of [MEMBER, PROJECT_ADMIN]) {
    await expect(renameProject(ctx(actor), { projectId: p.id, name: "Nope", slug: "rn-nope" }))
      .rejects.toMatchObject({ reason: "forbidden" });
  }
  await expect(renameProject(ctx(STRANGER), { projectId: p.id, name: "Nope", slug: "rn-nope" }))
    .rejects.toMatchObject({ reason: "not_a_member" });
  await expect(renameProject(ctx(ADMIN), { projectId: p.id, name: "Epsilon", slug: "rn-epsilon-2" }))
    .resolves.toEqual({ slug: "rn-epsilon-2" });
});

it("hands an old slug to a new project, which ends the redirect", async () => {
  const p = await newProject("rn-zeta");
  await renameProject(ctx(OWNER), { projectId: p.id, name: "Zeta", slug: "rn-zeta-2" });
  expect(await findProjectByAlias(db, org.id, "rn-zeta")).not.toBeNull();

  await newProject("rn-zeta");
  expect(await findProjectByAlias(db, org.id, "rn-zeta")).toBeNull();
  expect(await aliasesOf(p.id)).toEqual([]);
});

it("hands an old slug to another project that renames onto it", async () => {
  const p = await newProject("rn-mu");
  const other = await newProject("rn-nu");
  await renameProject(ctx(OWNER), { projectId: p.id, name: "Mu", slug: "rn-mu-2" });

  await renameProject(ctx(OWNER), { projectId: other.id, name: "Nu", slug: "rn-mu" });
  expect(await aliasesOf(p.id)).toEqual([]);
  expect(await aliasesOf(other.id)).toEqual(["rn-nu"]);
  expect(await findProjectByAlias(db, org.id, "rn-mu")).toBeNull();
});

it("moves description image paths to the new slug without touching other projects", async () => {
  const p = await newProject("rn-kappa");
  const other = await newProject("rn-lambda");
  const image = "/rn-acme/rn-kappa/images/00000000-0000-4000-8000-000000000000";
  const item = await createTask(ctx(OWNER), { projectId: p.id, title: "With image", description: `See ![shot](${image})` });
  const elsewhere = await createTask(ctx(OWNER), { projectId: other.id, title: "Mentions it", description: `Text ${image}` });
  const read = (id: string) => db.select({ description: taskTable.description, updatedAt: taskTable.updatedAt })
    .from(taskTable).where(eq(taskTable.id, id)).then(([row]) => row);
  const before = await read(item.id);

  await renameProject(ctx(OWNER), { projectId: p.id, name: "Kappa", slug: "rn-kappa-2" });

  const after = await read(item.id);
  expect(after.description).toBe("See ![shot](/rn-acme/rn-kappa-2/images/00000000-0000-4000-8000-000000000000)");
  expect(after.updatedAt).toEqual(before.updatedAt);
  expect((await read(elsewhere.id)).description).toBe(`Text ${image}`);
});

it("fails the loser of two concurrent renames cleanly", async () => {
  const p = await newProject("rn-eta", "Eta");
  // The second rename reads the project, then its write waits until the first
  // has landed, so its guard always sees a stale name and slug.
  let firstDone!: () => void;
  const first = new Promise<void>((resolve) => { firstDone = resolve; });
  const staleDb = Object.create(db) as typeof db;
  staleDb.batch = (async (writes: Parameters<typeof db.batch>[0]) => {
    await first;
    return db.batch(writes);
  }) as unknown as typeof db.batch;
  const second = renameProject({ ...ctx(ADMIN), db: staleDb }, { projectId: p.id, name: "Eta Two", slug: "rn-eta-2" });
  const results = await Promise.allSettled([
    renameProject(ctx(OWNER), { projectId: p.id, name: "Eta One", slug: "rn-eta-1" }).finally(firstDone),
    second,
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const [failed] = results.filter((r) => r.status === "rejected");
  expect(failed.reason).toMatchObject({ message: "This project changed. Reload and try again." });
  expect(await renames(p.id)).toHaveLength(1);
  expect(await aliasesOf(p.id)).toEqual(["rn-eta"]);
});

it("redirects org members from a former slug, keeping the rest of the path and query", async () => {
  const p = await newProject("rn-theta");
  await renameProject(ctx(OWNER), { projectId: p.id, name: "Theta", slug: "rn-theta-2" });
  viewer.id = MEMBER;

  await expect(withRequest({ "x-taskshq-path": "/rn-acme/rn-theta/RNA-1?tab=table&_rsc=abc" },
    () => getProjectContext("rn-acme", "rn-theta"))).rejects.toMatchObject(redirectTo("/rn-acme/rn-theta-2/RNA-1?tab=table"));
  await expect(withRequest({ "x-taskshq-path": "/rn-acme/rn-theta" },
    () => getProjectContext("rn-acme", "rn-theta"))).rejects.toMatchObject(redirectTo("/rn-acme/rn-theta-2"));
  // A path the header does not match, or one that climbs out, lands on the project.
  for (const path of ["/rn-acme/rn-theta-extra/x", "/rn-acme/elsewhere", "/rn-acme/rn-theta/../..//evil.test"]) {
    await expect(withRequest({ "x-taskshq-path": path }, () => getProjectContext("rn-acme", "rn-theta")))
      .rejects.toMatchObject(redirectTo("/rn-acme/rn-theta-2"));
  }
  // No header means not a GET (e.g. an upload from a stale page): 404, never a redirect.
  await expect(withRequest({}, () => getProjectContext("rn-acme", "rn-theta")))
    .rejects.toMatchObject(notFound);

  // Server Actions posted from a stale page are not redirected.
  await expect(withRequest({ "next-action": "abc", "x-taskshq-path": "/rn-acme/rn-theta" },
    () => getProjectContext("rn-acme", "rn-theta"))).rejects.toMatchObject(notFound);
  await expect(withRequest({}, () => getProjectContext("rn-acme", "rn-no-such"))).rejects.toMatchObject(notFound);

  // A non-member gets the same 404 as for any other slug.
  viewer.id = STRANGER;
  await expect(withRequest({ "x-taskshq-path": "/rn-acme/rn-theta" },
    () => getProjectContext("rn-acme", "rn-theta"))).rejects.toMatchObject(notFound);
});

it("keeps canonical and legacy share links working after a slug change", async () => {
  const p = await newProject("rn-iota");
  const item = await createTask(ctx(OWNER), { projectId: p.id, title: "Shared before rename" });
  viewer.id = OWNER;
  const oldPath = `/rn-acme/rn-iota/${item.key}`;
  expect(await createTaskShareLink({ orgSlug: "rn-acme", projectSlug: "rn-iota", taskKey: item.key }))
    .toEqual({ ok: true, path: oldPath });
  const [share] = await db.select({ code: taskShare.code }).from(taskShare).where(eq(taskShare.projectId, p.id));

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.BETTER_AUTH_SECRET), {
    name: "HMAC", hash: "SHA-256",
  }, false, ["sign"]);
  const payload = Buffer.from(JSON.stringify([item.id, p.id])).toString("base64url");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`tasks:share-preview:v1:${oldPath}:${payload}`));
  const token = `${payload}.${Buffer.from(signature).toString("base64url")}`;

  await renameProject(ctx(OWNER), { projectId: p.id, name: "Iota", slug: "rn-iota-2" });
  viewer.id = "";

  const canonical = await renderCanonicalTaskShare(new Request(`http://localhost:5173${oldPath}`));
  expect(canonical?.status).toBe(200);
  expect(await canonical?.text()).toContain(`/s/${share.code}/preview.png`);

  const legacy = await legacyPage(
    new Request(`http://localhost:5173/share/tasks${oldPath}?preview=${token}`),
    { params: Promise.resolve({ org: "rn-acme", project: "rn-iota", task: item.key }) },
  );
  expect(legacy.status).toBe(200);
  expect(await legacy.text()).toContain(`/share/tasks${oldPath}/preview.png?preview=${token}`);

  // Once another project takes the old slug, neither matches the moved project.
  await newProject("rn-iota");
  expect(await renderCanonicalTaskShare(new Request(`http://localhost:5173${oldPath}`))).toBeNull();
  const taken = await legacyPage(
    new Request(`http://localhost:5173/share/tasks${oldPath}?preview=${token}`),
    { params: Promise.resolve({ org: "rn-acme", project: "rn-iota", task: item.key }) },
  );
  expect(await taken.text()).not.toContain("og:image");
});
