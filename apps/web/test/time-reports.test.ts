import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";
import {
  createOrg,
  createProject,
  createTask,
  listTimeReportEntries,
  OutOfReportScope,
  overlapMs,
  removeOrgMember,
  setReportingLead,
  type TimeReportEntry,
} from "@tasks/core/domain";
import { orgMember, timeEntry, user } from "@tasks/core/schema";
import { clampEntries, csvDocument, csvField, parseReportRange } from "@/app/[org]/(org)/settings/time/range";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: actor.id, name: actor.id, email: `${actor.id}@tr.test` }),
}));
const { GET } = await import("@/app/[org]/(org)/settings/time/export/route");

const db = drizzle(env.DB);
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const notFound = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

let userSeq = 0;
async function makeUser(name?: string, timezone: string | null = null) {
  const id = `tr-user-${userSeq++}`;
  await db.insert(user).values({ id, name: name ?? id, email: `${id}@tr.test`, timezone });
  return id;
}
const ctx = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });

const ownerId = await makeUser();
const owner = ctx(ownerId);
const workspace = await createOrg(owner, { slug: "tr-space", name: "Reports" });
const otherWorkspace = await createOrg(owner, { slug: "tr-other", name: "Other" });

async function addMember(userId: string, orgId = workspace.id, role: "member" | "admin" = "member") {
  await db.insert(orgMember).values({ orgId, userId, role, createdAt: new Date() });
}
async function makeMember(role: "member" | "admin" = "member", orgIds = [workspace.id], name?: string, timezone?: string) {
  const id = await makeUser(name, timezone);
  for (const orgId of orgIds) await addMember(id, orgId, role);
  return id;
}

let projectSeq = 0;
async function makeTask(orgId = workspace.id, title = "Report me", name = "P") {
  const p = await createProject(owner, { orgId, slug: `tr-${projectSeq}`, key: `TR${projectSeq++}`, name });
  return createTask(owner, { projectId: p.id, title });
}
const task = await makeTask();
const otherTask = await makeTask(otherWorkspace.id);

async function log(userId: string, startedAt: number, endedAt: number | null, t = task, orgId = workspace.id, note: string | null = null) {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(timeEntry).values({
    id, orgId, taskId: t.id, userId, startedAt: new Date(startedAt), endedAt: endedAt === null ? null : new Date(endedAt), note,
    kind: endedAt === null ? "timer" : "manual", source: "web", createdAt: now, updatedAt: now,
  });
  return id;
}

// A fixed past week, Monday 2026-03-02 to Sunday 2026-03-08 (UTC).
const WEEK_FROM = new Date(Date.UTC(2026, 2, 2));
const WEEK_TO = new Date(Date.UTC(2026, 2, 9));
const AT = Date.UTC(2026, 2, 3, 10);
const week = { orgId: workspace.id, from: WEEK_FROM, to: WEEK_TO };
const ids = (entries: TimeReportEntry[]) => [...new Set(entries.map((e) => e.userId))].sort();

// Team: lead ← report ← indirect; plus a plain member, an admin and a leaver.
const adminId = await makeMember("admin");
const leadId = await makeMember();
const reportId = await makeMember();
const indirectId = await makeMember();
const memberId = await makeMember("member", [workspace.id, otherWorkspace.id]);
const leaverId = await makeMember();
await setReportingLead(owner, { orgId: workspace.id, userId: reportId, leadUserId: leadId });
await setReportingLead(owner, { orgId: workspace.id, userId: indirectId, leadUserId: reportId });
for (const id of [ownerId, adminId, leadId, reportId, indirectId, memberId, leaverId]) await log(id, AT, AT + HOUR_MS);
await log(memberId, AT, AT + HOUR_MS, otherTask, otherWorkspace.id);
await removeOrgMember(owner, { orgId: workspace.id, userId: leaverId });

