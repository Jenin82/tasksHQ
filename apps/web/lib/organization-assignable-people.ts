import { asc, eq } from "drizzle-orm";
import { orgMember, user } from "@tasks/core/schema";
import { db } from "@/lib/db";

export function organizationAssignablePeople(orgId: string) {
  return db.select({ userId: orgMember.userId, name: user.name, image: user.image })
    .from(orgMember).innerJoin(user, eq(user.id, orgMember.userId))
    .where(eq(orgMember.orgId, orgId)).orderBy(asc(user.name));
}
