import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AccessError, requireProjectMember } from "@tasks/core/access";
import type { Project, ProjectRole } from "@tasks/core/schema";
import { project } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getOrgContext, type OrgContext } from "@/lib/org-context";

export type ProjectContext = OrgContext & { project: Project; projectRole: ProjectRole | null };

/**
 * Resolves an org slug and a project slug to the project and the caller's
 * membership, for the `/[org]/[project]` layout and every page under it.
 *
 * Same non-leaking contract as `getOrgContext` (PLAN §4.6): a project that
 * does not exist and one the caller cannot reach are the identical
 * `notFound()`. `requireProjectMember` applies organization membership and
 * reads the caller's project role for settings permissions.
 */
export const getProjectContext = cache(async function getProjectContext(
  orgSlug: string,
  projectSlug: string,
): Promise<ProjectContext> {
  const ctx = await getOrgContext(orgSlug);

  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.orgId, ctx.org.id), eq(project.slug, projectSlug)));
  if (!row) notFound();

  try {
    const access = await requireProjectMember(db, row.id, ctx.user.id);
    return { ...ctx, ...access };
  } catch (error) {
    if (error instanceof AccessError && error.reason === "not_a_member") {
      notFound();
    }
    throw error;
  }
});
