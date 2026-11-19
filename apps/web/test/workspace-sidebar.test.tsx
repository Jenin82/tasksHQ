import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import { WorkspaceShell } from "@/components/workspace-shell";

const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

const oneTeam = [{ slug: "acme", name: "Acme Corp", member: true }];
const twoTeams = [{ slug: "acme", name: "Acme Corp", member: true }, { slug: "globex", name: "Globex", member: true }];
const current = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*aria-current="page"[^>]*>/g)].map(([, href]) => href);

const org = { canManage: false };

function renderSidebar(pathname: string, canManageWorkspace: boolean, teams = oneTeam, canManageProject = false, orgAdmin = false) {
  route.pathname = pathname;
  return renderToStaticMarkup(
    <WorkspaceShell team="acme" org={{ ...org, canManage: orgAdmin }} projects={[{ slug: "web", key: "WEB", name: "Website", canManageSettings: canManageProject }]} canManageWorkspace={canManageWorkspace} hasReports canViewTimeReports={false} teams={teams} header={null}>
      Content
    </WorkspaceShell>,
  );
}

it("shows the active team section inside Settings for administrators", () => {
  const html = renderSidebar("/acme/settings/reporting-lines", true);
  expect(html).toContain("aria-label=\"Team settings\"");
  expect(html).toContain('href="/acme/settings/members"');
  expect(html).toContain('href="/acme/settings/general"');
  expect(html).toMatch(/<a\b[^>]*href="\/acme\/settings\/reporting-lines"[^>]*aria-current="page"[^>]*>Reporting lines<\/a>/);
});

it("keeps task pages outside the Settings submenu", () => {
  const html = renderSidebar("/acme/settings/your-tasks", true);
  expect(html).not.toContain("aria-label=\"Team settings\"");
  expect(html).toMatch(/href="\/acme\/settings\/your-tasks"[^>]*aria-current="page"/);
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

it("shows Team Time to time-report viewers and leads only", () => {
  route.pathname = "/acme/settings/your-tasks";
  const render = (canViewTimeReports: boolean, hasReports: boolean) => renderToStaticMarkup(
    <WorkspaceShell team="acme" org={org} projects={[]} canManageWorkspace={false} hasReports={hasReports} canViewTimeReports={canViewTimeReports} teams={oneTeam} header={null}>
      Content
    </WorkspaceShell>,
  );
  const link = /<a\b[^>]*href="\/acme\/settings\/time"[^>]*>.*?Team Time<\/a>/;
  expect(render(true, false)).toMatch(link);
  expect(render(false, true)).toMatch(link);
  expect(render(false, false)).not.toContain('href="/acme/settings/time"');
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

it("gives the Teams and Workspace headings an open collapse toggle", () => {
  const html = renderSidebar("/acme", false, twoTeams);
  for (const label of ["Teams", "Workspace"]) {
    expect(html).toMatch(new RegExp(`<button\\b[^>]*aria-label="Collapse ${label}"[^>]*aria-expanded="true"`));
  }
  expect(renderSidebar("/acme", false)).toContain('aria-label="Collapse Workspace"');
});

it("keeps Workspace from collapsing over the page you're on", () => {
  const toggle = (html: string) => html.match(/<button\b[^>]*aria-label="Collapse Workspace"[^>]*>/)?.[0] ?? "";
  for (const path of ["/acme", "/acme/settings/members", "/acme/settings/your-time"]) {
    expect(toggle(renderSidebar(path, true))).toMatch(/\sdisabled=""/);
  }
  for (const path of ["/acme/web", "/acme/settings/all-tasks"]) {
    expect(toggle(renderSidebar(path, true, twoTeams))).not.toMatch(/\sdisabled=""/);
  }
});

it("lists teams an org admin opens without joining, but keeps All My Tasks to real teams", () => {
  const html = renderSidebar("/acme", false, [...oneTeam, { slug: "globex", name: "Globex", member: false }]);
  expect(html).toContain('aria-label="Teams"');
  expect(html).toContain('href="/globex"');
  expect(html).not.toContain('href="/acme/settings/all-tasks"');
});

it("shows the Organization links and New team only to org admins", () => {
  const member = renderSidebar("/acme", false, twoTeams);
  expect(member).not.toContain('aria-label="Organization"');
  expect(member).not.toContain('href="/settings/members"');
  expect(member).not.toContain('aria-label="New team"');

  const admin = renderSidebar("/acme", false, twoTeams, false, true);
  const group = admin.split('aria-label="Organization"')[1]?.split("</div>")[0] ?? "";
  for (const page of ["members", "teams", "general"]) expect(group).toContain(`href="/settings/${page}"`);
  expect(admin.indexOf('aria-label="Organization"')).toBeLessThan(admin.indexOf(">Teams</p>"));
  expect(admin).toContain('aria-label="New team"');
});

it("on the org's pages, lists every team and marks the open org page, with no Workspace or Projects", () => {
  route.pathname = "/settings/teams";
  const html = renderToStaticMarkup(
    <WorkspaceShell org={{ ...org, canManage: true }} projects={[]} canManageWorkspace={false} hasReports={false} canViewTimeReports={false} teams={oneTeam} header={null}>
      Content
    </WorkspaceShell>,
  );
  expect(current(html)).toEqual(["/settings/teams"]);
  expect(html).toContain('href="/acme"');
  expect(html).not.toContain(">Workspace</p>");
  expect(html).not.toContain(">Projects</p>");
});
