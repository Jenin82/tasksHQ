import { and, asc, eq, isNotNull } from "drizzle-orm";
import { teamAccess } from "@tasks/core/access";
import { project } from "@tasks/core/schema";
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
      .where(and(eq(project.teamId, id), isNotNull(teamAccess(project.teamId, userId).role)))
      .orderBy(asc(project.name), asc(project.id));

    return {
      slug,
      name,
      projects: rows,
    };
  }));
}
