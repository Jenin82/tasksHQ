import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import { createTeam } from "./helpers";
import { user } from "@tasks/core/schema";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({ id: actor.id, name: actor.id, email: `${actor.id}@redirects.test` });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const OldReportingLines = (await import("@/app/[team]/(team)/settings/team/page")).default;
const OldYourTeam = (await import("@/app/[team]/(team)/settings/your-team/page")).default;

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

it.each([
  [OldReportingLines, "/rr-acme/settings/reporting-lines"],
  [OldYourTeam, "/rr-acme/settings/your-reports"],
])("old settings paths redirect members to the renamed page", async (Page, path) => {
  actor.id = "rr-owner";
  await expect(Page({ params: Promise.resolve({ team: "rr-acme" }) })).rejects.toMatchObject(redirectTo(path));
});

it.each([OldReportingLines, OldYourTeam])("old settings paths 404 for non-members and unknown teams", async (Page) => {
  actor.id = "rr-outsider";
  await expect(Page({ params: Promise.resolve({ team: "rr-acme" }) })).rejects.toMatchObject(notFound);
  await expect(Page({ params: Promise.resolve({ team: "//evil.example" }) })).rejects.toMatchObject(notFound);
});
