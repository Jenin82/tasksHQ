import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { beforeEach, expect, it, vi } from "vitest";
import { createProject, createTask, listTimeReportEntries, OutOfReportScope, startTimer } from "@tasks/core/domain";
import { orgMember, teamMember, timeEntry, user } from "@tasks/core/schema";
import { RunningTimerChip } from "@/components/time-tracking";
import { NO_ERROR } from "@/lib/action-result";
import { createTeam } from "./helpers";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({ id: actor.id, name: actor.id, email: `${actor.id}@ot.test`, emailVerified: true });
  return { getUser: async () => current(), requireUser: async () => current() };
});
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", async (importOriginal) => ({ ...await importOriginal<object>(), revalidatePath }));
// The Time page's filters are client components; the pool renders against the react-server shims.
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ push: () => {} }),
}));
const jar = vi.hoisted(() => ({ filter: undefined as string | undefined }));
vi.mock("next/headers", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/headers")>(),
  cookies: async () => ({
    get: (name: string) => name === "tasks-time-filter" && jar.filter !== undefined ? { name, value: jar.filter } : undefined,
  }),
}));

const Layout = (await import("@/app/settings/layout")).default;
const SettingsIndex = (await import("@/app/settings/page")).default;
const YourTimeRedirect = (await import("@/app/settings/your-time/page")).default;
const TimePage = (await import("@/app/settings/time/page")).default;
const { PeopleFilter, SaveTimeFilter } = await import("@/app/settings/time/people-filter");
const { MAX_PEOPLE } = await import("@/app/settings/time/filter-cookie");
const ReportingLinesPage = (await import("@/app/settings/reporting-lines/page")).default;
const { setReportingLeadAction } = await import("@/app/settings/reporting-lines/actions");
const { stopTimerAction } = await import("@/app/time-actions");
const taskTimeSource = (await import("@/app/[team]/[project]/[task]/task-time.tsx?raw")).default;

const db = drizzle(env.DB);
const now = new Date();
const U = {
  owner: "ot-owner", // admin of all three teams
  member: "ot-member", // Alpha and Beta, with an old entry in Gamma
  teamAdmin: "ot-team-admin", // admin of Alpha and Beta
  lead: "ot-lead", // Alpha
  betaOnly: "ot-beta-only", // Beta
  plain: "ot-plain", // Gamma
  orgAdmin: "ot-org-admin", // org admin in no team, with an entry in Gamma
};
await db.insert(user).values(Object.values(U).map((id) => ({
  id, name: id.toUpperCase(), email: `${id}@ot.test`, emailVerified: true, createdAt: now, updatedAt: now,
})));
const ctx = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });
const alpha = await createTeam(ctx(U.owner), { slug: "ot-a", name: "Alpha" });
const beta = await createTeam(ctx(U.owner), { slug: "ot-b", name: "Beta" });
const gamma = await createTeam(ctx(U.owner), { slug: "ot-c", name: "Gamma" });
const join = (teamId: string, userId: string, role: "member" | "admin" = "member") => ({ teamId, userId, role, createdAt: now });
await db.insert(teamMember).values([
  join(alpha.id, U.member), join(beta.id, U.member),
  join(alpha.id, U.teamAdmin, "admin"), join(beta.id, U.teamAdmin, "admin"),
  join(alpha.id, U.lead), join(beta.id, U.betaOnly), join(gamma.id, U.plain),
]);
await db.insert(orgMember).values({ userId: U.orgAdmin, role: "admin", createdAt: now });

// The same project slug in Alpha and Beta.
const projectA = await createProject(ctx(U.owner), { teamId: alpha.id, slug: "ot-same", key: "OTA", name: "Same" });
const projectB = await createProject(ctx(U.owner), { teamId: beta.id, slug: "ot-same", key: "OTB", name: "Same" });
const projectC = await createProject(ctx(U.owner), { teamId: gamma.id, slug: "ot-gamma", key: "OTC", name: "Gamma work" });
const taskA = await createTask(ctx(U.owner), { projectId: projectA.id, title: "Alpha task" });
const taskB = await createTask(ctx(U.owner), { projectId: projectB.id, title: "Beta task" });
const taskC = await createTask(ctx(U.owner), { projectId: projectC.id, title: "Gamma task" });

// Tuesday of a fixed week, 2025-06-02 to 2025-06-08 (UTC).
const WEEK = "week=2025-06-02";
const AT = Date.UTC(2025, 5, 3, 10);
async function log(userId: string, t: { id: string }, teamId: string) {
  await db.insert(timeEntry).values({
    id: crypto.randomUUID(), teamId, taskId: t.id, userId, startedAt: new Date(AT), endedAt: new Date(AT + 3_600_000),
    note: null, kind: "manual", source: "web", createdAt: now, updatedAt: now,
  });
}
await log(U.member, taskA, alpha.id);
await log(U.member, taskB, beta.id);
await log(U.member, taskC, gamma.id); // a team they no longer belong to
await log(U.orgAdmin, taskC, gamma.id); // opened only through the org role
await log(U.plain, taskC, gamma.id);

