import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { listMyTimeEntries } from "@tasks/core/domain";
import { user as userTable } from "@tasks/core/schema";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/lib/db";
import { formatDuration } from "@/lib/format";
import { getOrgContext } from "@/lib/org-context";
import { zonedMidnight } from "@/lib/time-zone";
import { cn } from "@/lib/utils";
import { listFilteredEntries, resolveTimeFilter } from "./filter";
import { MAX_PEOPLE, TIME_FILTER_COOKIE } from "./filter-cookie";
import { PeopleFilter, SaveTimeFilter } from "./people-filter";
import { clampEntries, parseReportRange } from "./range";
import { TeamFilter } from "./team-filter";
import { AddTimeEntry, TimeEntryList, TimezoneNotice } from "./time-controls";

/**
 * Every org member's time page: the selected people's time (by default the
 * viewer's), within their report scope, and in a week that includes the
 * viewer, their own entries to add and edit.
 */
export default async function TimePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { user } = await getOrgContext();
  const [[row], cookieStore] = await Promise.all([
    db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id)),
    cookies(),
  ]);
  const savedZone = row?.timezone ?? null;
  const zone = savedZone ?? "UTC";
  const filter = await resolveTimeFilter(user.id, query, cookieStore.get(TIME_FILTER_COOKIE)?.value);
  const { teams, selected } = filter;
  const range = parseReportRange({ ...query, team: filter.team?.slug, people: filter.param }, zone);
  const { dates } = range;
  const week = range.view === "week";
  // Own entries are editable only week by week, and only when you chose yourself.
  const showOwn = week && selected !== "all" && selected.includes(user.id);

  const [entries, own] = await Promise.all([
    listFilteredEntries(user.id, filter, range),
    showOwn
      ? listMyTimeEntries(
        { db, actorUserId: user.id, source: "web" },
        { teamId: filter.team?.id, from: new Date(zonedMidnight(range.first, zone)), to: new Date(zonedMidnight(range.end, zone)) },
      )
      : [],
  ]);
  const clamped = clampEntries(entries, range);
  // Time is tracked only in teams the user really belongs to.
  const memberTeams = teams.filter(({ implicit }) => !implicit).map(({ slug, name }) => ({ slug, name }));

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

  const path = "/settings/time";
  const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric" });
  const rangeLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  const monthLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
  const navLink = "rounded-full px-3 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
  const cell = "px-3 py-2 text-right numeral whitespace-nowrap";
  const duration = (ms: number) => ms ? formatDuration(ms) : <><span aria-hidden="true">–</span><span className="sr-only">No time</span></>;

  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-8 sm:px-10 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Time</h1>
        <a href={`${path}/export?${range.query}`} className={buttonVariants({ variant: "outline" })}>Download CSV</a>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Organization Super admins and admins see everyone. Team admins see everyone in their teams. Leads see their direct reports only in teams the lead belongs to. People without logged time in this period aren’t listed.
      </p>
      {!savedZone && (
        <p className="mt-1 text-sm text-muted-foreground">
          Until your time zone is saved, today and people without a saved zone use UTC.
        </p>
      )}
      <TimezoneNotice saved={savedZone} />
      <SaveTimeFilter value={filter.save} />
      {filter.fallback && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">None of the chosen people are in your report scope, so this shows your time.</p>
      )}
      {filter.truncated && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">Only the first {MAX_PEOPLE} chosen people are shown.</p>
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Shown while a filter is active too, so it can always be cleared. */}
        {(teams.length > 1 || filter.team) && (
          <TeamFilter
            value={filter.team?.slug ?? ""}
            teams={teams.map(({ slug, name }) => ({ slug, name }))}
            hrefs={Object.fromEntries(["", ...teams.map(({ slug }) => slug)].map((slug) => [slug, `${path}?${range.teamQuery(slug)}`]))}
          />
        )}
        <PeopleFilter path={path} base={range.periodQuery()} people={filter.people} selected={selected} />
      </div>

      {selected !== "all" && selected.length === 1 ? (
        <PersonBreakdown clamped={clamped} duration={duration} cell={cell} />
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

      {showOwn && (
        <section className="mt-10 border-t border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base">Your entries <span className="stutter numeral ml-2">{own.length}</span></h2>
            {memberTeams.length > 0 && <AddTimeEntry teams={memberTeams} timeZone={zone} />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Organization Super admins and admins, your team’s admins, and your lead (in teams they belong to) can see your logged time and notes. Everyone in a team can see the total time logged on each of its tasks.
          </p>
          {own.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No entries this week.</p>
          ) : (
            <TimeEntryList
              timeZone={zone}
              entries={own.map((entry) => ({
                id: entry.id,
                startedAt: entry.startedAt,
                endedAt: entry.endedAt,
                note: entry.note,
                autoStopped: entry.autoStopped,
                edited: entry.editedAt !== null,
                key: entry.key,
                title: entry.title,
                teamName: entry.teamName,
                href: `/${entry.teamSlug}/${entry.projectSlug}/${entry.key}`,
                editable: entry.editable,
              }))}
            />
          )}
        </section>
      )}
    </main>
  );
}

/** One person's projects → tasks, from the same clamped entries as their row total. */
function PersonBreakdown({ clamped, duration, cell }: {
  clamped: ReturnType<typeof clampEntries>;
  duration: (ms: number) => ReactNode;
  cell: string;
}) {
  // By project ID: slugs repeat across teams.
  const projects = new Map<string, { name: string; teamName: string; total: number; tasks: Map<string, { key: string; title: string; href: string; total: number }> }>();
  for (const { entry, total } of clamped) {
    let projectRow = projects.get(entry.projectId);
    if (!projectRow) {
      projectRow = { name: entry.projectName, teamName: entry.teamName, total: 0, tasks: new Map() };
      projects.set(entry.projectId, projectRow);
    }
    projectRow.total += total;
    const taskRow = projectRow.tasks.get(entry.taskId)
      ?? { key: entry.key, title: entry.title, href: `/${entry.teamSlug}/${entry.projectSlug}/${entry.key}`, total: 0 };
    taskRow.total += total;
    projectRow.tasks.set(entry.taskId, taskRow);
  }
  const first = clamped[0]?.entry;

  return (
    <section className="mt-3">
      {first && (
        <p className="min-w-0 text-sm">
          {first.userName} <span className="text-muted-foreground">{first.userEmail}</span>
          {first.userTimezone === null && <span className="ml-2 text-xs text-muted-foreground">zone unknown</span>}
        </p>
      )}
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
          ) : [...projects].sort(([, a], [, b]) => a.name.localeCompare(b.name) || a.teamName.localeCompare(b.teamName)).map(([projectId, projectRow]) => (
            <tbody key={projectId}>
              <tr className="border-b border-border/50">
                <th scope="row" className="px-3 py-2 text-left font-semibold">
                  {projectRow.name} <span className="font-normal text-muted-foreground">{projectRow.teamName}</span>
                </th>
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
