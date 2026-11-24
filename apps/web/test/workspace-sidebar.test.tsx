import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import { WorkspaceShell, parseClosedSections } from "@/components/workspace-shell";

const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

const oneTeam = [{ slug: "acme", name: "Acme Corp", member: true }];
const twoTeams = [{ slug: "acme", name: "Acme Corp", member: true }, { slug: "globex", name: "Globex", member: true }];
const current = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*aria-current="page"[^>]*>/g)].map(([, href]) => href);

const org = { canManage: false };

function renderSidebar(pathname: string, canManageWorkspace: boolean, teams = oneTeam, canManageProject = false, orgAdmin = false) {
  route.pathname = pathname;
  return renderToStaticMarkup(
    <WorkspaceShell team="acme" org={{ ...org, canManage: orgAdmin }} projects={[{ slug: "web", key: "WEB", name: "Website", canManageSettings: canManageProject }]} canManageWorkspace={canManageWorkspace} teams={teams} header={null}>
      Content
    </WorkspaceShell>,
  );
}

it("shows the active team section inside Team settings for administrators", () => {
  const html = renderSidebar("/acme/settings/general", true);
  expect(html).toContain("aria-label=\"Team settings\"");
  expect(html).toMatch(/<a\b[^>]*href="\/acme\/settings\/members"[^>]*>.*?Team settings<\/a>/);
  expect(html).not.toMatch(/>\s*Settings<\/a>/);
  expect(html).toContain('href="/acme/settings/members"');
  expect(html).toMatch(/<a\b[^>]*href="\/acme\/settings\/general"[^>]*aria-current="page"[^>]*>General<\/a>/);
  expect(html).not.toContain('href="/acme/settings/reporting-lines"');
});

it("keeps task pages outside the Settings submenu", () => {
  const html = renderSidebar("/acme/settings/your-tasks", true);
  expect(html).not.toContain("aria-label=\"Team settings\"");
  expect(html).toMatch(/href="\/acme\/settings\/your-tasks"[^>]*aria-current="page"/);
  expect(html).not.toContain("Your Reports");
});

it("shows All My Tasks above Workspace only for users in multiple teams", () => {
  const href = 'href="/acme/settings/all-tasks"';
  expect(renderSidebar("/acme/settings/your-tasks", false)).not.toContain(href);

  const html = renderSidebar("/acme/settings/all-tasks", false, twoTeams);
  expect(html).toMatch(/href="\/acme\/settings\/all-tasks"[^>]*aria-current="page"/);
  expect(html.indexOf(href)).toBeLessThan(html.indexOf(">Workspace</p>"));
});

it("keeps the Settings submenu hidden from ordinary members", () => {
  const html = renderSidebar("/acme/settings/members", false);
  expect(html).not.toContain('href="/acme/settings/members"');
  expect(html).not.toContain("aria-label=\"Team settings\"");
  expect(html).toContain('href="/acme/settings/your-tasks"');
});


it("shows project Settings to authorized admins and Archive to all project readers", () => {
  const regular = renderSidebar("/acme/web", false);
  expect(regular).not.toContain('href="/acme/web/settings"');
  expect(regular).toContain('href="/acme/web/archived"');

  const scopedAdmin = renderSidebar("/acme/web", false, oneTeam, true);
  expect(scopedAdmin).toContain('href="/acme/web/settings"');
  expect(scopedAdmin).toContain('href="/acme/web/archived"');
  expect(scopedAdmin).not.toContain('href="/acme/settings/members"');
});

it("shows the project settings pages only on settings paths, marking just the open page", () => {
  const group = 'aria-label="Project settings"';
  expect(renderSidebar("/acme/web", false, oneTeam, true)).not.toContain(group);
  expect(renderSidebar("/acme/web/archived", false, oneTeam, true)).not.toContain(group);
  expect(renderSidebar("/acme/web/settingsx", false, oneTeam, true)).not.toContain(group);
  expect(renderSidebar("/acme/web/settings/workflow", false, oneTeam, false)).not.toContain(group);

  for (const [path, label] of [["", "General"], ["/workflow", "Workflow"], ["/admins", "Admins"], ["/integrations", "Integrations"]]) {
    const html = renderSidebar(`/acme/web/settings${path}`, false, oneTeam, true);
    const submenu = html.split(group)[1]?.split("</div>")[0] ?? "";
    expect(submenu).toContain('href="/acme/web/settings"');
    expect(submenu).toContain('href="/acme/web/settings/workflow"');
    expect(submenu).toContain('href="/acme/web/settings/admins"');
    expect(submenu).toContain('href="/acme/web/settings/integrations"');
    expect(submenu).toMatch(new RegExp(`<a\\b[^>]*href="/acme/web/settings${path}"[^>]*aria-current="page"[^>]*>${label}</a>`));
    // Only the sub-item is current; the parent Settings link is not.
    expect(current(html)).toEqual([`/acme/web/settings${path}`]);
  }
});