const digest = (code: number) => ({ digest: `NEXT_HTTP_ERROR_FALLBACK;${code}` });
const query = (value: string) => Object.fromEntries(new URLSearchParams(value));

async function timeElement(userId: string, search = WEEK, cookie?: string) {
  actor.id = userId;
  jar.filter = cookie;
  return TimePage({ searchParams: Promise.resolve(query(search)) });
}
const time = async (userId: string, search = WEEK, cookie?: string) => renderToStaticMarkup(await timeElement(userId, search, cookie));
const saved = async (userId: string, search = WEEK, cookie?: string) =>
  (findElement(await timeElement(userId, search, cookie), SaveTimeFilter) as ReactElement<{ value: string | null }>).props.value;
const exportHref = (html: string) => html.match(/href="(\/settings\/time\/export\?[^"]*)"/)?.[1].replaceAll("&amp;", "&");

beforeEach(() => revalidatePath.mockClear());

it("defaults to the viewer without a cookie, with their own entries to edit in a week", async () => {
  const html = await time(U.member);
  expect(html).toContain("<h1 class=\"text-2xl\">Time</h1>");
  expect(html).toContain('aria-label="Remove OT-MEMBER"');
  expect(exportHref(html)).toBe(`/settings/time/export?week=2025-06-02&people=${U.member}`);
  expect(html).toContain('href="/ot-a/ot-same/OTA-1"');
  expect(html).toContain('href="/ot-b/ot-same/OTB-1"');
  // Gamma is a team they left.
  expect(html).not.toContain("Gamma task");
  expect(html).toContain("Your entries");
  expect(html.match(/aria-label="Edit time entry"/g)).toHaveLength(2);
  expect(html).toContain("Add time");
  // Nothing chosen in the URL, so nothing to remember.
  expect(await saved(U.member)).toBeNull();
});

it("shows entries in a team opened only through the org role without edit controls or Add time", async () => {
  const html = await time(U.orgAdmin);
  expect(html).toContain('href="/ot-c/ot-gamma/OTC-1"');
  expect(html).toContain("Your entries");
  expect(html).not.toContain("Edit time entry");
  expect(html).not.toContain("Delete time entry");
  expect(html).not.toContain("Add time");
});

it("shows everyone in scope for people=all, without chips or own entries", async () => {
  const html = await time(U.teamAdmin, `${WEEK}&people=all`);
  expect(html).toContain(">Everyone<");
  expect(html).not.toContain('aria-label="Remove');
  expect(html).toContain(`${U.member}@ot.test`);
  expect(html).not.toContain(`${U.plain}@ot.test`);
  expect(html).not.toContain("Your entries");
  expect(await saved(U.teamAdmin, `${WEEK}&people=all`)).toBe("people=all");
  // A plain member's everyone is just themselves.
  const plain = await time(U.plain, `${WEEK}&people=all`);
  expect(plain).toContain(`${U.plain}@ot.test`);
  expect(plain).not.toContain(`${U.member}@ot.test`);
});

it("shows several selected people in the grid, with own entries only when you are one of them in a week", async () => {
  const both = `people=${U.member},${U.plain}`;
  const html = await time(U.owner, `${WEEK}&${both}`);
  expect(html).toContain('aria-label="Remove OT-MEMBER"');
  expect(html).toContain('aria-label="Remove OT-PLAIN"');
  expect(html).toContain(`${U.member}@ot.test`);
  expect(html).toContain(`${U.plain}@ot.test`);
  expect(html).not.toContain(`${U.orgAdmin}@ot.test`);
  expect(html).not.toContain("Your entries");
  // Each row opens that person alone, keeping the period.
  expect(html).toContain(`href="/settings/time?week=2025-06-02&amp;people=${U.plain}"`);
  expect(await time(U.owner, `${WEEK}&people=${U.owner},${U.member}`)).toContain("Your entries");
  expect(await time(U.owner, `month=2025-06&people=${U.owner},${U.member}`)).not.toContain("Your entries");
});

it("drops people outside the viewer's scope, falling back to the viewer with a notice when none is left", async () => {
  const some = await time(U.plain, `${WEEK}&people=${U.member},${U.plain}`);
  expect(some).toContain('aria-label="Remove OT-PLAIN"');
  expect(some).not.toContain('aria-label="Remove OT-MEMBER"');
  expect(some).not.toContain("report scope, so this shows your time");
  const none = await time(U.plain, `${WEEK}&people=${U.member},nobody`);
  expect(none).toContain("None of the chosen people are in your report scope, so this shows your time.");
  expect(none).toContain(`${U.plain}@ot.test`);
  expect(none).not.toContain(`${U.member}@ot.test`);
  expect(exportHref(none)).toBe(`/settings/time/export?week=2025-06-02&people=${U.plain}`);
});

