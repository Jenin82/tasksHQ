import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it } from "vitest";
import { DEPTH } from "@/components/block-wordmark";
import { SiteFooter } from "@/components/site-footer";

// Every "#" in T, A, S, K, S, H, Q (5×7 bitmaps): 11 + 18 + 15 + 14 + 15 + 17 + 16.
const PIXELS = 106;

it("renders the mark, the current year and the block wordmark", () => {
  const html = renderToStaticMarkup(<SiteFooter />);
  const text = html.replace(/<[^>]+>/g, "");

  expect(text).toContain("TasksHQ");
  expect(text).toContain(`© ${new Date().getFullYear()} Jenin and TasksHQ contributors`);
  expect(html).toContain('href="https://jenin.dev"');
  expect(html.match(/<use /g)).toHaveLength(PIXELS * DEPTH);
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("max-w-[1200px]");
});
