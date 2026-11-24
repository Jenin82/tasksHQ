import { notFound } from "next/navigation";
import { listTimeReportEntries, listTimeReportPeople } from "@tasks/core/domain";
import { db } from "@/lib/db";
import { listUserTeams } from "@/lib/team-context";
import { MAX_PEOPLE } from "./filter-cookie";
import type { ReportRange } from "./range";

type Input = Record<string, string | string[] | undefined>;
const param = (input: Input, name: string) => {
  const value = input[name];
  return typeof value === "string" && value ? value : undefined;
};

export type TimeFilter = Awaited<ReturnType<typeof resolveTimeFilter>>;

/**
 * The Time page's people and team, from the URL, else from `saved` (the
 * cookie), else the viewer. Requested people outside the viewer's scope are
 * dropped; if none is left it falls back to the viewer with `fallback` set,
 * except a legacy `?person=`, which 404s like the old person view. A URL team
 * the viewer can't open 404s; a saved one is dropped. More than `MAX_PEOPLE`
 * requested people are cut off with `truncated` set.
 */
export async function resolveTimeFilter(viewerId: string, url: Input, saved?: string) {
  const explicit = Boolean(param(url, "people") ?? param(url, "team") ?? param(url, "person"));
  const source = explicit || !saved ? url : Object.fromEntries(new URLSearchParams(saved));
  const [people, teams] = await Promise.all([
    listTimeReportPeople({ db, actorUserId: viewerId, source: "web" }),
    listUserTeams(viewerId),
  ]);

  const slug = param(source, "team");
  const team = slug ? teams.find((row) => row.slug === slug) : undefined;
  if (slug && !team && explicit) notFound();

  const raw = param(source, "people");
  const legacy = raw === undefined && explicit ? param(url, "person") : undefined;
  let selected: string[] | "all" = "all";
  let fallback = false;
  let truncated = false;
  if (raw !== "all") {
    let requested = [...new Set(raw ? raw.split(",") : [legacy ?? viewerId])].filter(Boolean);
    truncated = requested.length > MAX_PEOPLE;
    requested = requested.slice(0, MAX_PEOPLE);
    const inScope = new Set(people.map(({ id }) => id));
    selected = requested.filter((id) => inScope.has(id));
    if (selected.length === 0) {
      if (legacy) notFound();
      selected = [viewerId];
      fallback = true;
    }
  }

  const value = selected === "all" ? "all" : selected.join(",");
  const cleaned = new URLSearchParams({ people: value, ...(team ? { team: team.slug } : {}) }).toString();
  return {
    people,
    teams,
    team,
    selected,
    fallback,
    truncated,
    /** The `people` URL value for `selected`. */
    param: value,
    /** The cookie value to save: when the URL chose the filter, or to heal a stale saved one. */
    save: explicit || (saved && cleaned !== saved) ? cleaned : null,
  };
}

/**
 * Entries for the filter. Selected IDs are never bound into SQL: one person
 * takes the indexed `userId` path, several filter the scoped entries in JS.
 */
export async function listFilteredEntries(viewerId: string, filter: TimeFilter, range: ReportRange) {
  const ctx = { db, actorUserId: viewerId, source: "web" as const };
  const input = { teamId: filter.team?.id, from: range.from, to: range.to };
  if (filter.selected === "all") return listTimeReportEntries(ctx, input);
  if (filter.selected.length === 1) return listTimeReportEntries(ctx, { ...input, userId: filter.selected[0] });
  const ids = new Set(filter.selected);
  return (await listTimeReportEntries(ctx, input)).filter(({ userId }) => ids.has(userId));
}