it("heals a stale saved filter by saving the cleaned one", async () => {
  // A saved team the viewer can no longer open.
  expect(await saved(U.plain, WEEK, "people=all&team=ot-a")).toBe("people=all");
  // Saved people all out of scope, so it falls back to the viewer.
  expect(await saved(U.plain, WEEK, `people=${U.member}`)).toBe(`people=${U.plain}`);
  expect(await saved(U.plain, WEEK, `people=${U.plain}&team=ot-c`)).toBeNull();
});

it("caps the selection at MAX_PEOPLE, with a notice when the URL asks for more", async () => {
  const many = Array.from({ length: MAX_PEOPLE }, (_, index) => `ot-ghost-${index}`);
  const over = await time(U.plain, `${WEEK}&people=${[U.plain, ...many].join(",")}`);
  expect(over).toContain(`Only the first ${MAX_PEOPLE} chosen people are shown.`);
  expect(over).toContain('aria-label="Remove OT-PLAIN"');
  expect(await time(U.plain, `${WEEK}&people=${U.plain}`)).not.toContain("Only the first");
  const filter = (selected: string[]) => renderToStaticMarkup(
    <PeopleFilter path="/settings/time" base={WEEK} people={[]} selected={selected} />,
  );
  expect(filter(many)).toContain(`Up to ${MAX_PEOPLE} people`);
  expect(filter(many.slice(1))).not.toContain(`Up to ${MAX_PEOPLE} people`);
});

it("treats a legacy person link as one strict person", async () => {
  await expect(time(U.plain, `${WEEK}&person=${U.member}`)).rejects.toMatchObject(digest(404));
  expect(exportHref(await time(U.owner, `${WEEK}&person=${U.member}`))).toBe(`/settings/time/export?week=2025-06-02&people=${U.member}`);
});

it("restores the saved filter only when the URL has none", async () => {
  const cookie = `people=all&team=ot-b`;
  const restored = await time(U.teamAdmin, WEEK, cookie);
  expect(restored).toContain(`${U.member}@ot.test`);
  expect(restored).toContain(">Everyone<");
  expect(exportHref(restored)).toBe("/settings/time/export?week=2025-06-02&team=ot-b&people=all");
  expect(await saved(U.teamAdmin, WEEK, cookie)).toBeNull();
  // The URL wins, and is what gets saved next.
  const explicit = await time(U.teamAdmin, `${WEEK}&people=${U.teamAdmin}`, cookie);
  expect(exportHref(explicit)).toBe(`/settings/time/export?week=2025-06-02&people=${U.teamAdmin}`);
  expect(await saved(U.teamAdmin, `${WEEK}&people=${U.teamAdmin}`, cookie)).toBe(`people=${U.teamAdmin}`);
  expect(await saved(U.teamAdmin, `${WEEK}&team=ot-b`, cookie)).toBe(`people=${U.teamAdmin}&team=ot-b`);
});

it("filters by a team the viewer can open, keeping it in its links, and 404s for an explicit other team", async () => {
  const html = await time(U.teamAdmin, `${WEEK}&team=ot-b&people=all`);
  expect(html).toContain(`${U.member}@ot.test`);
  expect(html).not.toContain(`${U.lead}@ot.test`);
  expect(exportHref(html)).toBe("/settings/time/export?week=2025-06-02&team=ot-b&people=all");
  expect(html).toContain('href="/settings/time?week=2025-05-26&amp;team=ot-b&amp;people=all"');
  expect(html).toContain(`href="/settings/time?week=2025-06-02&amp;team=ot-b&amp;people=${U.member}"`);
  await expect(time(U.plain, `${WEEK}&team=ot-a`)).rejects.toMatchObject(digest(404));
  await expect(time(U.plain, `${WEEK}&team=${encodeURIComponent("//evil.example")}`)).rejects.toMatchObject(digest(404));
  // A saved team the viewer can no longer open is dropped.
  const stale = await time(U.plain, WEEK, "people=all&team=ot-a");
  expect(exportHref(stale)).toBe("/settings/time/export?week=2025-06-02&people=all");
  // With one team, the filter still shows while active so it can be cleared.
  expect(await time(U.plain)).not.toContain('aria-label="Team"');
  expect(await time(U.plain, `${WEEK}&team=ot-c`)).toContain('aria-label="Team"');
});

