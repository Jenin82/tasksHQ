import { expect, it } from "vitest";
import { CHANGELOG, LATEST_CHANGELOG_ID, formatChangelogDate, hasUnseenChangelog } from "@/lib/changelog";

it("has unique, non-empty ids", () => {
  const ids = CHANGELOG.map((entry) => entry.id);
  expect(ids.every((id) => id.trim().length > 0)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  for (const entry of CHANGELOG) {
    expect(entry.id).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(entry.id.startsWith(`${entry.date}-`)).toBe(true);
  }
});

it("has valid calendar dates, newest first", () => {
  for (const { date } of CHANGELOG) {
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const parsed = new Date(`${date}T00:00:00Z`);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.toISOString().slice(0, 10)).toBe(date);
  }
  for (let i = 1; i < CHANGELOG.length; i++) {
    expect(CHANGELOG[i].date <= CHANGELOG[i - 1].date).toBe(true);
  }
});

it("gives every entry a title and at least one item", () => {
  for (const entry of CHANGELOG) {
    expect(entry.title.trim()).not.toBe("");
    expect(entry.items.length).toBeGreaterThan(0);
    expect(entry.items.every((item) => item.trim().length > 0)).toBe(true);
  }
});

it("treats the first entry as the latest", () => {
  expect(LATEST_CHANGELOG_ID).toBe(CHANGELOG[0].id);
});

it("is unseen until the latest id is stored", () => {
  expect(hasUnseenChangelog(null)).toBe(true);
  expect(hasUnseenChangelog(CHANGELOG.at(-1)!.id)).toBe(true);
  expect(hasUnseenChangelog(LATEST_CHANGELOG_ID)).toBe(false);
});

it("formats dates from the string without a time zone", () => {
  expect(formatChangelogDate("2026-11-17")).toBe("17 Nov 2026");
  expect(formatChangelogDate("2026-01-05")).toBe("5 Jan 2026");
});
