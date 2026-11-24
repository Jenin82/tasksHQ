import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import type { RunningTimer } from "@tasks/core/domain";

// The bar reads the project slug from the URL; the pool has no router.
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
vi.mock("next/navigation", () => ({
  useParams: () => route.params,
  usePathname: () => "/",
  useRouter: () => ({ push: () => {} }),
}));
// Sign-out is only ever called from a click; no client is needed to render.
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));

const { TopBar } = await import("@/components/top-bar");
const { ProjectViewHref } = await import("@/components/project-view-link");

function render(
  params: Record<string, string>,
  projectHref = (base: string) => base,
  runningTimer?: RunningTimer,
) {
  route.params = params;
  return renderToStaticMarkup(
    <ProjectViewHref.Provider value={projectHref}>
      <TopBar
        team={{ slug: "acme", name: "Acme Corp" }}
        role="Super admin"
        projects={[{ slug: "web", name: "Website", key: "WEB" }]}
        user={{ name: "Ada Lovelace", email: "ada@example.test" }}
        runningTimer={runningTimer}
      />
    </ProjectViewHref.Provider>,
  );
}

it("renders the team and project crumbs on a project route", () => {
  const html = render({ team: "acme", project: "web" });

  expect(html).toContain("Acme Corp");
  expect(html).toContain(">Super admin<");
  expect(html).toContain("Website");
  expect(html).toContain(">WEB<");
  expect(html).toContain(">AL<");
});

it("links the project name to its saved view", () => {
  const html = render({ team: "acme", project: "web" }, (base) => `${base}/table`);

  expect(html).toContain('href="/acme/web/table"');
  expect(html).not.toContain('href="/acme/web"');
});

it("links the team crumb to /[team] without a switcher", () => {
  const html = render({ team: "acme", project: "web" });
  const link = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].find(([, attributes]) =>
    attributes.includes('href="/acme"'),
  );

  expect(link?.[2]).toContain(">Acme Corp<");
  expect(link?.[2]).toContain(">Super admin<");
  expect(html).not.toMatch(/<button\b[^>]*aria-label="[^"]*Switch team/);
});

it("links the project name and opens its switcher from the icon", () => {
  const href = "/acme/web";
  const name = "Website";
  const label = "Switch project";
  const html = render({ team: "acme", project: "web" });
  const link = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].find(([, attributes]) =>
    attributes.includes(`href="${href}"`),
  );
  expect(link?.[1]).not.toContain("aria-haspopup");
  expect(link?.[2]).toContain(`>${name}<`);

  const trigger = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].find(([, attributes]) =>
    attributes.includes(`aria-label="${label}"`),
  );
  expect(trigger?.[1]).toContain('aria-haspopup="dialog"');
  expect(trigger?.[2]).toMatch(/^<svg\b.*<\/svg>$/);
});

it("puts the theme button just left of the account trigger", () => {
  const html = render({ team: "acme" });

  expect(html).toContain("Switch to dark theme");
  expect(html).toContain("Switch to light theme");
  expect(html.indexOf("Switch to light theme")).toBeLessThan(
    html.indexOf('aria-label="Account"'),
  );
});

it("renders only the team crumb off a project route", () => {
  const html = render({ team: "acme" });

  expect(html).toContain("Acme Corp");
  expect(html).not.toContain("Website");
  expect(html).not.toContain("WEB");
});

it.each([{ team: "acme" }, { team: "acme", project: "web" }] as Record<string, string>[])(
  "links to public docs from the app header on %o",
  (params) => {
    const html = render(params);
    const link = [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].find(
      ([, attributes]) => attributes.includes('href="/docs"'),
    );

    expect(link?.[2]).toContain("Docs");
  },
);

it("ignores a project slug the server did not list", () => {
  const html = render({ team: "acme", project: "secret" });

  expect(html).not.toContain("secret");
  expect(html).not.toContain("Website");
});

it("links nowhere into team settings", () => {
  expect(render({ team: "acme", project: "web" })).not.toContain("settings/members");
});

it("renders the What's new button without a dot before storage is read", () => {
  const html = render({ team: "acme" });
  const trigger = [...html.matchAll(/<button\b([^>]*)>/g)].find(([, attributes]) =>
    attributes.includes(`aria-label="What&#x27;s new"`),
  );

  expect(trigger?.[1]).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain('data-slot="changelog-dot"');
  expect(html).not.toContain("unread updates");
});

it("hides What's new with Docs on narrow screens while a timer runs", () => {
  const timer: RunningTimer = {
    id: "entry",
    taskId: "task",
    key: "WEB-1",
    title: "Write copy",
    projectId: "project",
    projectSlug: "web",
    projectKey: "WEB",
    teamSlug: "acme",
    startedAt: new Date(),
    note: null,
  };
  const html = render({ team: "acme" }, undefined, timer);
  // Between the wrapper's opening tag and the theme button, which sits outside it.
  const start = html.indexOf('<div class="hidden lg:contents">');
  const wrapper = html.slice(start, html.indexOf("Switch to dark theme", start));

  expect(start).toBeGreaterThan(-1);
  expect(wrapper).toContain('href="/docs"');
  expect(wrapper).toContain("What&#x27;s new");
  expect(html.split("What&#x27;s new").length).toBe(2);
});
