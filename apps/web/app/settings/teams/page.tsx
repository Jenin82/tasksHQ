import { asc, count, eq } from "drizzle-orm";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { canOrg } from "@tasks/core/access";
import { team, teamMember } from "@tasks/core/schema";
import { NewTeamDialog } from "@/app/new-team-dialog";
import { IsoLattice } from "@/components/iso-lattice";
import { SiteFooter } from "@/components/site-footer";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";

export default async function OrgTeamsPage() {
  const { role } = await getOrgContext();
  if (!canOrg(role, "org:create_team")) forbidden();

  const teams = await db.select({ slug: team.slug, name: team.name, members: count(teamMember.userId) })
    .from(team)
    .leftJoin(teamMember, eq(teamMember.teamId, team.id))
    .groupBy(team.id)
    .orderBy(asc(team.name), asc(team.id));

  // Laid out like a team's project picker: the lattice, a heading with the
  // page's action beside it, a card grid.
  return (
    <>
      <main className="relative flex-1 px-4 py-12 sm:px-6">
        <IsoLattice />
        <div className="relative mx-auto max-w-[1200px] px-6 sm:px-10">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <p className="stutter">Teams</p>
              <h1 className="mt-3 text-2xl">Who works on what?</h1>
            </div>
            <NewTeamDialog />
          </div>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teams.length === 0 ? (
              <li className="rounded-2xl bg-card p-5 shadow-subtle">
                <p>No teams yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Create the first one.</p>
              </li>
            ) : (
              teams.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/${t.slug}`}
                    className="flex h-full flex-col gap-3 rounded-2xl bg-card p-5 shadow-subtle outline-none transition-colors hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate text-base">{t.name}</span>
                    <span className="flex items-baseline justify-between gap-4">
                      <span className="stutter truncate">{t.slug}</span>
                      <span className="stutter shrink-0">
                        <span className="numeral">{t.members}</span> {t.members === 1 ? "member" : "members"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
