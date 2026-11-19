import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AccessError } from "@tasks/core/access";
import { listTimeReportEntries, OutOfReportScope } from "@tasks/core/domain";
import { user as userTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getTeamContext } from "@/lib/team-context";
import { zonedIsoString } from "@/lib/time-zone";
import { clampEntries, csvDocument, csvField, parseReportRange } from "../range";

export const dynamic = "force-dynamic";

const HEADER = ["date", "person", "email", "project", "task key", "title", "start", "end", "hours", "running", "note", "kind", "source", "auto stopped", "edited"];
const yesNo = (value: boolean) => value ? "yes" : "no";

/**
 * One row per entry per local day it has time on, in its person's zone, so
 * daily totals match the Team Time grid.
 */
export async function GET(request: Request, { params }: { params: Promise<{ team: string }> }) {
  const { team: slug } = await params;
  const { team, user } = await getTeamContext(slug);
  const [row] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id));
  const range = parseReportRange(Object.fromEntries(new URL(request.url).searchParams), row?.timezone ?? "UTC");

  let entries;
  try {
    entries = await listTimeReportEntries(
      { db, actorUserId: user.id, source: "web" },
      { teamId: team.id, from: range.from, to: range.to, ...(range.person ? { userId: range.person } : {}) },
    );
  } catch (error) {
    // Org owners/admins outside the team have no time reports there.
    if (error instanceof OutOfReportScope || (error instanceof AccessError && error.reason === "not_a_member")) notFound();
    throw error;
  }

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
      ]];
    });
  });

  return new Response(csvDocument([HEADER, ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${team.slug}-time-${range.first}-to-${range.last}.csv"`,
    },
  });
}
