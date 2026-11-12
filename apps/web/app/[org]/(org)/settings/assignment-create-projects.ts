import { and, asc, eq } from "drizzle-orm";
import { orgMember, project } from "@tasks/core/schema";
import { db } from "@/lib/db";

type Workspace = { id: string; slug: string; name: string };

export async function listAssignmentCreateProjects(workspaces: Workspace[], userId: string) {
  return Promise.all(workspaces.map(async ({ id, slug, name }) => {
    const rows = await db.select({
      slug: project.slug,
      name: project.name,
      key: project.key,
    })
      .from(project)
      .innerJoin(orgMember, and(
        eq(orgMember.orgId, project.orgId),
        eq(orgMember.userId, userId),
      ))
      .where(eq(project.orgId, id))
      .orderBy(asc(project.name), asc(project.id));

    return {
      slug,
      name,
      projects: rows,
    };
  }));
}
