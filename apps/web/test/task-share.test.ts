import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Buffer } from "node:buffer";
import { expect, it, vi } from "vitest";
import {
  addComment, archiveTask, createOrg, createProject, createProjectTaskType, createTask, deleteArchivedTask, parseTaskKey, transferTask,
} from "@tasks/core/domain";
import { orgMember, taskShare, user } from "@tasks/core/schema";
import type { TaskPreview, TaskPreviewParams } from "@/lib/task-preview";

const viewer = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({ id: viewer.id, name: viewer.id, email: `${viewer.id}@share.test` });
  return { getUser: async () => viewer.id ? current() : null, requireUser: async () => current() };
});

// The preview routes' access checks run in Workerd. Rendering itself uses the
// production image module, which bundles a separate WASM dependency.
vi.mock("@/lib/task-preview-image", () => ({
  taskPreviewImage: (task: TaskPreview, headers: HeadersInit) =>
    Response.json(task, { headers }),
}));

const { default: taskPage, generateMetadata } = await import("@/app/[org]/[project]/[task]/page");
const { createTaskShareLink } = await import("@/app/[org]/[project]/[task]/share-task-action");
const { GET: privateImage } = await import("@/app/[org]/[project]/[task]/preview.png/route");
const { GET: legacyPage } = await import("@/app/share/tasks/[org]/[project]/[task]/route");
const { GET: legacyImage } = await import("@/app/share/tasks/[org]/[project]/[task]/preview.png/route");
const { GET: sharedPage } = await import("@/app/s/[code]/route");
const { GET: sharedImage } = await import("@/app/s/[code]/preview.png/route");
const { renderCanonicalTaskShare } = await import("@/lib/task-share-page");

const db = drizzle(env.DB);
const ownerId = "share-owner";
const memberId = "share-member";
const outsiderId = "share-outsider";
const photoPath = `/api/profile/avatar/${ownerId}/caeb9ceb-92f4-4bf1-9dac-47772a38396f`;
await db.insert(user).values([
  { id: ownerId, name: "Private assignee", email: "owner@share.test", image: photoPath },
  { id: memberId, name: "Workspace member", email: "member@share.test" },
  { id: outsiderId, name: "Outsider", email: "outsider@share.test" },
]);
const owner = { db, actorUserId: ownerId, source: "web" as const };
const org = await createOrg(owner, { slug: "share-test", name: "Share test" });
await db.insert(orgMember).values({ orgId: org.id, userId: memberId, role: "member", createdAt: new Date() });
const project = await createProject(owner, { orgId: org.id, slug: "work", name: "Work", key: "SHR" });
const type = await createProjectTaskType(owner, { projectId: project.id, name: "Preview feature", color: "purple", icon: "feature" });
const item = await createTask(owner, {
  projectId: project.id,
  title: "Private task title",
  description: "A **formatted** summary",
  priority: "high",
  typeId: type.id,
  assigneeUserId: ownerId,
});
await addComment(owner, { taskId: item.id, body: "Private comment" });

const route = { org: org.slug, project: project.slug, task: item.key };
const origin = "http://localhost:5173";
const context = (params: TaskPreviewParams = route) => ({ params: Promise.resolve(params) });
const shareContext = (code: string) => ({ params: Promise.resolve({ code }) });
const request = (path: string, init?: RequestInit) => new Request(new URL(path, origin), init);
const taskPath = (key: string) => `/${org.slug}/${project.slug}/${key}`;
const privatePath = `${taskPath(item.key)}/preview.png`;
const shareInput = { orgSlug: org.slug, projectSlug: project.slug, taskKey: item.key };

async function share(key = item.key) {
  const path = taskPath(key);
  const parsed = parseTaskKey(key);
  if (!parsed) throw new Error(`Invalid fixture task key: ${key}`);
  expect(await createTaskShareLink({ ...shareInput, taskKey: key })).toEqual({ ok: true, path });
  const [row] = await db.select({ code: taskShare.code }).from(taskShare).where(and(
    eq(taskShare.projectId, project.id),
    eq(taskShare.number, parsed.number),
  ));
  const shortPath = `/s/${row.code}`;
  return { path, shortPath, image: `${shortPath}/preview.png`, code: row.code };
}

