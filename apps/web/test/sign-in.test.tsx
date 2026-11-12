import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";

// Same seam as test/states.test.tsx: no session, so `/` takes the signed-out
// branch.
vi.mock("@/lib/session", () => ({ getUser: async () => null }));

const Home = (await import("@/app/page")).default;
const html = renderToStaticMarkup(await Home());
const text = html.replace(/<[^>]+>/g, "");

it("renders the headline, the single CTA and the theme button", () => {
  expect(text).toContain("Work, trackedby people and agents.");
  expect(text).toContain("Continue with Google");
  expect(text).not.toContain("Continue with email");
  // Both names are rendered; the `.dark` class shows the one that applies.
  expect(html).toContain(
    '<span class="sr-only dark:hidden">Switch to dark theme</span>',
  );
  expect(html).toContain(
    '<span class="sr-only hidden dark:inline">Switch to light theme</span>',
  );
});

it("keeps the page to one blue element: the CTA, no decorative colour", () => {
  expect(html).not.toContain("#0063e1");
  // Any other `bg-primary` would be a second blue fill on the page.
  const classes = [...html.matchAll(/ class="([^"]*)"/g)].flatMap((m) =>
    m[1].split(" "),
  );
  expect(classes.filter((c) => c === "bg-primary")).toHaveLength(1);
});

it("resolves every svg reference on the page, ids unique", () => {
  const all = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(all).size).toBe(all.length);
  for (const [, ref] of html.matchAll(/(?:href="#|url\(#)([^")]+)/g)) {
    expect(all).toContain(ref);
  }
});
