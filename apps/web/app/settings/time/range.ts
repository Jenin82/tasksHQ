import { overlapMs, type TimeReportEntry } from "@tasks/core/domain";
import { addDays, weekStart, zonedDate, zonedMidnight } from "@/lib/time-zone";

const HOUR_MS = 60 * 60 * 1000;
// Years 1900–2099, so the previous and next periods stay parseable.
const DATE = /^(19|20)\d{2}-\d{2}-\d{2}$/;
const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

const isDate = (value: unknown): value is string =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(value))
  && new Date(Date.parse(value)).toISOString().slice(0, 10) === value;

type Period = readonly ["week" | "month", string];

/** The query string for a period, plus `team` and `people` when given. */
const query = ([name, value]: Period, team?: string, people?: string) =>
  new URLSearchParams({ [name]: value, ...(team ? { team } : {}), ...(people ? { people } : {}) }).toString();

export type ReportRange = ReturnType<typeof parseReportRange>;

/**
 * `?week=YYYY-MM-DD` or `?month=YYYY-MM`, plus `?team=` (a slug) and
 * `?people=` (already resolved, see `resolveTimeFilter`), for the Time page and its CSV. Anything else is the current
 * week in `viewerZone`.
 */
export function parseReportRange(
  input: Record<string, string | string[] | undefined>,
  viewerZone: string,
  now = Date.now(),
) {
  const today = zonedDate(now, viewerZone);
  const people = typeof input.people === "string" && input.people ? input.people : undefined;
  const team = typeof input.team === "string" && input.team ? input.team : undefined;
  const month = typeof input.month === "string" && MONTH.test(input.month) ? input.month : undefined;

  let dates: string[];
  let prev: Period;
  let next: Period;
  let current: Period;
  if (month) {
    dates = [];
    for (let date = `${month}-01`; date.startsWith(month); date = addDays(date, 1)) dates.push(date);
    prev = ["month", addDays(dates[0], -1).slice(0, 7)];
    next = ["month", addDays(dates[dates.length - 1], 1).slice(0, 7)];
    current = ["month", today.slice(0, 7)];
  } else {
    const monday = weekStart(isDate(input.week) ? input.week : today);
    dates = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
    prev = ["week", addDays(monday, -7)];
    next = ["week", addDays(monday, 7)];
    current = ["week", weekStart(today)];
  }
  const view = month ? "month" as const : "week" as const;
  const self: Period = [view, month ?? dates[0]];
  const first = dates[0];
  const last = dates[dates.length - 1];
  const end = addDays(last, 1);

  return {
    view,
    dates,
    first,
    last,
    end,
    today,
    team,
    viewerZone,
    isCurrent: self[1] === current[1],
    /** Query strings for this, the previous, next and current period, keeping `team` and `people`. */
    query: query(self, team, people),
    prev: query(prev, team, people),
    next: query(next, team, people),
    current: query(current, team, people),
    /** The same period and team without `people`, or with different ones. */
    periodQuery: (otherPeople?: string) => query(self, team, otherPeople),
    /** The same period and people in another team, or across all teams. */
    teamQuery: (slug?: string) => query(self, slug, people),
    /** This period in the other view: its month, or for a month its first week (this week for the current month). */
    otherView: query(month ? ["week", weekStart(self[1] === current[1] ? today : first)] : ["month", first.slice(0, 7)], team, people),
    // Wide enough for every zone's local days: UTC−12 to UTC+14.
    from: new Date(Date.parse(first) - 14 * HOUR_MS),
    to: new Date(Date.parse(end) + 12 * HOUR_MS),
  };
}

export type ClampedEntry = {
  entry: TimeReportEntry;
  /** Milliseconds on each of the range's dates, in the person's zone. */
  days: number[];
  total: number;
  /** The person's local midnights for the range's dates, then its end. */
  bounds: number[];
};

/**
 * Each entry clamped to its person's own local days (their saved zone, else
 * the viewer's), dropping entries with no time in range. Sorted by person
 * name, then start.
 */
export function clampEntries(entries: TimeReportEntry[], range: ReportRange): ClampedEntry[] {
  const boundsByZone = new Map<string, number[]>();
  const clamped: ClampedEntry[] = [];
  for (const entry of entries) {
    const zone = entry.userTimezone ?? range.viewerZone;
    let bounds = boundsByZone.get(zone);
    if (!bounds) {
      bounds = [...range.dates, range.end].map((date) => zonedMidnight(date, zone));
      boundsByZone.set(zone, bounds);
    }
    const start = entry.startedAt.getTime();
    const end = entry.endedAt.getTime();
    const days = range.dates.map((_, index) => overlapMs(start, end, bounds[index], bounds[index + 1]));
    const total = days.reduce((sum, ms) => sum + ms, 0);
    if (total > 0) clamped.push({ entry, days, total, bounds });
  }
  // SQL orders names by binary collation; sort as people read them. Stable, so start order holds.
  return clamped.sort((a, b) =>
    a.entry.userName.localeCompare(b.entry.userName) || (a.entry.userId < b.entry.userId ? -1 : a.entry.userId > b.entry.userId ? 1 : 0));
}

// Including the full-width forms, which some spreadsheet apps also read as formulas.
const FORMULA = /^[=+\-@\t\r＝＋－＠]/;

/**
 * One CSV field. `text` fields hold user-entered values, so a leading formula
 * character is neutralized for spreadsheet apps.
 */
export function csvField(value: string, text = false) {
  const guarded = text && FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** A UTF-8 BOM, then CRLF-terminated rows of pre-escaped fields. */
export function csvDocument(rows: string[][]) {
  return `\uFEFF${rows.map((row) => `${row.join(",")}\r\n`).join("")}`;
}
