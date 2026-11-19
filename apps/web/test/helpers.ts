import type { DrizzleD1Database } from "drizzle-orm/d1";
import { team, teamMember, type Team } from "@tasks/core/schema";

/**
 * Creates a team owned by `actorUserId` without the org owner/admin check the
 * domain's createTeam makes, so fixtures need not grant implicit access to
 * every team. test/org.test.ts covers the real createTeam.
 */
export async function createTeam(
  ctx: { db: DrizzleD1Database; actorUserId: string; source?: "web" | "mcp" },
  input: { slug: string; name: string },
): Promise<Team> {
  const row: Team = { id: crypto.randomUUID(), slug: input.slug, name: input.name.trim(), createdAt: new Date() };
  await ctx.db.batch([
    ctx.db.insert(team).values(row),
    ctx.db.insert(teamMember).values({ teamId: row.id, userId: ctx.actorUserId, role: "owner", createdAt: row.createdAt }),
  ]);
  return row;
}
