import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";

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

function render(params: Record<string, string>, projectHref = (base: string) => base) {
  route.params = params;
  return renderToStaticMarkup(
    <ProjectViewHref.Provider value={projectHref}>
      <TopBar
        org={{ slug: "acme", name: "Acme Corp" }}
        role="owner"
        orgs={[{ slug: "acme", name: "Acme Corp" }]}
        projects={[{ slug: "web", name: "Website", key: "WEB" }]}
        user={{ name: "Ada Lovelace", email: "ada@example.test" }}
      />
    </ProjectViewHref.Provider>,
  );
}

it("renders the org and project crumbs on a project route", () => {
  const html = render({ org: "acme", project: "web" });

  expect(html).toContain("Acme Corp");
  expect(html).toContain(">owner<");
  expect(html).toContain("Website");
  expect(html).toContain(">WEB<");
  expect(html).toContain(">AL<");
});

it("links the project name to its saved view", () => {
  const html = render({ org: "acme", project: "web" }, (base) => `${base}/table`);

  expect(html).toContain('href="/acme/web/table"');
  expect(html).not.toContain('href="/acme/web"');
  expect(html).not.toContain('href="/acme"');
});

it("puts the organization name and chevron in one popup button", () => {
  const html = render({ org: "acme", project: "web" });
  const trigger = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].find(([, attributes]) =>
    attributes.includes('aria-label="Switch organization: Acme Corp"'),
  );

  expect(trigger?.[1]).toContain('aria-haspopup="dialog"');
  expect(trigger?.[2]).toContain(">Acme Corp<");
  expect(trigger?.[2]).toContain("<svg");
});

it("links the project name and opens its switcher from the icon", () => {
  const href = "/acme/web";
  const name = "Website";
  const label = "Switch project";
  const html = render({ org: "acme", project: "web" });
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
  const html = render({ org: "acme" });

  expect(html).toContain("Switch to dark theme");
  expect(html).toContain("Switch to light theme");
  expect(html.indexOf("Switch to light theme")).toBeLessThan(
    html.indexOf('aria-label="Account"'),
  );
});

it("renders only the org crumb off a project route", () => {
  const html = render({ org: "acme" });

  expect(html).toContain("Acme Corp");
  expect(html).not.toContain("Website");
  expect(html).not.toContain("WEB");
});

it.each([{ org: "acme" }, { org: "acme", project: "web" }] as Record<string, string>[])(
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
  const html = render({ org: "acme", project: "secret" });

  expect(html).not.toContain("secret");
  expect(html).not.toContain("Website");
});

// The switcher's list is closed in static markup, so this reads the props
// TopBar hands its org switcher: choosing an org lands on its project page
// (`/[org]`, §26), never straight on a board.
it("points every org in the switcher at exactly /[org]", () => {
  route.params = { org: "acme", project: "web" };
  const orgs = [
    { slug: "acme", name: "Acme Corp" },
    { slug: "globex", name: "Globex" },
  ];
  const tree = TopBar({
    org: orgs[0],
    role: "owner",
    orgs,
    projects: [{ slug: "web", name: "Website", key: "WEB" }],
    user: { name: "Ada Lovelace", email: "ada@example.test" },
  }) as React.ReactElement<{ children: React.ReactNode }>;
  const switcher = (
    [tree.props.children].flat(2) as React.ReactElement<{
      label?: string;
      items?: { href: string }[];
    }>[]
  ).find((child) => child?.props?.label === "Switch organization");

  expect(switcher?.props.items?.map((i) => i.href)).toEqual(["/acme", "/globex"]);
});

it("links nowhere into org settings", () => {
  expect(render({ org: "acme", project: "web" })).not.toContain("settings/members");
});