// Reproduce the original signer independently of the current share action.
async function legacyToken() {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.BETTER_AUTH_SECRET), {
    name: "HMAC", hash: "SHA-256",
  }, false, ["sign"]);
  const payload = Buffer.from(JSON.stringify([item.id, project.id])).toString("base64url");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(
    `tasks:share-preview:v1:${taskPath(item.key)}:${payload}`,
  ));
  return `${payload}.${Buffer.from(signature).toString("base64url")}`;
}

it("keeps ordinary work item metadata and image behind project access", async () => {
  for (const id of ["", outsiderId]) {
    viewer.id = id;
    expect(await generateMetadata(context())).toEqual({});
    expect((await privateImage(request(privatePath), context())).status).toBe(404);
  }
  await expect(createTaskShareLink(shareInput)).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });

  viewer.id = memberId;
  expect(await generateMetadata(context())).toMatchObject({
    title: `${item.key} ${item.title}`,
    description: "A formatted summary",
    openGraph: { images: [{ url: origin + privatePath, width: 1200, height: 630 }] },
  });
  const response = await privateImage(request(privatePath), context());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it("shares the original task URL with a public preview limited to the card image", async () => {
  expect(await renderCanonicalTaskShare(request(taskPath(item.key)))).toBeNull();
  viewer.id = ownerId;
  const [{ path, image, code }, duplicate] = await Promise.all([share(), share()]);
  expect(duplicate.code).toBe(code);
  viewer.id = "";

  const response = await renderCanonicalTaskShare(request(path));
  if (!response) throw new Error("Expected a preview response at the original URL.");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/html");
  expect(response.headers.get("Location")).toBeNull();
  expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Vary")).toMatch(/\bCookie\b/i);
  const html = await response.text();
  expect(html).toContain('<meta property="og:title" content="Shared work item">');
  expect(html).toContain(`<meta property="og:url" content="${origin}${path}">`);
  expect(html).toContain(`<meta property="og:image" content="${origin}${image}">`);
  expect(html).toContain(`href="/?next=${encodeURIComponent(path)}"`);
  expect(html).not.toContain('property="og:description"');
  expect(html).not.toContain(item.title);
  expect(html).not.toContain("A formatted summary");
  expect(html).not.toContain(type.name);
  expect(html).not.toContain("Private assignee");
  expect(html).not.toContain(photoPath);
  expect(html).not.toContain("Private comment");
  expect((await privateImage(request(privatePath), context())).status).toBe(404);
  const picture = await sharedImage(request(image), shareContext(code));
  expect(picture.status).toBe(200);
  expect(picture.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await picture.json()).toMatchObject({
    key: item.key,
    title: item.title,
    description: null,
    type: { name: type.name, color: type.color, icon: type.icon },
    priority: "high",
    assignee: { id: ownerId, image: photoPath },
  });

  const head = await renderCanonicalTaskShare(request(path, { method: "HEAD" }));
  expect(head?.status).toBe(200);
  expect(head?.headers.get("Content-Type")).toBe(response.headers.get("Content-Type"));
  expect(await head?.text()).toBe("");
  expect(await renderCanonicalTaskShare(request(path, { method: "POST" }))).toBeNull();
  expect(await renderCanonicalTaskShare(request(path, { headers: { RSC: "1" } }))).toBeNull();
  for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token"]) {
    expect(await renderCanonicalTaskShare(request(path, {
      headers: { Cookie: `${name}=possible-session` },
    }))).toBeNull();
  }

  viewer.id = outsiderId;
  await expect(taskPage(context())).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  viewer.id = memberId;
  await expect(taskPage(context())).resolves.toBeDefined();
});

it("keeps existing short links working and enables the original URL only when shared again", async () => {
  const previous = await createTask(owner, { projectId: project.id, title: "Previously shared work item" });
  const canonical = taskPath(previous.key);
  const code = "s".repeat(22);
  const path = `/s/${code}`;
  const image = `${path}/preview.png`;
  await db.insert(taskShare).values({ code, taskId: previous.id, projectId: project.id, number: previous.number });
  viewer.id = "";

  expect(await renderCanonicalTaskShare(request(canonical))).toBeNull();
  const response = await sharedPage(request(path), shareContext(code));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain(`<meta property="og:image" content="${origin}${image}">`);
  expect(html).toContain(`href="/?next=${encodeURIComponent(path)}"`);
  expect(html).not.toContain(previous.title);
  expect((await sharedImage(request(image), shareContext(code))).status).toBe(200);

  const unknown = "x".repeat(22);
  expect((await sharedPage(request(`/s/${unknown}`), shareContext(unknown))).status).toBe(404);
  expect((await sharedImage(request(`/s/${unknown}/preview.png`), shareContext(unknown))).status).toBe(404);

  viewer.id = outsiderId;
  const unavailable = await sharedPage(request(path), shareContext(code));
  expect(unavailable.status).toBe(404);
  expect(unavailable.headers.get("Location")).toBeNull();

  viewer.id = memberId;
  expect((await sharedPage(request(path), shareContext(code))).headers.get("Location")).toBe(canonical);
  expect(await share(previous.key)).toMatchObject({ path: canonical, code });
  viewer.id = "";
  const enabled = await renderCanonicalTaskShare(request(canonical));
  expect(enabled?.status).toBe(200);
  expect(await enabled?.text()).toContain(`<meta property="og:image" content="${origin}${image}">`);
});

