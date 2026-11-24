"use client";

import { useRouter } from "next/navigation";

/** Narrows the Time page to one team; each option's URL keeps the period and people. */
export function TeamFilter({ value, teams, hrefs }: {
  value: string;
  teams: { slug: string; name: string }[];
  hrefs: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Team"
      className="h-8 rounded-full border border-border bg-background px-3 text-sm"
      value={value}
      onChange={(event) => router.push(hrefs[event.currentTarget.value])}
    >
      <option value="">All teams</option>
      {teams.map(({ slug, name }) => <option key={slug} value={slug}>{name}</option>)}
    </select>
  );
}