it("shows one Time link above the sections to everyone, and the Settings section to org admins", () => {
  route.pathname = "/acme/settings/your-tasks";
  const render = (orgNav: typeof org) => renderToStaticMarkup(
    <WorkspaceShell team="acme" org={orgNav} projects={[]} canManageWorkspace={false} teams={oneTeam} header={null}>
      Content
    </WorkspaceShell>,
  );
  const links = (html: string) => [...html.matchAll(/<a\b[^>]*href="(\/settings\/[^"]+)"/g)].map(([, href]) => href);
  // Every org member gets one Time link; nothing time-related stays in the team's Workspace.
  const member = render(org);
  expect(links(member)).toEqual(["/settings/time"]);
  expect(member).toMatch(/<a\b[^>]*href="\/settings\/time"[^>]*>.*?Time<\/a>/);
  expect(member).not.toContain("Your Time");
  expect(member).not.toContain("Team Time");
  expect(member).not.toContain('href="/acme/settings/your-time"');
  expect(member).not.toContain('href="/acme/settings/time"');
  expect(member).not.toContain(">Settings</p>");
  expect(member).not.toContain('aria-label="Settings"');
  expect(member.indexOf('href="/settings/time"')).toBeLessThan(member.indexOf(">Workspace</p>"));
  // An org admin: the Time link, then the Settings section in its own order.
  const orgAdmin = render({ canManage: true });
  expect(links(orgAdmin)).toEqual([
    "/settings/time", "/settings/teams", "/settings/members", "/settings/reporting-lines", "/settings/general",
  ]);
  const group = orgAdmin.split('aria-label="Settings"')[1]?.split("</div>")[0] ?? "";
  for (const page of ["teams", "members", "reporting-lines", "general"]) expect(group).toContain(`href="/settings/${page}"`);
  expect(orgAdmin.indexOf(">Settings</p>")).toBeLessThan(orgAdmin.indexOf(">Workspace</p>"));
});

it("lists teams only for users in more than one", () => {
  const html = renderSidebar("/acme", false);
  expect(html).not.toContain('aria-label="Teams"');
  expect(html).not.toContain('href="/globex"');
  expect(html).not.toContain("New team");
});

const teamRow = (html: string, name: string) =>
  [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].find(([, , inner]) => inner.includes(`>${name}<`))?.[1];

it("lists teams above the current team's Workspace and Projects, highlighting the current one", () => {
  const html = renderSidebar("/acme/settings/your-tasks", false, twoTeams, false, true);
  const group = html.split('aria-label="Teams"')[1]?.split(">Workspace</p>")[0] ?? "";
  expect(group).toContain('href="/acme"');
  expect(group).toContain('href="/globex"');
  expect(group).not.toContain("New team");
  // The + beside the heading opens the create dialog in place, not a link to `/`.
  const heading = html.split(">Teams</p>")[1]?.split('aria-label="Teams"')[0] ?? "";
  expect(heading).toMatch(/<button\b[^>]*aria-label="New team"[^>]*aria-haspopup="dialog"|<button\b[^>]*aria-haspopup="dialog"[^>]*aria-label="New team"/);
  expect(html).not.toMatch(/<a\b[^>]*href="\/"/);
  expect(html.indexOf(">Workspace</p>")).toBeLessThan(html.indexOf(">Projects</p>"));

  expect(teamRow(html, "Acme Corp")).toMatch(/\sbg-muted\b/);
  expect(teamRow(html, "Globex")).not.toMatch(/\sbg-muted\b/);
});

it("shows exactly three teams and Show more, the current one taking the last row", () => {
  const teams = ["a", "b", "c", "d", "acme"].map((slug) => ({ slug, name: slug === "acme" ? "Acme Corp" : `Team ${slug}`, member: true }));
  const html = renderSidebar("/acme", false, teams, false, true);
  for (const slug of ["a", "b", "acme"]) expect(html).toContain(`href="/${slug}"`);
  for (const slug of ["c", "d"]) expect(html).not.toContain(`href="/${slug}"`);
  // With the current team already in the first three, the first three show as they are.
  const first = renderSidebar("/acme", false, [teams[4], ...teams.slice(0, 4)]);
  for (const slug of ["acme", "a", "b"]) expect(first).toContain(`href="/${slug}"`);
  expect(first).not.toContain('href="/c"');
  const showMore = [...html.matchAll(/<button\b([^>]*)>((?:(?!<\/button>).)*)<\/button>/g)].find(([, , inner]) => inner.includes("Show more"));
  expect(showMore?.[1]).toContain('aria-expanded="false"');
  expect(html).toContain('aria-label="New team"');

  const three = renderSidebar("/acme", false, teams.slice(2));
  expect(three).not.toContain("Show more");
});

