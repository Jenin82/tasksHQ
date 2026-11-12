import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  addProjectMember,
  createOrg,
  createProject,
  createTask,
  setProjectMemberRole,
} from "@tasks/core/domain";
import { orgMember, user } from "@tasks/core/schema";

// Same seam as test/states.test.tsx: the route layer reads the session through
// this module, and the pool gives no live request context.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@projects.test`,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const ProjectsRedirect = (await import("@/app/[org]/(org)/projects/page")).default;
const OrgPage = (await import("@/app/[org]/(org)/page")).default;
const OrgLayout = (await import("@/app/[org]/layout")).default;
const MembersPage = (await import("@/app/[org]/(org)/settings/members/page")).default;

const db = drizzle(env.DB);
const now = new Date();

// Shared storage (§12: no per-test isolation), so every id and slug is `pp-`.
const IDS = ["pp-owner", "pp-admin", "pp-member", "pp-solo", "pp-none"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@projects.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

const ownerCtx = { db, actorUserId: "pp-owner", source: "web" as const };
const acme = await createOrg(ownerCtx, { slug: "pp-acme", name: "PP Acme" });
await db.insert(orgMember).values([
  { orgId: acme.id, userId: "pp-admin", role: "admin", createdAt: now },
  { orgId: acme.id, userId: "pp-member", role: "member", createdAt: now },
  { orgId: acme.id, userId: "pp-solo", role: "member", createdAt: now },
  { orgId: acme.id, userId: "pp-none", role: "member", createdAt: now },
]);

const alpha = await createProject(ownerCtx, {
  orgId: acme.id,
  slug: "alpha",
  name: "Alpha",
  key: "PPA",
});
const beta = await createProject(ownerCtx, {
  orgId: acme.id,
  slug: "beta",
  name: "Beta",
  key: "PPB",
});
// First by name, last by slug and by creation: `/[org]` must pick it by name.
await createProject(ownerCtx, {
  orgId: acme.id,
  slug: "zed",
  name: "Aardvark",
  key: "PPZ",
});
await addProjectMember(ownerCtx, { projectId: alpha.id, userId: "pp-member" });
await addProjectMember(ownerCtx, { projectId: beta.id, userId: "pp-solo" });
await createTask(ownerCtx, { projectId: alpha.id, title: "Only one" });
const emptyOrg = await createOrg(ownerCtx, { slug: "pp-empty", name: "PP Empty" });
await db.insert(orgMember).values({ orgId: emptyOrg.id, userId: "pp-none", role: "member", createdAt: now });

// `/[org]` is the project page again (§26), so these render it.
async function render(userId: string, org = "pp-acme") {
  actor.id = userId;
  return renderToStaticMarkup(await OrgPage({ params: Promise.resolve({ org }) }));
}

/** The card for one project: from its link to the end of that link. */
const card = (html: string, slug: string) =>
  html.slice(html.indexOf(`href="/pp-acme/${slug}"`)).split("</a>")[0];

const SETTINGS = 'href="/pp-acme/settings/members"';

it("shows an owner every project as a card with its key and task count", async () => {
  const html = await render("pp-owner");

  expect(html).toContain('id="iso-lattice"');
  expect(card(html, "alpha")).toContain("Alpha");
  expect(card(html, "alpha")).toContain(">PPA<");
  // §7.1's counts read as words, and one is singular.
  expect(card(html, "alpha")).toMatch(/>1<\/span> task</);
  expect(card(html, "beta")).toMatch(/>0<\/span> tasks</);
  // Ordered by name: Aardvark (slug zed) first.
  expect(html.indexOf('href="/pp-acme/zed"')).toBeLessThan(
    html.indexOf('href="/pp-acme/alpha"'),
  );
});

it("gives an owner the New project trigger and leaves settings in the sidebar", async () => {
  const html = await render("pp-owner");

  expect(html).not.toContain(SETTINGS);
  expect(html).not.toContain("Organization settings");
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain("New project");
  // The form lives in the closed dialog, not inline.
  expect(html).not.toContain('name="key"');
  const classes = [...html.matchAll(/ class="([^"]*)"/g)].flatMap((m) =>
    m[1].split(" "),
  );
  expect(classes.filter((c) => c === "bg-primary")).toHaveLength(1);
});

it("shows a regular member all organization projects and no organization settings link", async () => {
  const html = await render("pp-member");

  expect(html).toContain('href="/pp-acme/alpha"');
  expect(html).toContain('href="/pp-acme/beta"');
  expect(html).toContain('href="/pp-acme/zed"');
  expect(html).not.toContain(SETTINGS);
  expect(html).not.toContain("Organization settings");
  expect(html).not.toContain("New project");
  expect(html).not.toContain("bg-primary");
});

it("shows an empty workspace to a regular member without a create control", async () => {
  const html = await render("pp-none", emptyOrg.slug);

  expect(html).toContain("No projects yet");
  expect(html).not.toContain("New project");
  expect(html).not.toContain('href="/pp-acme/alpha"');
});

it("tells an owner of an empty org to create the first project", async () => {
  const html = await render("pp-owner", "pp-empty");

  expect(html).toContain("No projects yet");
  expect(html).toContain("Create the first one.");
  expect(html).toContain("New project");
});

it("renders the shared site footer even when there are no projects", async () => {
  const html = await render("pp-owner", "pp-empty");

  expect(html).toMatch(/No projects yet[\s\S]*<footer[\s\S]*©[\s\S]*Jenin<\/a> and TasksHQ contributors/);
});

it("has no org tab row", async () => {
  const html = await render("pp-owner");

  expect(html).not.toContain('aria-label="Organization"');
});

it("/[org]/projects redirects to /[org]", async () => {
  await expect(
    ProjectsRedirect({ params: Promise.resolve({ org: "pp-acme" }) }),
  ).rejects.toMatchObject({
    digest: expect.stringMatching(
      `^NEXT_REDIRECT;[^;]*;${encodeURIComponent("/pp-acme")}(;|$)`,
    ),
  });
});

it("forbids ordinary members from opening member settings directly", async () => {
  actor.id = "pp-member";
  await expect(MembersPage({ params: Promise.resolve({ org: "pp-acme" }) })).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;403",
  });
});

it("the members page links back to the project page", async () => {
  actor.id = "pp-owner";
  const html = renderToStaticMarkup(
    await MembersPage({ params: Promise.resolve({ org: "pp-acme" }) }),
  );

  expect(html).toMatch(/href="\/pp-acme"[^>]*>← Projects</);
});

it("lists every org project to an admin with no project_member row", async () => {
  const html = await render("pp-admin");

  expect(html).toContain('href="/pp-acme/alpha"');
  expect(html).toContain('href="/pp-acme/beta"');
});

it("passes every project to workspace navigation and flags settings per project role", async () => {
  await setProjectMemberRole(ownerCtx, { projectId: beta.id, userId: "pp-solo", role: "admin" });
  const available = [
    { slug: "zed", name: "Aardvark", key: "PPZ" },
    { slug: "alpha", name: "Alpha", key: "PPA" },
    { slug: "beta", name: "Beta", key: "PPB" },
  ];

  for (const userId of ["pp-member", "pp-solo", "pp-admin", "pp-owner"]) {
    actor.id = userId;
    const tree = (await OrgLayout({
      children: null,
      params: Promise.resolve({ org: "pp-acme" }),
    })) as React.ReactElement<{ projects: unknown }>;

    expect(tree.props.projects).toEqual(available.map((project) => ({
      ...project,
      canManageSettings: userId === "pp-admin" || userId === "pp-owner" || (userId === "pp-solo" && project.slug === "beta"),
    })));
  }
});
