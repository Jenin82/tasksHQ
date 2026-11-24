import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { beforeEach, expect, it, vi } from "vitest";
import { org, orgInvite, orgMember, team, user } from "@tasks/core/schema";
import { NO_ERROR } from "@/lib/action-result";
import { createTeam } from "./helpers";

// Same seam as test/settings.test.tsx: the route layer reads the session
// through this module, and the pool gives no live request context.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({ id: actor.id, name: actor.id, email: `${actor.id}@os.test`, emailVerified: true });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const Home = (await import("@/app/page")).default;
const Layout = (await import("@/app/settings/layout")).default;
const MembersPage = (await import("@/app/settings/members/page")).default;
const TeamsPage = (await import("@/app/settings/teams/page")).default;
const GeneralPage = (await import("@/app/settings/general/page")).default;
const { inviteOrgMemberAction, changeOrgMemberRoleAction, removeOrgMemberAction, revokeOrgInviteAction } =
  await import("@/app/settings/members/actions");
const { renameOrgAction } = await import("@/app/settings/general/actions");

const db = drizzle(env.DB);
const now = new Date();
const OWNER = "os-owner";
const ADMIN = "os-admin";
const MEMBER = "os-member";
const TARGET = "os-target";
const OUTSIDER = "os-outsider";
const ROLES = [[OWNER, "owner"], [ADMIN, "admin"], [MEMBER, "member"], [TARGET, "member"]] as const;

await db.insert(user).values([OWNER, ADMIN, MEMBER, TARGET, OUTSIDER].map((id) => ({
  id, name: id.toUpperCase(), email: `${id}@os.test`, emailVerified: true, createdAt: now, updatedAt: now,
})));

beforeEach(async () => {
  await db.batch([
    db.delete(orgInvite),
    ...ROLES.map(([userId, role]) => db.insert(orgMember).values({ userId, role, createdAt: now })
      .onConflictDoUpdate({ target: orgMember.userId, set: { role } })),
  ]);
});

const digest = (code: number) => ({ digest: `NEXT_HTTP_ERROR_FALLBACK;${code}` });
const pages = [MembersPage, TeamsPage, GeneralPage];

