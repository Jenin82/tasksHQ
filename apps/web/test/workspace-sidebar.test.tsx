import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import { WorkspaceShell } from "@/components/workspace-shell";

const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

const oneOrg = [{ slug: "acme", name: "Acme Corp" }];
const twoOrgs = [{ slug: "acme", name: "Acme Corp" }, { slug: "globex", name: "Globex" }];
const current = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*aria-current="page"[^>]*>/g)].map(([, href]) => href);

function renderSidebar(pathname: string, canManageWorkspace: boolean, orgs = oneOrg, canManageProject = false) {
  route.pathname = pathname;
  return renderToStaticMarkup(
    <WorkspaceShell org="acme" projects={[{ slug: "web", key: "WEB", name: "Website", canManageSettings: canManageProject }]} canManageWorkspace={canManageWorkspace} hasReports canViewTimeReports={false} orgs={orgs} header={null}>
      Content
    </WorkspaceShell>,
  );
}

it("shows the active organization section inside Settings for administrators", () => {
  const html = renderSidebar("/acme/settings/team", true);
  expect(html).toContain("aria-label=\"Organization settings\"");
  expect(html).toContain('href="/acme/settings/members"');
  expect(html).toContain('href="/acme/settings/general"');
  expect(html).toMatch(/<a\b[^>]*href="\/acme\/settings\/team"[^>]*aria-current="page"[^>]*>Reporting lines<\/a>/);
});

it("keeps task pages outside the Settings submenu", () => {
  const html = renderSidebar("/acme/settings/your-tasks", true);
  expect(html).not.toContain("aria-label=\"Organization settings\"");
  expect(html).toMatch(/href="\/acme\/settings\/your-tasks"[^>]*aria-current="page"/);
});

it("shows All My Tasks above Workspace only for users in multiple organizations", () => {
  const href = 'href="/acme/settings/all-tasks"';
  expect(renderSidebar("/acme/settings/your-tasks", false)).not.toContain(href);

  const html = renderSidebar("/acme/settings/all-tasks", false, twoOrgs);
  expect(html).toMatch(/href="\/acme\/settings\/all-tasks"[^>]*aria-current="page"/);
  expect(html.indexOf(href)).toBeLessThan(html.indexOf(">Workspace</p>"));
});

it("keeps the Settings submenu hidden from ordinary members", () => {
  const html = renderSidebar("/acme/settings/members", false);
  expect(html).not.toContain('href="/acme/settings/members"');
  expect(html).not.toContain("aria-label=\"Organization settings\"");
  expect(html).toContain('href="/acme/settings/your-tasks"');
});


it("shows project Settings to authorized admins and Archive to all project readers", () => {
  const regular = renderSidebar("/acme/web", false);
  expect(regular).not.toContain('href="/acme/web/settings"');
  expect(regular).toContain('href="/acme/web/archived"');

  const scopedAdmin = renderSidebar("/acme/web", false, oneOrg, true);
  expect(scopedAdmin).toContain('href="/acme/web/settings"');
  expect(scopedAdmin).toContain('href="/acme/web/archived"');
  expect(scopedAdmin).not.toContain('href="/acme/settings/members"');
});

it("shows the project settings pages only on settings paths, marking just the open page", () => {
  const group = 'aria-label="Project settings"';
  expect(renderSidebar("/acme/web", false, oneOrg, true)).not.toContain(group);
  expect(renderSidebar("/acme/web/archived", false, oneOrg, true)).not.toContain(group);
  expect(renderSidebar("/acme/web/settingsx", false, oneOrg, true)).not.toContain(group);
  expect(renderSidebar("/acme/web/settings/workflow", false, oneOrg, false)).not.toContain(group);

  for (const [path, label] of [["", "General"], ["/workflow", "Workflow"], ["/admins", "Admins"], ["/integrations", "Integrations"]]) {
    const html = renderSidebar(`/acme/web/settings${path}`, false, oneOrg, true);
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
    <WorkspaceShell org="acme" projects={[]} canManageWorkspace={false} hasReports={hasReports} canViewTimeReports={canViewTimeReports} orgs={oneOrg} header={null}>
      Content
    </WorkspaceShell>,
  );
  const link = /<a\b[^>]*href="\/acme\/settings\/time"[^>]*>.*?Team Time<\/a>/;
  expect(render(true, false)).toMatch(link);
  expect(render(false, true)).toMatch(link);
  expect(render(false, false)).not.toContain('href="/acme/settings/time"');
});