it("keeps old signed links working with image-only previews", async () => {
  viewer.id = "";
  const token = await legacyToken();
  const path = `/share/tasks${taskPath(item.key)}`;
  const image = `${path}/preview.png?preview=${token}`;
  const response = await legacyPage(request(`${path}?preview=${token}`), context());
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain(`<meta property="og:image" content="${origin}${image}">`);
  expect(html).not.toContain(item.title);
  expect(html).not.toContain(photoPath);
  expect((await legacyImage(request(image), context())).status).toBe(200);

  const tampered = (token.startsWith("A") ? "B" : "A") + token.slice(1);
  expect((await legacyPage(request(`${path}?preview=${tampered}`), context())).status).toBe(404);
  expect((await legacyImage(request(`${path}/preview.png`), context())).status).toBe(404);
  const other = await createTask(owner, { projectId: project.id, title: "A different work item" });
  const otherRoute = { ...route, task: other.key };
  expect((await legacyPage(request(`/share/tasks${taskPath(other.key)}?preview=${token}`), context(otherRoute))).status).toBe(404);
});

it("stops disclosing the old card after a move, including a return to its former project", async () => {
  viewer.id = ownerId;
  const task = await createTask(owner, { projectId: project.id, title: "Private after moving" });
  const destination = await createProject(owner, { orgId: org.id, slug: "delivery", name: "Delivery", key: "SDL" });
  const { path, shortPath, image, code } = await share(task.key);
  const moved = await transferTask(owner, { taskId: task.id, sourceProjectId: project.id, destinationProjectId: destination.id });
  viewer.id = "";

  expect(await renderCanonicalTaskShare(request(path))).toBeNull();
  expect(await renderCanonicalTaskShare(request(`/${org.slug}/${destination.slug}/${moved.key}`))).toBeNull();
  const response = await sharedPage(request(shortPath), shareContext(code));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("Open in TasksHQ");
  expect(html).toContain(`href="/?next=${encodeURIComponent(shortPath)}"`);
  expect(html).not.toContain("Private after moving");
  expect(html).not.toContain('property="og:');
  expect((await sharedImage(request(image), shareContext(code))).status).toBe(404);

  const returned = await transferTask(owner, { taskId: task.id, sourceProjectId: destination.id, destinationProjectId: project.id });
  expect(returned.key).not.toBe(task.key);
  expect(await renderCanonicalTaskShare(request(taskPath(returned.key)))).toBeNull();
  expect((await sharedImage(request(image), shareContext(code))).status).toBe(404);
  viewer.id = ownerId;
  const next = await share(returned.key);
  expect(next.code).not.toBe(code);
  viewer.id = "";
  expect((await renderCanonicalTaskShare(request(next.path)))?.status).toBe(200);
  expect((await sharedImage(request(next.image), shareContext(next.code))).status).toBe(200);
});

it("removes a share code when its work item is permanently deleted", async () => {
  viewer.id = ownerId;
  const task = await createTask(owner, { projectId: project.id, title: "Delete shared work" });
  const { path, shortPath, image, code } = await share(task.key);
  await archiveTask(owner, { taskId: task.id });
  await deleteArchivedTask(owner, { projectId: project.id, taskId: task.id, confirmation: task.key });

  viewer.id = "";
  expect(await renderCanonicalTaskShare(request(path))).toBeNull();
  expect((await sharedPage(request(shortPath), shareContext(code))).status).toBe(404);
  expect((await sharedImage(request(image), shareContext(code))).status).toBe(404);
});