it("groups a person's time by project ID, so the same slug in two teams stays apart", async () => {
  const html = await time(U.owner, `${WEEK}&people=${U.member}`);
  const rows = [...html.matchAll(/<th scope="row" class="px-3 py-2 text-left font-semibold">Same <span[^>]*>(\w+)<\/span>/g)].map(([, team]) => team);
  expect(rows).toEqual(["Alpha", "Beta"]);
  expect(html).toContain('href="/ot-a/ot-same/OTA-1"');
  expect(html).toContain('href="/ot-b/ot-same/OTB-1"');
});

it("sends Your Time and the task panel's link to the viewer's own time", async () => {
  actor.id = U.member;
  await expect(YourTimeRedirect({ searchParams: Promise.resolve({ week: "2025-06-02" }) }))
    .rejects.toMatchObject({ digest: expect.stringContaining(encodeURIComponent(`/settings/time?people=${U.member}&week=2025-06-02`)) });
  expect(taskTimeSource).toContain("href={`/settings/time?${new URLSearchParams({ people: data.viewerId })}`}");
  expect(taskTimeSource).toContain("See all in Time");
  expect(taskTimeSource).not.toContain("your-time");
});

it("refuses the Reporting lines page to everyone but org owners and admins, real team admins included", async () => {
  for (const id of [U.plain, U.teamAdmin]) {
    actor.id = id;
    await expect(ReportingLinesPage()).rejects.toMatchObject(digest(403));
  }
});

it("shows an org admin every org member", async () => {
  actor.id = U.orgAdmin;
  const element = await ReportingLinesPage() as ReactElement<{ people: { userId: string }[] }>;
  expect(element.props.people.map(({ userId }) => userId).sort())
    .toEqual(expect.arrayContaining(Object.values(U).sort()));
});

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

it("saves reporting lines through the domain, showing refusals inline and refreshing the settings layout", async () => {
  actor.id = U.orgAdmin;
  expect(await setReportingLeadAction(null, NO_ERROR, form({ userId: U.member, leadUserId: U.lead }))).toEqual(NO_ERROR);
  expect(revalidatePath).toHaveBeenCalledWith("/settings", "layout");

  actor.id = U.teamAdmin;
  const refused = await setReportingLeadAction(null, NO_ERROR, form({ userId: U.lead, leadUserId: U.betaOnly }));
  expect(refused.error).toBe("You cannot manage reporting lines.");

  // The lead can now pick their report on the Time page.
  expect(await time(U.lead, `${WEEK}&people=${U.member}`)).toContain('aria-label="Remove OT-MEMBER"');
  actor.id = U.lead;
  const layout = await Layout({ children: null }) as ReactElement<{ org: object }>;
  expect(layout.props.org).toEqual({ canManage: false });
});

it("keeps a lead whose report shares no team with them out of that report's time", async () => {
  actor.id = U.orgAdmin;
  // Plain is only in Gamma, Beta-only only in Beta.
  expect(await setReportingLeadAction(null, NO_ERROR, form({ userId: U.plain, leadUserId: U.betaOnly }))).toEqual(NO_ERROR);
  await expect(listTimeReportEntries(ctx(U.betaOnly), {
    userId: U.plain, from: new Date(AT - 86_400_000), to: new Date(AT + 86_400_000),
  })).rejects.toBeInstanceOf(OutOfReportScope);
  await expect(time(U.betaOnly, `${WEEK}&person=${U.plain}`)).rejects.toMatchObject(digest(404));
  expect(await time(U.betaOnly, `${WEEK}&people=${U.plain}`)).toContain("so this shows your time");
});

function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  if (Array.isArray(node)) return node.map((child) => findElement(child, type)).find(Boolean);
  if (!isValidElement(node)) return undefined;
  if (node.type === type) return node;
  return Object.values(node.props as Record<string, ReactNode>).map((value) => findElement(value, type)).find(Boolean);
}

it("puts the running timer chip in the org layout header", async () => {
  actor.id = U.plain;
  const before = await Layout({ children: null }) as ReactElement<{ header: ReactNode; org: object }>;
  expect(findElement(before.props.header, RunningTimerChip)).toBeUndefined();
  expect(before.props.org).toEqual({ canManage: false });

  await startTimer(ctx(U.plain), { taskId: taskC.id, projectId: projectC.id });
  const after = await Layout({ children: null }) as typeof before;
  const chip = findElement(after.props.header, RunningTimerChip) as ReactElement<{ timer: { teamSlug: string; key: string } }>;
  expect(chip.props.timer).toMatchObject({ teamSlug: "ot-c", key: "OTC-1" });

  // Stopping from the org pages refreshes their layout as well as every team's.
  expect(await stopTimerAction()).toEqual(NO_ERROR);
  expect(revalidatePath).toHaveBeenCalledWith("/settings", "layout");
});

it("sends members without org admin rights from /settings to Time", async () => {
  actor.id = U.plain;
  await expect(SettingsIndex()).rejects.toMatchObject({ digest: expect.stringContaining(encodeURIComponent("/settings/time")) });
});
