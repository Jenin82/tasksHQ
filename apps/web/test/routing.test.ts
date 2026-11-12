import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import { RESERVED_SLUGS } from "@tasks/core/slug";
import { createOrg } from "@tasks/core/domain";
import { org, orgMember, user } from "@tasks/core/schema";

// The route layer reads the session through this module; every other way in
// needs a live request context the pool does not provide. Hoisted so the
// factory can read `actor` the first time org-context imports it.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@routing.test`,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const { getOrgContext } = await import("@/lib/org-context");
const { createOrgAction } = await import("@/app/actions");
const { createProjectAction } = await import("@/app/[org]/(org)/actions");
const { changeMemberRoleAction, inviteMemberAction } = await import(
  "@/app/[org]/(org)/settings/members/actions"
);

const db = drizzle(env.DB);
const now = new Date();

// Shared storage, so every id and slug here is prefixed `rt-`.
const IDS = ["rt-owner", "rt-member", "rt-stranger"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@routing.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

actor.id = "rt-owner";
const acme = await createOrg(
  { db, actorUserId: "rt-owner", source: "web" },
  { slug: "rt-acme", name: "RT Acme" },
);
await db
  .insert(orgMember)
  .values({ orgId: acme.id, userId: "rt-member", role: "member", createdAt: now });

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

/** vinext's navigation errors carry Next's digest; 404 and 403 differ only there. */
const digest = (status: number) => ({
  digest: `NEXT_HTTP_ERROR_FALLBACK;${status}`,
});

it("getOrgContext resolves the org and the caller's membership for a member", async () => {
  actor.id = "rt-member";

  const ctx = await getOrgContext("rt-acme");

  expect(ctx.org.id).toBe(acme.id);
  expect(ctx.member).toMatchObject({ userId: "rt-member", role: "member" });
});

it("getOrgContext is a 404, not a 403, for a non-member — org slugs are not enumerable", async () => {
  actor.id = "rt-stranger";

  // Identical to the response for a slug that does not exist at all, which is
  // the point: existence does not leak.
  await expect(getOrgContext("rt-acme")).rejects.toMatchObject(digest(404));
  await expect(getOrgContext("rt-no-such-org")).rejects.toMatchObject(
    digest(404),
  );
});

it("a plain member cannot invite, change a role or create a project", async () => {
  actor.id = "rt-member";

  await expect(
    inviteMemberAction(
      {},
      form({ org: "rt-acme", email: "nope@routing.test", role: "member" }),
    ),
  ).rejects.toMatchObject(digest(403));

  await expect(
    changeMemberRoleAction(
      {},
      form({ org: "rt-acme", userId: "rt-owner", role: "member" }),
    ),
  ).rejects.toMatchObject(digest(403));

  await expect(
    createProjectAction(
      {},
      form({ org: "rt-acme", name: "Nope", slug: "nope", key: "NOPE" }),
    ),
  ).rejects.toMatchObject(digest(403));

  // And nothing was written on the way to the refusal.
  const invites = await db
    .select()
    .from(orgMember)
    .where(eq(orgMember.orgId, acme.id));
  expect(invites).toHaveLength(2);
});

it("createOrgAction rejects reserved and malformed slugs, and accepts a valid one", async () => {
  actor.id = "rt-stranger";

  for (const slug of RESERVED_SLUGS) {
    const state = await createOrgAction({}, form({ slug, name: "Nope" }));
    expect(state.error, slug).toBeTruthy();
  }
  expect(
    (await createOrgAction({}, form({ slug: "api", name: "Nope" }))).error,
  ).toContain("reserved");

  // The action lowercases what it is given, so a capitalised slug is accepted
  // rather than refused; these are the shapes no normalisation can rescue.
  for (const slug of ["a", "has space", "-leading", "trailing-", "under_score"]) {
    const state = await createOrgAction({}, form({ slug, name: "Nope" }));
    expect(state.error, slug).toBeTruthy();
  }

  expect(
    (await createOrgAction({}, form({ slug: "rt-acme", name: "Clash" }))).error,
  ).toContain("already taken");

  // A valid one redirects into the new org rather than returning a state.
  await expect(
    createOrgAction({}, form({ slug: "rt-fine", name: "Fine" })),
  ).rejects.toMatchObject({
    digest: expect.stringContaining("NEXT_REDIRECT"),
  });
  expect(await db.select().from(org).where(eq(org.slug, "rt-fine"))).toHaveLength(
    1,
  );
});

it("createProjectAction redirects into the new project's board", async () => {
  actor.id = "rt-owner";

  await expect(
    createProjectAction(
      {},
      form({ org: "rt-acme", name: "Fresh", slug: "fresh", key: "FRSH" }),
    ),
  ).rejects.toMatchObject({
    digest: expect.stringMatching(
      `;${encodeURIComponent("/rt-acme/fresh")}(;|$)`,
    ),
  });
});
