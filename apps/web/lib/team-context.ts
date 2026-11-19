import { asc, eq, isNotNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AccessError, requireTeamMember, teamAccess, type TeamAccess } from "@tasks/core/access";
import type { Team } from "@tasks/core/schema";
import { team } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/session";

export type TeamContext = {
  user: SessionUser;
  team: Team;
  member: TeamAccess;
};

/**
 * Every team the user can open: their own, plus all teams for org owners and
 * admins (`implicit`). All My Tasks keeps to the non-implicit ones.
 */
export const listUserTeams = cache(async function listUserTeams(userId: string) {
  const access = teamAccess(team.id, userId);
  const rows = await db.select({ id: team.id, slug: team.slug, name: team.name, role: access.role, implicit: access.implicit })
    .from(team)
    .where(isNotNull(access.role))
    .orderBy(asc(team.name), asc(team.id));
  return rows.map((row) => ({ ...row, role: row.role! }));
});

/**
 * Resolves a team slug to the team and the caller's membership, for the
 * `/[team]` layout and every page under it.
 *
 * PLAN §4.6: a non-member gets `notFound()`, not 403, so team slugs are not
 * enumerable — an unknown slug and a slug the caller cannot reach are the same
 * response. Capability denials (403) come from the domain layer instead, where
 * the caller is already known to be a member.
 */
export const getTeamContext = cache(async function getTeamContext(slug: string): Promise<TeamContext> {
  const user = await requireUser();

  const [row] = await db.select().from(team).where(eq(team.slug, slug));
  if (!row) notFound();

  try {
    const member = await requireTeamMember(db, row.id, user.id);
    return { user, team: row, member };
  } catch (error) {
    if (error instanceof AccessError && error.reason === "not_a_member") {
      notFound();
    }
    throw error;
  }
});