describe("listTimeReportEntries scope", () => {
  it("shows a member only their own entries", async () => {
    expect(ids(await listTimeReportEntries(ctx(memberId), week))).toEqual([memberId]);
  });

  it("shows a lead themselves and direct reports, not indirect ones, until the line is removed", async () => {
    const lead = ctx(leadId);
    expect(ids(await listTimeReportEntries(lead, week))).toEqual([leadId, reportId].sort());
    await expect(listTimeReportEntries(lead, { ...week, userId: indirectId })).rejects.toBeInstanceOf(OutOfReportScope);

    const lead2 = await makeMember();
    const report2 = await makeMember();
    await log(report2, AT, AT + HOUR_MS);
    await setReportingLead(owner, { orgId: workspace.id, userId: report2, leadUserId: lead2 });
    expect(ids(await listTimeReportEntries(ctx(lead2), week))).toEqual([report2]);
    await setReportingLead(owner, { orgId: workspace.id, userId: report2, leadUserId: null });
    expect(await listTimeReportEntries(ctx(lead2), week)).toEqual([]);
    await expect(listTimeReportEntries(ctx(lead2), { ...week, userId: report2 })).rejects.toBeInstanceOf(OutOfReportScope);
  });

  it("shows owners and admins everyone, including a removed member, and never another org", async () => {
    const everyone = [ownerId, adminId, leadId, reportId, indirectId, memberId, leaverId].sort();
    for (const viewer of [ownerId, adminId]) {
      const entries = await listTimeReportEntries(ctx(viewer), week);
      expect(ids(entries)).toEqual(expect.arrayContaining(everyone));
      expect(entries.some((e) => e.taskId === otherTask.id)).toBe(false);
    }
    expect(ids(await listTimeReportEntries(ctx(adminId), { ...week, userId: leaverId }))).toEqual([leaverId]);
    const elsewhere = await listTimeReportEntries(ctx(memberId), { ...week, orgId: otherWorkspace.id });
    expect(elsewhere.map((e) => e.taskId)).toEqual([otherTask.id]);
  });

  it("throws for a userId outside scope and returns [] for an in-scope userId with no entries", async () => {
    await expect(listTimeReportEntries(ctx(memberId), { ...week, userId: ownerId })).rejects.toBeInstanceOf(OutOfReportScope);
    const later = { ...week, from: new Date(WEEK_TO.getTime() + 7 * DAY_MS), to: new Date(WEEK_TO.getTime() + 14 * DAY_MS) };
    expect(await listTimeReportEntries(ctx(leadId), { ...later, userId: reportId })).toEqual([]);
  });

  it("matches userEmail case-insensitively within scope and never throws", async () => {
    const email = `${memberId}@TR.TEST`.toUpperCase();
    expect(ids(await listTimeReportEntries(ctx(adminId), { ...week, userEmail: email }))).toEqual([memberId]);
    expect(await listTimeReportEntries(ctx(leadId), { ...week, userEmail: email })).toEqual([]);
    expect(await listTimeReportEntries(ctx(leadId), { ...week, userEmail: "nobody@tr.test" })).toEqual([]);
  });

  it("rejects an empty, inverted or over-93-day range", async () => {
    await expect(listTimeReportEntries(owner, { ...week, to: WEEK_FROM })).rejects.toThrow(/end after/);
    await expect(listTimeReportEntries(owner, { ...week, to: new Date(WEEK_FROM.getTime() - 1) })).rejects.toThrow(/end after/);
    await expect(listTimeReportEntries(owner, { ...week, to: new Date(WEEK_FROM.getTime() + 93 * DAY_MS + 1) })).rejects.toThrow(/93 days/);
    await expect(listTimeReportEntries(owner, { ...week, to: new Date(WEEK_FROM.getTime() + 93 * DAY_MS) })).resolves.toBeDefined();
  });
});

