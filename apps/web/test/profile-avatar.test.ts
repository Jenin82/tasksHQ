import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import { createOrg } from "@tasks/core/domain";
import { orgMember, user } from "@tasks/core/schema";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  getUser: async () => actor.id ? { id: actor.id, name: actor.id, email: `${actor.id}@avatar.test` } : null,
}));

const { POST, DELETE } = await import("@/app/api/profile/avatar/route");
const { GET } = await import("@/app/api/profile/avatar/[owner]/[version]/route");
const db = drizzle(env.DB);
const owner = "avatar-owner";
const member = "avatar-member";
const outsider = "avatar-outsider";
const origin = "http://localhost:5173";
const png = Uint8Array.fromBase64("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NMQ0AAAgDsHlFOU6mgoOkSf8ms7cEAoFAIBAIBALBl6BUYRBMxBld8AAAAABJRU5ErkJggg==");

await db.insert(user).values([owner, member, outsider].map((id) => ({ id, name: id, email: `${id}@avatar.test` })));
const org = await createOrg({ db, actorUserId: owner, source: "web" }, { slug: "avatar-workspace", name: "Avatar workspace" });
await db.insert(orgMember).values({ orgId: org.id, userId: member, role: "member", createdAt: new Date() });

function upload(body: BodyInit = png, requestOrigin = origin) {
  return POST(new Request(`${origin}/api/profile/avatar`, {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "image/png" }, body,
  }));
}

function download(image: string) {
  const version = image.split("/").at(-1)!;
  return GET(new Request(`${origin}${image}`), { params: Promise.resolve({ owner, version }) });
}

it("requires authentication and a same-origin request to change the photo", async () => {
  actor.id = "";
  expect((await upload()).status).toBe(401);
  actor.id = owner;
  expect((await upload(png, "https://other.example")).status).toBe(403);
});

it("stores a small square WebP and limits profile reads to the owner and workspace members", async () => {
  actor.id = owner;
  const uploaded = await upload();
  expect(uploaded.status).toBe(201);
  const { image } = await uploaded.json<{ image: string }>();
  expect(image).toMatch(new RegExp(`^/api/profile/avatar/${owner}/[0-9a-f-]+$`));
  const response = await download(image);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/webp");
  expect(response.headers.get("Cache-Control")).toContain("private");
  const bytes = await response.arrayBuffer();
  expect(bytes.byteLength).toBeLessThanOrEqual(15 * 1024);
  expect(await env.IMAGES.info(new Blob([bytes]).stream())).toMatchObject({ width: 96, height: 96 });

  actor.id = member;
  expect((await download(image)).status).toBe(200);
  actor.id = outsider;
  expect((await download(image)).status).toBe(404);
  actor.id = "";
  expect((await download(image)).status).toBe(404);
});

it("retains the current image on a rejected upload and retires replaced and removed image URLs", async () => {
  actor.id = owner;
  const first = await upload();
  const { image: current } = await first.json<{ image: string }>();
  expect((await upload("<svg/> ")).status).toBe(400);
  expect((await db.select({ image: user.image }).from(user).where(eq(user.id, owner)))[0]).toEqual({ image: current });

  const replacement = await upload();
  const { image: updated } = await replacement.json<{ image: string }>();
  expect(updated).not.toBe(current);
  expect((await download(current)).status).toBe(404);
  expect((await download(updated)).status).toBe(200);

  const removed = await DELETE(new Request(`${origin}/api/profile/avatar`, { method: "DELETE", headers: { Origin: origin } }));
  expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ image: null });
  expect((await download(updated)).status).toBe(404);
});
