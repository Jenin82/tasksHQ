import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import { RESERVED_SLUGS } from "@tasks/core/slug";
import { createTeam } from "./helpers";
import { orgMember, team, teamMember, user } from "@tasks/core/schema";

// The route layer reads the session through this module; every other way in
// needs a live request context the pool does not provide. Hoisted so the
// factory can read `actor` the first time team-context imports it.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@routing.test`,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const { getTeamContext } = await import("@/lib/team-context");
const { createTeamAction } = await import("@/app/actions");
const { createProjectAction } = await import("@/app/[team]/(team)/actions");
const { changeMemberRoleAction, inviteMemberAction } = await import(
  "@/app/[team]/(team)/settings/members/actions"
);

const db = drizzle(env.DB);
const now = new Date();

// Shared storage, so every id and slug here is prefixed `rt-`.
const IDS = ["rt-owner", "rt-member", "rt-stranger", "rt-org-admin"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@routing.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

// Only org owners and admins create teams.
await db.insert(orgMember).values({ userId: "rt-org-admin", role: "admin", createdAt: now });

actor.id = "rt-owner";
const acme = await createTeam(
  { db, actorUserId: "rt-owner", source: "web" },
  { slug: "rt-acme", name: "RT Acme" },
);
await db
  .insert(teamMember)
  .values({ teamId: acme.id, userId: "rt-member", role: "member", createdAt: now });

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

/** vinext's navigation errors carry Next's digest; 404 and 403 differ only there. */
const digest = (status: number) => ({
  digest: `NEXT_HTTP_ERROR_FALLBACK;${status}`,
});

it("getTeamContext resolves the team and the caller's membership for a member", async () => {
  actor.id = "rt-member";

  const ctx = await getTeamContext("rt-acme");

  expect(ctx.team.id).toBe(acme.id);
  expect(ctx.member).toMatchObject({ userId: "rt-member", role: "member" });
});

it("getTeamContext is a 404, not a 403, for a non-member — team slugs are not enumerable", async () => {
  actor.id = "rt-stranger";

  // Identical to the response for a slug that does not exist at all, which is
  // the point: existence does not leak.
  await expect(getTeamContext("rt-acme")).rejects.toMatchObject(digest(404));
  await expect(getTeamContext("rt-no-such-team")).rejects.toMatchObject(
    digest(404),
  );
});

it("a plain member cannot invite, change a role or create a project", async () => {
  actor.id = "rt-member";

  await expect(
    inviteMemberAction(
      {},
      form({ team: "rt-acme", email: "nope@routing.test", role: "member" }),
    ),
  ).rejects.toMatchObject(digest(403));

  await expect(
    changeMemberRoleAction(
      {},
      form({ team: "rt-acme", userId: "rt-owner", role: "member" }),
    ),
  ).rejects.toMatchObject(digest(403));

  await expect(
    createProjectAction(
      {},
      form({ team: "rt-acme", name: "Nope", slug: "nope", key: "NOPE" }),
    ),
  ).rejects.toMatchObject(digest(403));

  // And nothing was written on the way to the refusal.
  const invites = await db
    .select()
    .from(teamMember)
    .where(eq(teamMember.teamId, acme.id));
  expect(invites).toHaveLength(2);
});

it("createTeamAction rejects reserved and malformed slugs, and accepts a valid one", async () => {
  actor.id = "rt-org-admin";

  for (const slug of RESERVED_SLUGS) {
    const state = await createTeamAction({}, form({ slug, name: "Nope" }));
    expect(state.error, slug).toBeTruthy();
  }
  expect(
    (await createTeamAction({}, form({ slug: "api", name: "Nope" }))).error,
  ).toContain("reserved");

  // The action lowercases what it is given, so a capitalised slug is accepted
  // rather than refused; these are the shapes no normalisation can rescue.
  for (const slug of ["a", "has space", "-leading", "trailing-", "under_score"]) {
    const state = await createTeamAction({}, form({ slug, name: "Nope" }));
    expect(state.error, slug).toBeTruthy();
  }

  expect(
    (await createTeamAction({}, form({ slug: "rt-acme", name: "Clash" }))).error,
  ).toContain("already taken");

  // A valid one redirects into the new team rather than returning a state.
  await expect(
    createTeamAction({}, form({ slug: "rt-fine", name: "Fine" })),
  ).rejects.toMatchObject({
    digest: expect.stringContaining("NEXT_REDIRECT"),
  });
  expect(await db.select().from(team).where(eq(team.slug, "rt-fine"))).toHaveLength(
    1,
  );
});

it("createProjectAction redirects into the new project's board", async () => {
  actor.id = "rt-owner";

  await expect(
    createProjectAction(
      {},
      form({ team: "rt-acme", name: "Fresh", slug: "fresh", key: "FRSH" }),
    ),
  ).rejects.toMatchObject({
    digest: expect.stringMatching(
      `;${encodeURIComponent("/rt-acme/fresh")}(;|$)`,
    ),
  });
});