describe("running entries", () => {
  it("caps a running entry's end at start + 12h and marks it running", async () => {
    const userId = await makeMember();
    const now = Date.now();
    const startedAt = now - 13 * HOUR_MS;
    await log(userId, startedAt, null);
    const [entry] = await listTimeReportEntries(ctx(userId), { orgId: workspace.id, from: new Date(now - DAY_MS), to: new Date(now + HOUR_MS) });
    expect(entry.running).toBe(true);
    expect(entry.endedAt.getTime()).toBe(startedAt + 12 * HOUR_MS);
  });

  it("gives a stale running entry started 13–24h before the range zero overlap", async () => {
    const now = Date.now();
    const from = now - HOUR_MS;
    const to = now + HOUR_MS;
    for (const hoursBefore of [13, 24]) {
      const userId = await makeMember();
      await log(userId, from - hoursBefore * HOUR_MS, null);
      const entries = await listTimeReportEntries(ctx(userId), { orgId: workspace.id, from: new Date(from), to: new Date(to) });
      for (const e of entries) expect(overlapMs(e.startedAt.getTime(), e.endedAt.getTime(), from, to)).toBe(0);
    }
  });
});

it("overlapMs measures inside, partial and outside spans", () => {
  expect(overlapMs(20, 30, 10, 40)).toBe(10);
  expect(overlapMs(5, 15, 10, 40)).toBe(5);
  expect(overlapMs(35, 50, 10, 40)).toBe(5);
  expect(overlapMs(0, 100, 10, 40)).toBe(30);
  expect(overlapMs(0, 10, 10, 40)).toBe(0);
  expect(overlapMs(40, 50, 10, 40)).toBe(0);
});

describe("parseReportRange", () => {
  const now = Date.UTC(2026, 10, 18, 12); // Wednesday 2026-11-18

  it("starts a week on Monday and scans wide enough for every zone", () => {
    const range = parseReportRange({ week: "2026-03-04" }, "UTC", now);
    expect(range.view).toBe("week");
    expect(range.dates).toEqual(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"]);
    expect(range.end).toBe("2026-03-09");
    expect(range.from.getTime()).toBe(Date.UTC(2026, 2, 2) - 14 * HOUR_MS);
    expect(range.to.getTime()).toBe(Date.UTC(2026, 2, 9) + 12 * HOUR_MS);
  });

  it("falls back to the current week for an invalid date", () => {
    const range = parseReportRange({ week: "2026-02-31" }, "UTC", now);
    expect(range.first).toBe("2026-11-16");
    expect(range.isCurrent).toBe(true);
  });

  it("gives every day of a month", () => {
    const range = parseReportRange({ month: "2026-02" }, "UTC", now);
    expect(range.view).toBe("month");
    expect(range.dates).toHaveLength(28);
    expect([range.first, range.last, range.end]).toEqual(["2026-02-01", "2026-02-28", "2026-03-01"]);
    expect(range.from.getTime()).toBe(Date.UTC(2026, 1, 1) - 14 * HOUR_MS);
    expect(range.to.getTime()).toBe(Date.UTC(2026, 2, 1) + 12 * HOUR_MS);
  });
});

it("clampEntries counts a UTC+14 entry late on the week's last local day, seen from UTC−11", () => {
  const range = parseReportRange({ week: "2026-03-02" }, "Pacific/Pago_Pago");
  // 23:00–23:50 on Sunday 2026-03-08 in Kiritimati (UTC+14).
  const startedAt = new Date(Date.UTC(2026, 2, 8, 9));
  const endedAt = new Date(startedAt.getTime() + 50 * 60_000);
  const entry: TimeReportEntry = {
    id: "e", userId: "u", taskId: "t", startedAt, endedAt, note: null, kind: "manual", source: "web", autoStopped: false,
    userName: "Kiri", userEmail: "kiri@tr.test", userTimezone: "Pacific/Kiritimati", key: "TR-1", title: "T",
    projectName: "P", projectSlug: "p", running: false, edited: false,
  };
  expect(range.from.getTime()).toBeLessThanOrEqual(startedAt.getTime());
  expect(range.to.getTime()).toBeGreaterThanOrEqual(endedAt.getTime());
  const [clamped] = clampEntries([entry], range);
  expect(clamped.total).toBe(50 * 60_000);
  expect(clamped.days).toEqual([0, 0, 0, 0, 0, 0, 50 * 60_000]);
});

describe("CSV helpers", () => {
  it("quotes fields holding quotes, commas or newlines", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });

  it("guards formula characters only for text fields", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "＝", "＋", "－", "＠"]) {
      expect(csvField(`${lead}1`, true)).toBe(`'${lead}1`);
      expect(csvField(`${lead}1`)).toBe(`${lead}1`);
    }
    expect(csvField("\r1", true)).toBe('"\'\r1"');
    expect(csvField("\r1")).toBe('"\r1"');
    expect(csvField("a=b", true)).toBe("a=b");
  });

  it("starts the document with a BOM and ends rows with CRLF", () => {
    expect(csvDocument([["a", "b"], ["c", "d"]])).toBe("﻿a,b\r\nc,d\r\n");
  });
});

