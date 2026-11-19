import { asc, eq } from "drizzle-orm";
import { teamMember, user } from "@tasks/core/schema";
import { db } from "@/lib/db";

export function teamAssignablePeople(teamId: string) {
  return db.select({ userId: teamMember.userId, name: user.name, image: user.image })
    .from(teamMember).innerJoin(user, eq(user.id, teamMember.userId))
    .where(eq(teamMember.teamId, teamId)).orderBy(asc(user.name));
}
