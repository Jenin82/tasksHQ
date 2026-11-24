import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import { createTeam } from "./helpers";
import { eq } from "drizzle-orm";
import { orgMember, user } from "@tasks/core/schema";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({ id: actor.id, name: actor.id, email: `${actor.id}@redirects.test` });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const OldTeamSettings = (await import("@/app/[team]/(team)/settings/team/page")).default;
const OldYourTeam = (await import("@/app/[team]/(team)/settings/your-team/page")).default;
const OldReportingLines = (await import("@/app/[team]/(team)/settings/reporting-lines/page")).default;
const OldYourTime = (await import("@/app/[team]/(team)/settings/your-time/page")).default;
const OldTeamTime = (await import("@/app/[team]/(team)/settings/time/page")).default;
const { GET: oldTeamTimeExport } = await import("@/app/[team]/(team)/settings/time/export/route");

const db = drizzle(env.DB);
const now = new Date();
await db.insert(user).values(["rr-owner", "rr-outsider"].map((id) => ({
  id, name: id, email: `${id}@redirects.test`, createdAt: now, updatedAt: now,
})));
await createTeam({ db, actorUserId: "rr-owner", source: "web" }, { slug: "rr-acme", name: "RR Acme" });

const redirectTo = (path: string) => ({
  digest: expect.stringMatching(`^NEXT_REDIRECT;[^;]*;${encodeURIComponent(path)}(;|$)`),
});
const notFound = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

type Page = (props: { params: Promise<{ team: string }>; searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
const pages: [string, Page, Record<string, string>, string][] = [
  ["settings/team", OldTeamSettings, {}, "/settings/time"],
  ["settings/your-team", OldYourTeam, {}, "/rr-acme/settings/your-tasks"],
  ["settings/reporting-lines", OldReportingLines, {}, "/settings/time"],
  ["settings/your-time", OldYourTime, { week: "2026-03-02", person: "x" }, "/settings/time?people=rr-owner&week=2026-03-02"],
  // A legacy person stays strict; without one the old page showed the whole team.
  ["settings/time", OldTeamTime, { month: "2026-03", person: "rr-owner", team: "other", extra: "1" },
    "/settings/time?team=rr-acme&month=2026-03&person=rr-owner"],
  ["settings/time (whole team)", OldTeamTime, { week: "2026-03-02", people: "x" }, "/settings/time?team=rr-acme&week=2026-03-02&people=all"],
];
const render = (page: Page, team: string, query: Record<string, string> = {}) =>
  page({ params: Promise.resolve({ team }), searchParams: Promise.resolve(query) });

it.each(pages)("old %s redirects members to the org page, keeping known params", async (_, page, query, path) => {
  actor.id = "rr-owner";
  await expect(render(page, "rr-acme", query)).rejects.toMatchObject(redirectTo(path));
});

it.each(pages)("old %s 404s for non-members and unknown teams", async (_, page) => {
  actor.id = "rr-outsider";
  await expect(render(page, "rr-acme")).rejects.toMatchObject(notFound);
  actor.id = "rr-owner";
  await expect(render(page, "//evil.example")).rejects.toMatchObject(notFound);
});

it.each([OldTeamSettings, OldReportingLines])("old reporting-line links take org admins to the org page", async (page) => {
  actor.id = "rr-owner";
  await db.update(orgMember).set({ role: "admin" }).where(eq(orgMember.userId, "rr-owner"));
  try {
    await expect(render(page, "rr-acme")).rejects.toMatchObject(redirectTo("/settings/reporting-lines"));
  } finally {
    await db.update(orgMember).set({ role: "member" }).where(eq(orgMember.userId, "rr-owner"));
  }
});

it("redirects the old CSV export to the org export with a 307, access-checked", async () => {
  const get = (team: string, query: string) =>
    oldTeamTimeExport(new Request(`http://local/${team}/settings/time/export?${query}`), { params: Promise.resolve({ team }) });
  actor.id = "rr-owner";
  const response = await get("rr-acme", "week=2026-03-02&person=rr-owner&team=x");
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("http://local/settings/time/export?team=rr-acme&week=2026-03-02&person=rr-owner");
  expect((await get("rr-acme", "week=2026-03-02")).headers.get("location"))
    .toBe("http://local/settings/time/export?team=rr-acme&week=2026-03-02&people=all");
  await expect(get("//evil.example", "week=2026-03-02")).rejects.toMatchObject(notFound);
  actor.id = "rr-outsider";
  await expect(get("rr-acme", "week=2026-03-02")).rejects.toMatchObject(notFound);
});
