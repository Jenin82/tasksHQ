import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import { createOrg, createProject } from "@tasks/core/domain";
import { user } from "@tasks/core/schema";
import {
  MAX_TASK_IMAGE_BYTES,
  TASK_IMAGE_ID,
  storeTaskImage,
  taskImageKey,
  taskImagePath,
} from "@tasks/core/task-images";
import { transferTaskImages } from "@/lib/transfer-task-images";

const owner = "img-owner";
const outsider = "img-member";
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: actor.id, name: actor.id, email: `${actor.id}@images.test` }),
}));

const { POST } = await import("@/app/[org]/[project]/images/route");
const { GET } = await import("@/app/[org]/[project]/images/[image]/route");

const db = drizzle(env.DB);
await db.insert(user).values([owner, outsider].map((id) => ({
  id, name: id, email: `${id}@images.test`,
})));
const ctx = { db, actorUserId: owner, source: "web" as const };
const org = await createOrg(ctx, { slug: "img-org", name: "Image test org" });
const project = await createProject(ctx, { orgId: org.id, slug: "img-project", name: "Image test project", key: "IMG" });
const sibling = await createProject(ctx, { orgId: org.id, slug: "img-sibling", name: "Image test sibling", key: "IMGS" });

const origin = "http://localhost:5173";
const endpoint = `${origin}/${org.slug}/${project.slug}/images`;
const params = Promise.resolve({ org: org.slug, project: project.slug });
const notFound = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const png = Uint8Array.fromBase64("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NMQ0AAAgDsHlFOU6mgoOkSf8ms7cEAoFAIBAIBALBl6BUYRBMxBld8AAAAABJRU5ErkJggg==");
const webp = Uint8Array.from(atob("UklGRj4AAABXRUJQVlA4IDIAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+6SIf+8+fufP3Pn/Rn/+U/fI4/kcf/KBAAA=="), (c) => c.charCodeAt(0));

function upload(body: BodyInit, requestOrigin: string | null = origin) {
  const headers = new Headers({ "Content-Type": "image/png" });
  if (requestOrigin !== null) headers.set("Origin", requestOrigin);
  return POST(new Request(endpoint, { method: "POST", headers, body }), { params });
}

function download(image: string, projectSlug = project.slug) {
  return GET(new Request(`${origin}/${org.slug}/${projectSlug}/images/${image}`), {
    params: Promise.resolve({ org: org.slug, project: projectSlug, image }),
  });
}

it.each([null, "https://other.example"])("rejects an upload with origin %s", async (requestOrigin) => {
  actor.id = owner;
  expect((await upload(png, requestOrigin)).status).toBe(403);
});

it("requires organization membership before reading or accepting a project image", async () => {
  const id = crypto.randomUUID();
  await env.TASK_IMAGES.put(taskImageKey(project.id, id), webp);
  actor.id = outsider;

  await expect(download(id)).rejects.toMatchObject(notFound);
  await expect(upload(png)).rejects.toMatchObject(notFound);
});

it("rejects a streamed upload over the limit and non-image bytes claiming to be PNG", async () => {
  actor.id = owner;
  const tooLarge = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_TASK_IMAGE_BYTES));
      controller.enqueue(Uint8Array.of(0));
      controller.close();
    },
  });
  const oversized = await upload(tooLarge);
  expect(oversized.status).toBe(400);
  expect(await oversized.json()).toMatchObject({ error: expect.stringContaining("5 MB") });

  const svg = await upload('<svg xmlns="http://www.w3.org/2000/svg"/>');
  expect(svg.status).toBe(400);
  expect(await svg.json()).toMatchObject({ error: expect.stringContaining("PNG") });
});

it("serves a project's image privately and cannot reuse the same ID through another project", async () => {
  actor.id = owner;
  const uploaded = await upload(png);
  expect(uploaded.status).toBe(201);
  const { path } = await uploaded.json<{ path: string }>();
  const id = path.split("/").at(-1)!;
  expect(id).toMatch(TASK_IMAGE_ID);

  const response = await download(id);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/webp");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WEBP");
  expect((await download(id, sibling.slug)).status).toBe(404);
});

it("copies each referenced attachment once and rewrites only Markdown destinations for the source project", async () => {
  const id = crypto.randomUUID();
  const sourcePath = taskImagePath(org.slug, project.slug, id);
  const missingPath = taskImagePath(org.slug, project.slug, crypto.randomUUID());
  const externalUrl = `https://example.com${sourcePath}`;
  await env.TASK_IMAGES.put(taskImageKey(project.id, id), webp, {
    httpMetadata: { contentType: "image/webp" },
  });
  const description = [
    `![Diagram](${sourcePath})`,
    `![Escaped](${sourcePath.replace(/[/-]/g, "\\$&")})`,
    "[Original][diagram]",
    `[diagram]: ${sourcePath}`,
    `\`![Code](${sourcePath})\``,
    `![External](${externalUrl})`,
    `![Missing](${missingPath})`,
  ].join("\n\n");

  const rewritten = await transferTaskImages(description, org.slug, project, sibling);
  const [image, escaped, link, reference, code, external, missing] = rewritten.split("\n\n");
  const copiedPath = image.match(/^!\[Diagram\]\((.*)\)$/)?.[1] ?? "";
  expect(copiedPath.startsWith(taskImagePath(org.slug, sibling.slug, ""))).toBe(true);
  expect(escaped).toBe(`![Escaped](${copiedPath})`);
  expect(link).toBe("[Original][diagram]");
  expect(reference).toBe(`[diagram]: ${copiedPath}`);
  expect(code).toBe(`\`![Code](${sourcePath})\``);
  expect(external).toBe(`![External](${externalUrl})`);
  expect(missing).toBe(`![Missing](${missingPath})`);

  const copiedId = copiedPath.split("/").at(-1)!;
  expect(copiedId).toMatch(TASK_IMAGE_ID);
  expect(copiedId).not.toBe(id);
  const attachment = await env.TASK_IMAGES.get(taskImageKey(sibling.id, copiedId));
  expect(attachment?.httpMetadata?.contentType).toBe("image/webp");
  expect(new Uint8Array((await attachment?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(webp);
  expect(await env.TASK_IMAGES.head(taskImageKey(project.id, id))).not.toBeNull();
});

function fakeStorage(bytes: Uint8Array<ArrayBuffer>, contentType: string) {
  const output = vi.fn(async () => ({
    response: () => new Response(bytes, { headers: { "Content-Type": contentType } }),
  }));
  const put = vi.fn(async (_key: string, _body: ArrayBuffer) => {});
  const storage = {
    IMAGES: { input: vi.fn(() => ({ transform: () => ({ output }) })) },
    TASK_IMAGES: { put },
  };
  return { storage, put, output };
}

it("stores only transformed WebP bytes under a generated project key", async () => {
  const { storage, put, output } = fakeStorage(webp, "image/webp");
  const id = await storeTaskImage(storage, project.id, png);

  expect(id).toMatch(TASK_IMAGE_ID);
  expect(output).toHaveBeenCalledWith(expect.objectContaining({ format: "image/webp", anim: false }));
  expect(put).toHaveBeenCalledWith(taskImageKey(project.id, id), webp.buffer, {
    httpMetadata: { contentType: "image/webp" },
  });
});

it.each(["image/png", "image/webp"])("rejects non-WebP bytes from the transformer with type %s", async (contentType) => {
  const { storage, put } = fakeStorage(png, contentType);

  await expect(storeTaskImage(storage, project.id, png)).rejects.toThrow("convert the image to WebP");
  expect(put).not.toHaveBeenCalled();
});
