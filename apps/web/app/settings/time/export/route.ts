import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { user as userTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";
import { zonedIsoString } from "@/lib/time-zone";
import { listFilteredEntries, resolveTimeFilter } from "../filter";
import { clampEntries, csvDocument, csvField, parseReportRange } from "../range";

export const dynamic = "force-dynamic";

// Team is last, so the columns before it keep their old positions.
const HEADER = ["date", "person", "email", "project", "task key", "title", "start", "end", "hours", "running", "note", "kind", "source", "auto stopped", "edited", "team"];
const yesNo = (value: boolean) => value ? "yes" : "no";

/**
 * One row per entry per local day it has time on, in its person's zone, so
 * daily totals match the Time page grid. Takes the page's `people` and `team`
 * (without the saved filter, which the page's link always spells out).
 */
export async function GET(request: Request) {
  const { user } = await getOrgContext();
  const [row] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id));
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const filter = await resolveTimeFilter(user.id, query);
  // Never swap in the viewer's rows for people the export can't include.
  if (filter.fallback) notFound();
  const range = parseReportRange({ ...query, team: filter.team?.slug, people: filter.param }, row?.timezone ?? "UTC");
  const entries = await listFilteredEntries(user.id, filter, range);

  const rows = clampEntries(entries, range).flatMap(({ entry, days, bounds }) => {
    const zone = entry.userTimezone ?? range.viewerZone;
    const start = entry.startedAt.getTime();
    const end = entry.endedAt.getTime();
    return days.flatMap((ms, index) => {
      if (!ms) return [];
      const dayEnd = Math.min(end, bounds[index + 1]);
      return [[
        range.dates[index],
        csvField(entry.userName, true),
        csvField(entry.userEmail, true),
        csvField(entry.projectName, true),
        csvField(entry.key),
        csvField(entry.title, true),
        zonedIsoString(Math.max(start, bounds[index]), zone),
        // A running entry's current end is not a real end.
        entry.running && dayEnd === end ? "" : zonedIsoString(dayEnd, zone),
        (ms / 3_600_000).toFixed(2),
        yesNo(entry.running),
        csvField(entry.note ?? "", true),
        csvField(entry.kind),
        csvField(entry.source),
        yesNo(entry.autoStopped),
        yesNo(entry.edited),
        csvField(entry.teamName, true),
      ]];
    });
  });

  return new Response(csvDocument([HEADER, ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filter.team ? `${filter.team.slug}-` : ""}time-${range.first}-to-${range.last}.csv"`,
    },
  });
}
