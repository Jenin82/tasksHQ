import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it } from "vitest";
import DocsPage from "@/app/docs/page";
import GettingStartedPage from "@/app/docs/getting-started/page";
import IntegrationsPage from "@/app/docs/integrations/page";
import McpGuide from "@/app/docs/mcp/page";
import OrganizationSettingsPage from "@/app/docs/organization-settings/page";
import ProjectSettingsPage from "@/app/docs/project-settings/page";
import { GET as getSearchIndex } from "@/app/docs/search-index.json/route";
import { searchDocs, type DocsSearchEntry } from "@/app/docs/search";
import ViewsPage from "@/app/docs/views/page";
import WorkItemsPage from "@/app/docs/work-items/page";
import { legacyMcpSections } from "@/app/docs/topics";

const guidePages = {
  "/docs/getting-started": GettingStartedPage,
  "/docs/work-items": WorkItemsPage,
  "/docs/views": ViewsPage,
  "/docs/project-settings": ProjectSettingsPage,
  "/docs/organization-settings": OrganizationSettingsPage,
  "/docs/integrations": IntegrationsPage,
  "/docs/mcp": McpGuide,
};

it("links to every product guide from the documentation overview", () => {
  const html = renderToStaticMarkup(<DocsPage />);
  const content = html.split('<main id="guide-content"')[1];

  expect(content).toContain("Learn to use TasksHQ");
  for (const path of Object.keys(guidePages)) expect(content).toContain(`href="${path}"`);
});

it("keeps guide navigation and section links resolvable", () => {
  const pages = new Map(Object.entries({ "/docs": DocsPage, ...guidePages }).map(([path, Page]) => (
    [path, renderToStaticMarkup(<Page />)]
  )));

  for (const [source, html] of pages) {
    for (const [, href] of html.matchAll(/\bhref="([^"]+)"/g)) {
      if (href !== "/docs" && !href.startsWith("/docs/") && !href.startsWith("#")) continue;
      const [path, fragment] = href.split("#");
      const target = pages.get(path || source);
      expect(target, `${source} links to ${href}`).toBeDefined();
      if (fragment) expect(target, `${source} links to ${href}`).toContain(`id="${fragment}"`);
    }
  }
});

async function readSearchIndex(): Promise<DocsSearchEntry[]> {
  const response = await getSearchIndex();
  expect(response.ok).toBe(true);
  return await response.json() as DocsSearchEntry[];
}

it("indexes every rendered guide section at its exact anchor", async () => {
  const entries = await readSearchIndex();
  const renderedLinks = Object.entries(guidePages).flatMap(([path, Page]) => {
    const html = renderToStaticMarkup(<Page />);
    return [...html.matchAll(/<section\b[^>]*\sid="([^"]+)"/g)].map(([, id]) => `${path}#${id}`);
  });

  expect(entries.map(({ href }) => href).sort()).toEqual(renderedLinks.sort());
});

it("finds status setup and distinguishes task and organization permissions", async () => {
  const entries = await readSearchIndex();

  for (const query of ["status setup", "How do I set up a status?"]) {
    expect(searchDocs(entries, query)[0]?.href).toBe("/docs/project-settings#statuses");
  }

  const permissions = searchDocs(entries, "permissions").map(({ href }) => href);
  expect(permissions).toEqual(expect.arrayContaining([
    "/docs/project-settings#task-editing",
    "/docs/organization-settings#roles",
  ]));
});

it("searches section prose and requires each significant word to match", async () => {
  const entries = await readSearchIndex();

  expect(searchDocs(entries, "SMTP_HOST")[0]?.href).toBe("/docs/integrations#email-setup");
  expect(searchDocs(entries, "status xyzzywombat")).toEqual([]);
  expect(searchDocs(entries, "  ")).toEqual([]);
});

it("keeps previously shared MCP section links available", () => {
  const anchors = ["codex-desktop", "codex-cli", "claude", "claude-code", "claude-local", "verify", "task-tools"];
  const html = renderToStaticMarkup(<McpGuide />);

  expect(legacyMcpSections).toEqual(anchors);
  for (const anchor of anchors) expect(html).toContain(`id="${anchor}"`);
});

it("uses labeled screenshots to illustrate product controls", () => {
  const examples = [
    [WorkItemsPage, "task-detail"],
    [ViewsPage, "board"],
    [ViewsPage, "task-filters"],
    [ProjectSettingsPage, "project-statuses"],
    [OrganizationSettingsPage, "organization-members"],
  ] as const;

  for (const [Page, name] of examples) {
    const html = renderToStaticMarkup(<Page />);
    const image = [...html.matchAll(/<img\b[^>]*>/g)].find(([tag]) => tag.includes(`src="/docs-media/${name}.webp"`));
    expect(image?.[0], `${name} screenshot`).toMatch(/\balt="[^"]+"/);
  }
});

it("renders each supported client setup and connection verification", () => {
  const html = renderToStaticMarkup(<McpGuide />);
  const headings = [...html.matchAll(/<h[12]\b[^>]*>(.*?)<\/h[12]>/g)].map(
    ([, heading]) => heading.replace(/<[^>]*>/g, ""),
  );

  expect(headings).toEqual(expect.arrayContaining([
    "Connect to TasksHQ with MCP",
    "Codex desktop",
    "Codex CLI",
    "Claude web and desktop",
    "Claude Code",
    "Claude Desktop local config",
    "Verify your connection",
  ]));
  expect(html).toContain("https://mcp.example.test/mcp");
  expect(html).toContain("codex mcp add taskshq --url https://mcp.example.test/mcp");
  expect(html).toContain("codex mcp login taskshq");
  expect(html).toContain("claude mcp add --transport http --scope user taskshq https://mcp.example.test/mcp");
  expect(html).toContain("Use TasksHQ to list my projects.");
});

it("provides a valid Claude Desktop configuration for the TasksHQ bridge", () => {
  const html = renderToStaticMarkup(<McpGuide />);
  const codeBlocks = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)].map(
    ([, block]) => block.replace(/<[^>]*>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
  const configBlock = codeBlocks.find((block) => block.includes('"mcpServers"'));

  expect(configBlock).toBeDefined();
  expect(JSON.parse(configBlock!).mcpServers.taskshq).toEqual({
    command: "/opt/homebrew/bin/npx",
    args: ["-y", "mcp-remote", "https://mcp.example.test/mcp", "45263", "--host", "localhost"],
  });
  expect(html).toContain("claude_desktop_config.json");
});