it("marks only the Workspace Projects link current on the team page, never the team row", () => {
  const html = renderSidebar("/acme", false, twoTeams);
  expect(current(html)).toEqual(["/acme"]);
  const row = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].find(([, , inner]) => inner.includes(">Acme Corp<"));
  expect(row?.[1]).toContain('href="/acme"');
  expect(row?.[1]).not.toContain("aria-current");
  expect(html).toMatch(/<a\b[^>]*href="\/acme"[^>]*aria-current="page"[^>]*>.*?Projects<\/a>/);
});

it("gives the Settings, Teams and Workspace headings an open collapse toggle", () => {
  const html = renderSidebar("/acme", false, twoTeams, false, true);
  for (const label of ["Settings", "Teams", "Workspace"]) {
    expect(html).toMatch(new RegExp(`<button\\b[^>]*aria-label="Collapse ${label}"[^>]*aria-expanded="true"`));
  }
  expect(renderSidebar("/acme", false)).toContain('aria-label="Collapse Workspace"');
});

it("lets Workspace collapse even on the page you're on", () => {
  const toggle = (html: string) => html.match(/<button\b[^>]*aria-label="Collapse Workspace"[^>]*>/)?.[0] ?? "";
  for (const path of ["/acme", "/acme/settings/members", "/acme/web"]) {
    const button = toggle(renderSidebar(path, true));
    expect(button).not.toBe("");
    expect(button).not.toMatch(/\sdisabled=""/);
  }
});

it("lists teams an org admin opens without joining, but keeps All My Tasks to real teams", () => {
  const html = renderSidebar("/acme", false, [...oneTeam, { slug: "globex", name: "Globex", member: false }]);
  expect(html).toContain('aria-label="Teams"');
  expect(html).toContain('href="/globex"');
  expect(html).not.toContain('href="/acme/settings/all-tasks"');
});

it("shows the Settings section and New team only to org admins", () => {
  const member = renderSidebar("/acme", false, twoTeams);
  expect(member).not.toContain('aria-label="Settings"');
  expect(member).not.toContain('aria-label="Collapse Settings"');
  for (const page of ["members", "teams", "reporting-lines", "general"]) expect(member).not.toContain(`href="/settings/${page}"`);
  expect(member).not.toContain('aria-label="New team"');

  const admin = renderSidebar("/acme", false, twoTeams, false, true);
  const group = admin.split('aria-label="Settings"')[1]?.split("</div>")[0] ?? "";
  const hrefs = [...group.matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
  expect(hrefs).toEqual(["/settings/teams", "/settings/members", "/settings/reporting-lines", "/settings/general"]);
  expect(admin.indexOf('aria-label="Settings"')).toBeLessThan(admin.indexOf(">Teams</p>"));
  expect(admin).toContain('aria-label="New team"');
});

it("lets Settings collapse even on the org page you're on", () => {
  const toggle = (html: string) => html.match(/<button\b[^>]*aria-label="Collapse Settings"[^>]*>/)?.[0] ?? "";
  for (const path of ["/settings/teams", "/settings/members", "/settings/reporting-lines", "/settings/general", "/acme"]) {
    route.pathname = path;
    const html = renderToStaticMarkup(
      <WorkspaceShell org={{ ...org, canManage: true }} projects={[]} canManageWorkspace={false} teams={oneTeam} header={null}>
        Content
      </WorkspaceShell>,
    );
    expect(toggle(html)).not.toBe("");
    expect(toggle(html)).not.toMatch(/\sdisabled=""/);
  }
});

it("remembers each collapse under its own key", () => {
  expect(parseClosedSections(JSON.stringify({ settings: true, allTeams: true })))
    .toEqual({ teams: false, workspace: false, settings: true, allTeams: true });
  // The old Organizations key still maps to Teams; unknown keys and non-true values are dropped.
  expect(parseClosedSections(JSON.stringify({ organizations: true, workspace: true, settings: "yes", other: true })))
    .toEqual({ teams: true, workspace: true, settings: false, allTeams: false });
  expect(parseClosedSections(null)).toEqual({ teams: false, workspace: false, settings: false, allTeams: false });
  expect(parseClosedSections("[]")).toBeNull();
});

it("on the org's pages, lists every team and marks the open org page, with no Workspace or Projects", () => {
  route.pathname = "/settings/teams";
  const html = renderToStaticMarkup(
    <WorkspaceShell org={{ ...org, canManage: true }} projects={[]} canManageWorkspace={false} teams={oneTeam} header={null}>
      Content
    </WorkspaceShell>,
  );
  expect(current(html)).toEqual(["/settings/teams"]);
  expect(html).toContain('href="/acme"');
  expect(html).not.toContain(">Workspace</p>");
  expect(html).not.toContain(">Projects</p>");
});
