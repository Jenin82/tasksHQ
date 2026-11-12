import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import { createOrg, createProject, createTask, inviteToOrg } from "@tasks/core/domain";
import { orgMember, user } from "@tasks/core/schema";
import { taskSignInDestination, taskSignInUrl } from "@/lib/task-sign-in";

// Same seam as test/states.test.tsx: the route layer reads the session
// through this module, and the pool gives no live request context.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@home.test`,
    emailVerified: true,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const Home = (await import("@/app/page")).default;
const NewOrgPage = (await import("@/app/new/page")).default;

const db = drizzle(env.DB);
const now = new Date();

// Shared storage (§12: no per-test isolation), so every id and slug is `hm-`.
const IDS = ["hm-zero", "hm-one", "hm-two", "hm-member", "hm-invite-owner", "hm-invite-recipient"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@home.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })),
);
const ctx = (id: string) => ({ db, actorUserId: id, source: "web" as const });
const solo = await createOrg(ctx("hm-one"), { slug: "hm-solo", name: "HM Solo" });
await createProject(ctx("hm-one"), {
  orgId: solo.id,
  slug: "only",
  name: "Only",
  key: "HMO",
});
const a = await createOrg(ctx("hm-two"), { slug: "hm-a", name: "HM A" });
await createOrg(ctx("hm-two"), { slug: "hm-b", name: "HM B" });
await createProject(ctx("hm-two"), {
  orgId: a.id,
  slug: "first",
  name: "First",
  key: "HMF",
});
await createProject(ctx("hm-two"), {
  orgId: a.id,
  slug: "second",
  name: "Second",
  key: "HMS",
});
await db
  .insert(orgMember)
  .values({ orgId: a.id, userId: "hm-member", role: "member", createdAt: now });

// A redirect() would throw out of Home, so rendering at all is the proof that
// `/` no longer redirects for any org count.
async function render(userId: string) {
  actor.id = userId;
  return renderToStaticMarkup(await Home());
}

it("claims a pending organization invite before continuing to a work item", async () => {
  const owner = ctx("hm-invite-owner");
  const recipientId = "hm-invite-recipient";
  const workspace = await createOrg(owner, { slug: "hm-invited", name: "Invited Workspace" });
  const project = await createProject(owner, { orgId: workspace.id, slug: "invited-project", name: "Invited Project", key: "HMI" });
  const task = await createTask(owner, { projectId: project.id, title: "Invitation destination" });
  await inviteToOrg(owner, { orgId: workspace.id, email: `${recipientId}@home.test`, role: "member" });

  expect(await render("hm-zero")).not.toContain('href="/hm-invited"');
  actor.id = recipientId;
  const next = `/${workspace.slug}/${project.slug}/${task.key}`;
  await expect(Home({ searchParams: Promise.resolve({ next }) })).rejects.toMatchObject({
    digest: expect.stringMatching(`^NEXT_REDIRECT;[^;]*;${encodeURIComponent(next)}(;|$)`),
  });
  expect(await render(recipientId)).toContain('href="/hm-invited"');
});

it("accepts only canonical work item and short share paths as sign-in continuations", async () => {
  const next = "/hm-a/first/HMF-1";
  const share = `/s/Aa_1-b${"x".repeat(16)}`;
  expect(taskSignInDestination(next)).toBe(next);
  expect(taskSignInDestination(share)).toBe(share);
  expect(taskSignInUrl(next)).toBe(`/?next=${encodeURIComponent(next)}`);
  for (const invalid of [
    ["", next],
    "https://example.com/hm-a/first/HMF-1",
    "//example.com/first/HMF-1",
    "/hm-a/../HMF-1",
    "/hm-a/first/HMF-01",
    "/hm-a/first/hmf-1",
    "/hm-a/first/HMF-1?next=/",
    "%2Fhm-a%2Ffirst%2FHMF-1",
    "/hm-a/first/HMF-1\\",
    `${share}/preview.png`,
    `${share}?preview=1`,
    `${share.slice(0, -1)}\n`,
  ]) {
    expect(taskSignInDestination(invalid)).toBeNull();
  }
  expect(taskSignInUrl(null)).toBe("/");

  actor.id = "hm-zero";
  const home = await Home({ searchParams: Promise.resolve({ next: "//example.com/first/HMF-1" }) });
  expect(renderToStaticMarkup(home)).toContain("No organizations yet");
});

/** The card for one org: from its link to the end of that link. */
const card = (html: string, slug: string) =>
  html.slice(html.indexOf(`href="/${slug}"`)).split("</a>")[0];

it("with no org, renders one empty-state card and no inline form", async () => {
  const html = await render("hm-zero");

  expect(html).toContain("No organizations yet");
  expect(html).not.toContain('href="/hm-');
  expect(html).not.toContain('name="slug"');
});

it("puts the account menu in the header and New organization beside the heading", async () => {
  const html = await render("hm-zero");
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));

  expect(header).toContain('aria-label="Account"');
  expect(header).not.toContain("New organization");
  expect(main).toContain('aria-haspopup="dialog"');
  expect(main.indexOf("Where would you like to work?")).toBeLessThan(
    main.indexOf("New organization"),
  );
  // The theme is an icon button just left of the account trigger.
  expect(header).toContain("Switch to dark theme");
  expect(header.indexOf("Switch to light theme")).toBeLessThan(
    header.indexOf('aria-label="Account"'),
  );
  // The sign-in page's lattice is the backdrop here too.
  expect(html).toContain('id="iso-lattice"');
});

it("with one org, shows its card instead of redirecting into it", async () => {
  const html = await render("hm-one");
  const solo = card(html, "hm-solo");

  expect(solo).toContain("HM Solo");
  expect(solo).toContain(">owner<");
  expect(solo).toMatch(/>1<\/span> project</);
});

it("with two orgs, shows both cards with plural counts and one blue CTA", async () => {
  const html = await render("hm-two");

  expect(card(html, "hm-a")).toMatch(/>2<\/span> projects</);
  expect(card(html, "hm-b")).toMatch(/>0<\/span> projects</);
  expect(html).not.toContain('name="slug"');
  const classes = [...html.matchAll(/ class="([^"]*)"/g)].flatMap((m) =>
    m[1].split(" "),
  );
  expect(classes.filter((c) => c === "bg-primary")).toHaveLength(1);
});

it("counts all projects in the member's organization", async () => {
  const html = await render("hm-member");

  expect(card(html, "hm-a")).toContain(">member<");
  expect(card(html, "hm-a")).toMatch(/>2<\/span> projects</);
  expect(html).not.toContain('href="/hm-b"');
});

it("/new redirects to /", () => {
  expect(() => NewOrgPage()).toThrow(
    expect.objectContaining({
      digest: expect.stringMatching(`^NEXT_REDIRECT;[^;]*;${encodeURIComponent("/")}(;|$)`),
    }),
  );
});