it("lists organizations only for users in more than one", () => {
  const html = renderSidebar("/acme", false);
  expect(html).not.toContain('aria-label="Organizations"');
  expect(html).not.toContain('href="/globex"');
  expect(html).not.toContain("New organization");
});

const orgRow = (html: string, name: string) =>
  [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].find(([, , inner]) => inner.includes(`>${name}<`))?.[1];

it("lists organizations above the current org's Workspace and Projects, highlighting the current one", () => {
  const html = renderSidebar("/acme/settings/your-tasks", false, twoOrgs);
  const group = html.split('aria-label="Organizations"')[1]?.split(">Workspace</p>")[0] ?? "";
  expect(group).toContain('href="/acme"');
  expect(group).toContain('href="/globex"');
  expect(group).not.toContain("New organization");
  // The + beside the heading opens the create dialog in place, not a link to `/`.
  const heading = html.split(">Organizations</p>")[1]?.split('aria-label="Organizations"')[0] ?? "";
  expect(heading).toMatch(/<button\b[^>]*aria-label="New organization"[^>]*aria-haspopup="dialog"|<button\b[^>]*aria-haspopup="dialog"[^>]*aria-label="New organization"/);
  expect(html).not.toMatch(/<a\b[^>]*href="\/"/);
  expect(html.indexOf(">Workspace</p>")).toBeLessThan(html.indexOf(">Projects</p>"));

  expect(orgRow(html, "Acme Corp")).toMatch(/\sbg-muted\b/);
  expect(orgRow(html, "Globex")).not.toMatch(/\sbg-muted\b/);
});

it("shows exactly three organizations and Show more, the current one taking the last row", () => {
  const orgs = ["a", "b", "c", "d", "acme"].map((slug) => ({ slug, name: slug === "acme" ? "Acme Corp" : `Org ${slug}` }));
  const html = renderSidebar("/acme", false, orgs);
  for (const slug of ["a", "b", "acme"]) expect(html).toContain(`href="/${slug}"`);
  for (const slug of ["c", "d"]) expect(html).not.toContain(`href="/${slug}"`);
  // With the current org already in the first three, the first three show as they are.
  const first = renderSidebar("/acme", false, [orgs[4], ...orgs.slice(0, 4)]);
  for (const slug of ["acme", "a", "b"]) expect(first).toContain(`href="/${slug}"`);
  expect(first).not.toContain('href="/c"');
  const showMore = [...html.matchAll(/<button\b([^>]*)>((?:(?!<\/button>).)*)<\/button>/g)].find(([, , inner]) => inner.includes("Show more"));
  expect(showMore?.[1]).toContain('aria-expanded="false"');
  expect(html).toContain('aria-label="New organization"');

  const three = renderSidebar("/acme", false, orgs.slice(2));
  expect(three).not.toContain("Show more");
});

it("marks only the Workspace Projects link current on the org page, never the org row", () => {
  const html = renderSidebar("/acme", false, twoOrgs);
  expect(current(html)).toEqual(["/acme"]);
  const row = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].find(([, , inner]) => inner.includes(">Acme Corp<"));
  expect(row?.[1]).toContain('href="/acme"');
  expect(row?.[1]).not.toContain("aria-current");
  expect(html).toMatch(/<a\b[^>]*href="\/acme"[^>]*aria-current="page"[^>]*>.*?Projects<\/a>/);
});

it("gives the Organizations and Workspace headings an open collapse toggle", () => {
  const html = renderSidebar("/acme", false, twoOrgs);
  for (const label of ["Organizations", "Workspace"]) {
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
    expect(toggle(renderSidebar(path, true, twoOrgs))).not.toMatch(/\sdisabled=""/);
  }
});