describe("export route", () => {
  const exportCsv = (slug = workspace.slug, query = "week=2026-03-02") =>
    GET(new Request(`http://local/${slug}/settings/time/export?${query}`), { params: Promise.resolve({ org: slug }) });
  const lines = async (response: Response) => (await response.text()).replace(/^﻿/, "").split("\r\n").filter(Boolean);

  it("gives an admin a CSV of everyone with download headers", async () => {
    actor.id = adminId;
    const response = await exportCsv();
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="tr-space-time-2026-03-02-to-2026-03-08.csv"');
    const [header, ...rows] = await lines(response);
    expect(header).toBe("date,person,email,project,task key,title,start,end,hours,running,note,kind,source,auto stopped,edited");
    for (const id of [ownerId, adminId, memberId, leaverId]) {
      expect(rows.some((row) => row.includes(`${id}@tr.test`))).toBe(true);
    }
    expect(rows.find((row) => row.includes(`${memberId}@tr.test`))).toMatch(/^2026-03-03,.*,1\.00,no,/);
  });

  it("gives a member only their own rows", async () => {
    actor.id = memberId;
    const [, ...rows] = await lines(await exportCsv());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`${memberId}@tr.test`);
  });

  it("splits an entry across the person's local midnight into one row per local day", async () => {
    // 22:30–01:30 in Kolkata (UTC+5:30), from Tuesday into Wednesday.
    const kolkataId = await makeMember("member", [workspace.id], undefined, "Asia/Kolkata");
    await log(kolkataId, Date.UTC(2026, 2, 3, 17), Date.UTC(2026, 2, 3, 20));
    actor.id = adminId;
    const [header, ...rows] = await lines(await exportCsv(workspace.slug, `week=2026-03-02&person=${kolkataId}`));
    const columns = header.split(",");
    const cells = rows.map((row) => Object.fromEntries(row.split(",").map((value, index) => [columns[index], value])));
    expect(cells.map((c) => [c.date, c.start, c.end, c.hours])).toEqual([
      ["2026-03-03", "2026-03-03T22:30:00+05:30", "2026-03-04T00:00:00+05:30", "1.50"],
      ["2026-03-04", "2026-03-04T00:00:00+05:30", "2026-03-04T01:30:00+05:30", "1.50"],
    ]);
    expect(cells.reduce((sum, c) => sum + Number(c.hours), 0)).toBe(3);
  });

  it("guards formula-leading text and quotes values with commas", async () => {
    const userId = await makeMember("member", [workspace.id], "=Mallory");
    const t = await makeTask(workspace.id, "@SUM(A1)", "Ops, west");
    await log(userId, AT, AT + HOUR_MS, t, workspace.id, "+1 call, follow-up");
    actor.id = adminId;
    const [, row] = await lines(await exportCsv(workspace.slug, `week=2026-03-02&person=${userId}`));
    expect(row).toContain(",'=Mallory,");
    expect(row).toContain(',"Ops, west",');
    expect(row).toContain(",'@SUM(A1),");
    expect(row).toContain(`,"'+1 call, follow-up",`);
  });

  it("404s for a person outside scope and for an org the user is not in", async () => {
    actor.id = memberId;
    await expect(exportCsv(workspace.slug, `week=2026-03-02&person=${ownerId}`)).rejects.toMatchObject(notFound);
    actor.id = leaverId;
    await expect(exportCsv()).rejects.toMatchObject(notFound);
  });
});