async function renderPage(Page: () => Promise<React.ReactElement>, userId: string) {
  actor.id = userId;
  return renderToStaticMarkup(await Page());
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function act<T>(userId: string, action: (prev: typeof NO_ERROR, data: FormData) => Promise<T>, values: Record<string, string>) {
  actor.id = userId;
  return action(NO_ERROR, form(values));
}

const roleOf = async (userId: string) =>
  (await db.select({ role: orgMember.role }).from(orgMember).where(eq(orgMember.userId, userId)))[0]?.role;

// Runs first, while this file's storage holds no teams.
it("sends `/` to the waiting page without a team, unless the user can make one", async () => {
  expect(await db.select().from(team)).toHaveLength(0);
  for (const id of [MEMBER, OUTSIDER]) {
    actor.id = id;
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Ask an admin to add you to a team.");
    expect(html).not.toContain("New team");
  }
  actor.id = ADMIN;
  const html = renderToStaticMarkup(await Home());
  expect(html).toContain("No teams yet");
  expect(html).toContain("New team");
  expect(html).not.toContain("Ask an admin");
});

it("404s the org pages and layout for someone outside the org, and 403s them for plain members", async () => {
  for (const Page of pages) {
    await expect(renderPage(Page, OUTSIDER)).rejects.toMatchObject(digest(404));
    await expect(renderPage(Page, MEMBER)).rejects.toMatchObject(digest(403));
  }
  actor.id = OUTSIDER;
  await expect(Layout({ children: null })).rejects.toMatchObject(digest(404));
});

it("lists org members, leaving owners out of an admin's reach", async () => {
  const asAdmin = await renderPage(MembersPage, ADMIN);
  for (const id of [OWNER, ADMIN, MEMBER, TARGET]) expect(asAdmin).toContain(id.toUpperCase());
  expect(asAdmin).not.toContain(OUTSIDER.toUpperCase());
  expect(asAdmin).toContain(`aria-label="Role for ${MEMBER.toUpperCase()}"`);
  expect(asAdmin).not.toContain(`aria-label="Role for ${OWNER.toUpperCase()}"`);
  expect(asAdmin).not.toContain('value="owner">Super admin');
  // An admin sees the owner's role as a label, never the stored value.
  expect(asAdmin).toContain('<span class="stutter">Super admin</span>');
  expect(asAdmin).not.toMatch(/>owner</i);

  const asOwner = await renderPage(MembersPage, OWNER);
  expect(asOwner).toContain(`aria-label="Role for ${ADMIN.toUpperCase()}"`);
  expect(asOwner).toContain('<option value="owner">Super admin</option>');
});

it("invites and revokes through the domain, refusing an admin's owner invite", async () => {
  expect(await act(ADMIN, inviteOrgMemberAction, { email: "New@os.test", role: "member" })).toEqual(NO_ERROR);
  expect(await db.select({ email: orgInvite.email, role: orgInvite.role }).from(orgInvite))
    .toEqual([{ email: "new@os.test", role: "member" }]);
  expect(await renderPage(MembersPage, ADMIN)).toContain("new@os.test");

  const refused = await act(ADMIN, inviteOrgMemberAction, { email: "boss@os.test", role: "owner" });
  expect(refused.error).toMatch(/Only a Super admin/);
  expect(refused.values).toEqual({ email: "boss@os.test", role: "owner" });
  // Access denials surface as the 403 page, as in team settings.
  await expect(act(MEMBER, inviteOrgMemberAction, { email: "x@os.test", role: "member" })).rejects.toMatchObject(digest(403));

  expect(await act(ADMIN, revokeOrgInviteAction, { email: "new@os.test" })).toEqual(NO_ERROR);
  expect(await db.select().from(orgInvite)).toHaveLength(0);
});

it("changes roles and removes members, but an admin cannot act on an owner", async () => {
  expect(await act(ADMIN, changeOrgMemberRoleAction, { userId: TARGET, role: "admin" })).toEqual(NO_ERROR);
  expect(await roleOf(TARGET)).toBe("admin");
  await expect(act(ADMIN, changeOrgMemberRoleAction, { userId: OWNER, role: "member" })).rejects.toMatchObject(digest(403));
  expect(await roleOf(OWNER)).toBe("owner");
  await expect(act(ADMIN, removeOrgMemberAction, { userId: OWNER })).rejects.toMatchObject(digest(403));
  expect(await roleOf(OWNER)).toBe("owner");

  expect(await act(OWNER, changeOrgMemberRoleAction, { userId: ADMIN, role: "member" })).toEqual(NO_ERROR);
  expect(await roleOf(ADMIN)).toBe("member");
  expect(await act(OWNER, removeOrgMemberAction, { userId: TARGET })).toEqual(NO_ERROR);
  expect(await roleOf(TARGET)).toBeUndefined();
});

it("renames the org for owners and admins only", async () => {
  expect(await act(ADMIN, renameOrgAction, { name: "  Renamed Org " })).toEqual({ values: { name: "Renamed Org" } });
  expect((await db.select({ name: org.name }).from(org))[0].name).toBe("Renamed Org");
  expect(await renderPage(GeneralPage, OWNER)).toContain('value="Renamed Org"');
  await expect(act(MEMBER, renameOrgAction, { name: "Nope" })).rejects.toMatchObject(digest(403));
  expect((await db.select({ name: org.name }).from(org))[0].name).toBe("Renamed Org");
});

it("lists every team with its member count, and New team, for org admins", async () => {
  await createTeam({ db, actorUserId: MEMBER }, { slug: "os-acme", name: "OS Acme" });
  await createTeam({ db, actorUserId: OWNER }, { slug: "os-beta", name: "OS Beta" });

  const html = await renderPage(TeamsPage, ADMIN);
  expect(html).toContain('href="/os-acme"');
  expect(html).toContain('href="/os-beta"');
  expect(html).toMatch(/>1<\/span> member</);
  expect(html).toContain("New team");
});

it("labels the org owner role Super admin in the header and on team cards", async () => {
  await createTeam({ db, actorUserId: MEMBER }, { slug: "os-labels", name: "OS Labels" });
  // The layout's shell needs a router, so read the header badge from the element tree.
  const badge = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) return node.map(badge).find((found) => found !== undefined);
    const props = (node as { props?: { className?: string; children?: unknown; header?: unknown } }).props;
    if (props?.className === "stutter hidden shrink-0 sm:inline") return props.children;
    return badge(props?.header) ?? badge(props?.children);
  };
  const card = (html: string) => html.match(/href="\/os-labels"[^>]*>[\s\S]*?<span class="stutter">([^<]*)<\/span>/)?.[1];
  for (const [id, label, teamLabel] of [[OWNER, "Super admin", "Super admin"], [ADMIN, "Admin", "Admin"], [MEMBER, "Member", "Admin"]] as const) {
    actor.id = id;
    expect(badge(await Layout({ children: null }))).toBe(label);
    // An org owner's implicit team access shows their org role; everyone else shows the team role.
    expect(card(renderToStaticMarkup(await Home()))).toBe(teamLabel);
  }
});
