import { eq } from "drizzle-orm";
import Link from "next/link";
import { listMyTimeEntries } from "@tasks/core/domain";
import { STALE_MS, user as userTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { formatDuration } from "@/lib/format";
import { getOrgContext } from "@/lib/org-context";
import { addDays, zonedDate, zonedMidnight } from "@/lib/time-zone";
import { cn } from "@/lib/utils";
import { AddTimeEntry, TimeEntryList, TimezoneNotice } from "./your-time-controls";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function weekStart(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export default async function YourTimePage({ params, searchParams }: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const [{ org: slug }, { week }] = await Promise.all([params, searchParams]);
  const { org, user } = await getOrgContext(slug);
  const [row] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id));
  const savedZone = row?.timezone ?? null;
  // Until the browser's zone is saved, the first render falls back to UTC.
  const zone = savedZone ?? "UTC";

  const now = Date.now();
  const today = zonedDate(now, zone);
  const requested = typeof week === "string" && DATE.test(week) && !Number.isNaN(Date.parse(week)) ? week : today;
  const monday = weekStart(requested);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const bounds = [...days, addDays(monday, 7)].map((date) => zonedMidnight(date, zone));

  const entries = await listMyTimeEntries(
    { db, actorUserId: user.id, source: "web" },
    { orgId: org.id, from: new Date(bounds[0]), to: new Date(bounds[7]) },
  );

  // Tasks × days, splitting entries that cross midnight in the user's zone.
  const rows = new Map<string, { key: string; title: string; href: string; days: number[] }>();
  for (const entry of entries) {
    const start = entry.startedAt.getTime();
    // A running entry counts up to now, capped as the stop paths cap it.
    const end = entry.endedAt?.getTime() ?? Math.min(now, start + STALE_MS);
    let taskRow = rows.get(entry.taskId);
    if (!taskRow) {
      taskRow = {
        key: entry.key,
        title: entry.title,
        href: `/${org.slug}/${entry.projectSlug}/${entry.key}`,
        days: days.map(() => 0),
      };
      rows.set(entry.taskId, taskRow);
    }
    for (let index = 0; index < 7; index++) {
      taskRow.days[index] += Math.max(0, Math.min(end, bounds[index + 1]) - Math.max(start, bounds[index]));
    }
  }
  const grid = [...rows.values()]
    .filter((taskRow) => taskRow.days.some(Boolean))
    .sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
  const dailyTotals = days.map((_, index) => grid.reduce((sum, taskRow) => sum + taskRow.days[index], 0));
  const weekTotal = dailyTotals.reduce((sum, value) => sum + value, 0);

  const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric" });
  const rangeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  const path = `/${org.slug}/settings/your-time`;
  const thisWeek = weekStart(today);
  const navLink = "rounded-full px-3 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
  const cell = "px-3 py-2 text-right numeral whitespace-nowrap";

  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-8 sm:px-10 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Your Time</h1>
        <AddTimeEntry orgSlug={org.slug} timeZone={zone} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Everyone in the workspace can see the total time logged on each task.
      </p>
      <TimezoneNotice saved={savedZone} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base">
          {rangeLabel.format(Date.parse(monday))} – {rangeLabel.format(Date.parse(days[6]))}
        </h2>
        <nav aria-label="Weeks" className="flex items-center gap-1">
          <Link href={`${path}?week=${addDays(monday, -7)}`} className={navLink}>Previous</Link>
          {monday !== thisWeek && <Link href={path} className={navLink}>This week</Link>}
          <Link href={`${path}?week=${addDays(monday, 7)}`} className={navLink}>Next</Link>
        </nav>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl bg-card shadow-subtle">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="stutter px-3 py-2 text-left font-normal">Task</th>
              {days.map((date) => (
                <th key={date} scope="col" className={cn("stutter px-3 py-2 text-right font-normal", date === today && "text-foreground")}>
                  {dayLabel.format(Date.parse(date))}
                </th>
              ))}
              <th scope="col" className="stutter px-3 py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No time logged this week.</td>
              </tr>
            ) : grid.map((taskRow) => (
              <tr key={taskRow.href} className="border-b border-border/50">
                <th scope="row" className="max-w-64 px-3 py-2 text-left font-normal">
                  <Link href={taskRow.href} prefetch={false} className="flex min-w-0 items-baseline gap-2 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="stutter numeral shrink-0">{taskRow.key}</span>
                    <span className="truncate">{taskRow.title}</span>
                  </Link>
                </th>
                {taskRow.days.map((ms, index) => (
                  <td key={days[index]} className={cn(cell, !ms && "text-muted-foreground")}>{ms ? formatDuration(ms) : "–"}</td>
                ))}
                <td className={cell}>{formatDuration(taskRow.days.reduce((sum, ms) => sum + ms, 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="stutter px-3 py-2 text-left font-normal">Total</th>
              {dailyTotals.map((ms, index) => (
                <td key={days[index]} className={cn(cell, !ms && "text-muted-foreground")}>{ms ? formatDuration(ms) : "–"}</td>
              ))}
              <td className={cn(cell, "font-semibold")}>{formatDuration(weekTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <section className="mt-10 border-t border-border pt-6">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="stutter">Entries</h2>
          <span className="stutter numeral">{entries.length}</span>
        </div>
        {entries.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No entries this week.</p>
        ) : (
          <TimeEntryList
            timeZone={zone}
            entries={entries.map((entry) => ({
              id: entry.id,
              startedAt: entry.startedAt,
              endedAt: entry.endedAt,
              note: entry.note,
              autoStopped: entry.autoStopped,
              edited: entry.editedAt !== null,
              key: entry.key,
              title: entry.title,
              href: `/${org.slug}/${entry.projectSlug}/${entry.key}`,
            }))}
          />
        )}
      </section>
    </main>
  );
}
