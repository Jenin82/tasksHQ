import { eq } from "drizzle-orm";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { listTimeReportEntries, OutOfReportScope } from "@tasks/core/domain";
import { user as userTable } from "@tasks/core/schema";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/lib/db";
import { formatDuration } from "@/lib/format";
import { getOrgContext } from "@/lib/org-context";
import { cn } from "@/lib/utils";
import { clampEntries, parseReportRange } from "./range";

export default async function TeamTimePage({ params, searchParams }: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, user } = await getOrgContext(slug);
  const [row] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id));
  const range = parseReportRange(query, row?.timezone ?? "UTC");
  const { dates, person } = range;

  let entries;
  try {
    entries = await listTimeReportEntries(
      { db, actorUserId: user.id, source: "web" },
      { orgId: org.id, from: range.from, to: range.to, ...(person ? { userId: person } : {}) },
    );
  } catch (error) {
    if (error instanceof OutOfReportScope) notFound();
    throw error;
  }
  const clamped = clampEntries(entries, range);

  const people = new Map<string, { id: string; name: string; email: string; zoneUnknown: boolean; days: number[]; total: number }>();
  for (const { entry, days, total } of clamped) {
    let personRow = people.get(entry.userId);
    if (!personRow) {
      personRow = {
        id: entry.userId,
        name: entry.userName,
        email: entry.userEmail,
        zoneUnknown: entry.userTimezone === null,
        days: dates.map(() => 0),
        total: 0,
      };
      people.set(entry.userId, personRow);
    }
    days.forEach((ms, index) => { personRow.days[index] += ms; });
    personRow.total += total;
  }
  const dailyTotals = dates.map((_, index) => clamped.reduce((sum, { days }) => sum + days[index], 0));
  const grandTotal = clamped.reduce((sum, { total }) => sum + total, 0);

  const path = `/${org.slug}/settings/time`;
  const week = range.view === "week";
  const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric" });
  const rangeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  const monthLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
  const navLink = "rounded-full px-3 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
  const cell = "px-3 py-2 text-right numeral whitespace-nowrap";
  const duration = (ms: number) => ms ? formatDuration(ms) : <><span aria-hidden="true">–</span><span className="sr-only">No time</span></>;

  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-8 sm:px-10 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Team Time</h1>
        <a href={`${path}/export?${range.query}`} className={buttonVariants({ variant: "outline" })}>Download CSV</a>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Owners and admins see everyone. Leads see themselves and their direct reports. People without logged time in this period aren’t listed.
      </p>
      {!row?.timezone && (
        <p className="mt-1 text-sm text-muted-foreground">
          Until you save your time zone, today and people without a saved zone use UTC. Save it in{" "}
          <Link href={`/${org.slug}/settings/your-time`} className="rounded-sm underline outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Your Time</Link>.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 id="time-range" className="text-base">
          {week
            ? `${rangeLabel.format(Date.parse(range.first))} – ${rangeLabel.format(Date.parse(range.last))}`
            : monthLabel.format(Date.parse(range.first))}
        </h2>
        <div className="flex flex-wrap items-center gap-1">
          <nav aria-label="View" className="flex items-center gap-1">
            {(["week", "month"] as const).map((view) => (
              <Link
                key={view}
                href={view === range.view ? `${path}?${range.query}` : `${path}?${range.otherView}`}
                aria-current={view === range.view ? "page" : undefined}
                className={cn(navLink, view === range.view && "bg-muted text-foreground")}
              >
                {view === "week" ? "Week" : "Month"}
              </Link>
            ))}
          </nav>
          <nav aria-label={week ? "Weeks" : "Months"} className="flex items-center gap-1">
            <Link href={`${path}?${range.prev}`} className={navLink}>Previous<span className="sr-only">{week ? " week" : " month"}</span></Link>
            {!range.isCurrent && <Link href={`${path}?${range.current}`} className={navLink}>{week ? "This week" : "This month"}</Link>}
            <Link href={`${path}?${range.next}`} className={navLink}>Next<span className="sr-only">{week ? " week" : " month"}</span></Link>
          </nav>
        </div>
      </div>

      {person ? (
        <PersonBreakdown
          orgSlug={org.slug}
          clamped={clamped}
          back={`${path}?${range.periodQuery()}`}
          duration={duration}
          cell={cell}
        />
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl bg-card shadow-subtle">
          <table aria-labelledby="time-range" className={cn("w-full text-sm", week && "min-w-[48rem]")}>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="stutter px-3 py-2 text-left font-normal">Person</th>
                {week && dates.map((date) => (
                  <th key={date} scope="col" className={cn("stutter px-3 py-2 text-right font-normal", date === range.today && "text-foreground")}>
                    {dayLabel.format(Date.parse(date))}
                    {date === range.today && <span className="sr-only"> (today)</span>}
                  </th>
                ))}
                <th scope="col" className="stutter px-3 py-2 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {people.size === 0 ? (
                <tr>
                  <td colSpan={week ? 9 : 2} className="px-3 py-6 text-center text-muted-foreground">
                    No time logged this {week ? "week" : "month"}.
                  </td>
                </tr>
              ) : [...people.values()].map((personRow) => (
                <tr key={personRow.id} className="border-b border-border/50">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <Link
                      href={`${path}?${range.periodQuery(personRow.id)}`}
                      className="flex max-w-72 min-w-0 items-baseline gap-2 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="truncate">{personRow.name}</span>
                      <span className="truncate text-muted-foreground">{personRow.email}</span>
                      {personRow.zoneUnknown && <span className="shrink-0 text-xs text-muted-foreground">zone unknown</span>}
                    </Link>
                  </th>
                  {week && personRow.days.map((ms, index) => (
                    <td key={dates[index]} className={cn(cell, !ms && "text-muted-foreground")}>{duration(ms)}</td>
                  ))}
                  <td className={cell}>{formatDuration(personRow.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="stutter px-3 py-2 text-left font-normal">Total</th>
                {week && dailyTotals.map((ms, index) => (
                  <td key={dates[index]} className={cn(cell, !ms && "text-muted-foreground")}>{duration(ms)}</td>
                ))}
                <td className={cn(cell, "font-semibold")}>{formatDuration(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </main>
  );
}

/** One person's projects → tasks, from the same clamped entries as their row total. */
function PersonBreakdown({ orgSlug, clamped, back, duration, cell }: {
  orgSlug: string;
  clamped: ReturnType<typeof clampEntries>;
  back: string;
  duration: (ms: number) => ReactNode;
  cell: string;
}) {
  const projects = new Map<string, { name: string; total: number; tasks: Map<string, { key: string; title: string; href: string; total: number }> }>();
  for (const { entry, total } of clamped) {
    let projectRow = projects.get(entry.projectSlug);
    if (!projectRow) {
      projectRow = { name: entry.projectName, total: 0, tasks: new Map() };
      projects.set(entry.projectSlug, projectRow);
    }
    projectRow.total += total;
    const taskRow = projectRow.tasks.get(entry.taskId)
      ?? { key: entry.key, title: entry.title, href: `/${orgSlug}/${entry.projectSlug}/${entry.key}`, total: 0 };
    taskRow.total += total;
    projectRow.tasks.set(entry.taskId, taskRow);
  }
  const first = clamped[0]?.entry;

  return (
    <section className="mt-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={back} className="rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          <span aria-hidden="true">←</span> Everyone
        </Link>
        {first && (
          <p className="min-w-0 text-sm">
            {first.userName} <span className="text-muted-foreground">{first.userEmail}</span>
            {first.userTimezone === null && <span className="ml-2 text-xs text-muted-foreground">zone unknown</span>}
          </p>
        )}
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl bg-card shadow-subtle">
        <table aria-labelledby="time-range" className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="stutter px-3 py-2 text-left font-normal">Project / task</th>
              <th scope="col" className="stutter px-3 py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          {projects.size === 0 ? (
            <tbody>
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">No time logged by this person in this period.</td>
              </tr>
            </tbody>
          ) : [...projects].sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([projectSlug, projectRow]) => (
            <tbody key={projectSlug}>
              <tr className="border-b border-border/50">
                <th scope="row" className="px-3 py-2 text-left font-semibold">{projectRow.name}</th>
                <td className={cn(cell, "font-semibold")}>{duration(projectRow.total)}</td>
              </tr>
              {[...projectRow.tasks.values()]
                .sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }))
                .map((taskRow) => (
                  <tr key={taskRow.href} className="border-b border-border/50">
                    <th scope="row" className="py-2 pr-3 pl-7 text-left font-normal">
                      <Link href={taskRow.href} prefetch={false} className="flex max-w-96 min-w-0 items-baseline gap-2 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="stutter numeral shrink-0">{taskRow.key}</span>
                        <span className="truncate">{taskRow.title}</span>
                      </Link>
                    </th>
                    <td className={cell}>{duration(taskRow.total)}</td>
                  </tr>
                ))}
            </tbody>
          ))}
          <tfoot>
            <tr>
              <th scope="row" className="stutter px-3 py-2 text-left font-normal">Total</th>
              <td className={cn(cell, "font-semibold")}>{formatDuration(clamped.reduce((sum, { total }) => sum + total, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
