import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AccessError, requireTeamMember } from "@tasks/core/access";
import type { Team, TeamMember } from "@tasks/core/schema";
import { team, teamMember } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/session";

export type TeamContext = {
  user: SessionUser;
  team: Team;
  member: TeamMember;
};

export const listUserTeams = cache(async function listUserTeams(userId: string) {
  return db.select({ id: team.id, slug: team.slug, name: team.name, role: teamMember.role })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(eq(teamMember.userId, userId))
    .orderBy(asc(team.name), asc(team.id));
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
