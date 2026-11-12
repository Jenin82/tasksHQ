import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import { WorkspaceShell } from "@/components/workspace-shell";

const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

function renderSidebar(pathname: string, canManageWorkspace: boolean, hasMultipleOrganizations = false, canManageProject = false) {
  route.pathname = pathname;
  return renderToStaticMarkup(
    <WorkspaceShell org="acme" projects={[{ slug: "web", key: "WEB", name: "Website", canManageSettings: canManageProject }]} canManageWorkspace={canManageWorkspace} hasReports hasMultipleOrganizations={hasMultipleOrganizations} header={null}>
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

  const html = renderSidebar("/acme/settings/all-tasks", false, true);
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

  const scopedAdmin = renderSidebar("/acme/web", false, false, true);
  expect(scopedAdmin).toContain('href="/acme/web/settings"');
  expect(scopedAdmin).toContain('href="/acme/web/archived"');
  expect(scopedAdmin).not.toContain('href="/acme/settings/members"');
});
