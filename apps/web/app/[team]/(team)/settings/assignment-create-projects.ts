import { and, asc, eq } from "drizzle-orm";
import { teamMember, project } from "@tasks/core/schema";
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
      .innerJoin(teamMember, and(
        eq(teamMember.teamId, project.teamId),
        eq(teamMember.userId, userId),
      ))
      .where(eq(project.teamId, id))
      .orderBy(asc(project.name), asc(project.id));

    return {
      slug,
      name,
      projects: rows,
    };
  }));
}
