import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { AccessError, requireProjectMember } from "@tasks/core/access";
import { findProjectByAlias } from "@tasks/core/domain";
import type { Project, ProjectRole } from "@tasks/core/schema";
import { project } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getTeamContext, type TeamContext } from "@/lib/team-context";

export type ProjectContext = TeamContext & { project: Project; projectRole: ProjectRole | null };

/** Set by `worker/index.ts` on GET and HEAD requests, overwriting any client value. */
export const REQUEST_PATH_HEADER = "x-taskshq-path";

/**
 * The redirect target for a request under a former project slug: the request
 * path with the slug segment replaced, when the trusted header holds a path
 * under `/${teamSlug}/${oldSlug}`; otherwise the project's root. Always a path
 * on this host.
 */
function renamedProjectPath(requestPath: string, teamSlug: string, oldSlug: string, newSlug: string) {
  const prefix = `/${teamSlug}/${oldSlug}`;
  const fallback = `/${teamSlug}/${newSlug}`;
  if (!requestPath.startsWith(prefix)) return fallback;
  const rest = requestPath.slice(prefix.length);
  if (rest && !rest.startsWith("/") && !rest.startsWith("?")) return fallback;
  const url = new URL(fallback + rest, "http://localhost");
  // Normalising could climb out of the project (`..`); never leave it.
  if (url.pathname !== fallback && !url.pathname.startsWith(`${fallback}/`)) return fallback;
  // vinext's cache-busting parameter for RSC requests; not part of the page URL.
  url.searchParams.delete("_rsc");
  return url.pathname + url.search;
}

async function redirectFromFormerSlug(ctx: TeamContext, projectSlug: string) {
  const target = await findProjectByAlias(db, ctx.team.id, projectSlug);
  if (!target) return;
  const requestHeaders = await headers();
  // Only GET and HEAD carry the path header (worker/index.ts). Anything else,
  // such as a Server Action or an upload from a page under the old slug, must
  // not be redirected: that would drop the submitted edit without saying so.
  const requestPath = requestHeaders.get(REQUEST_PATH_HEADER);
  if (!requestPath || requestHeaders.has("next-action") || requestHeaders.has("x-rsc-action")) return;
  try {
    await requireProjectMember(db, target.projectId, ctx.user.id);
  } catch (error) {
    if (error instanceof AccessError && error.reason === "not_a_member") return;
    throw error;
  }
  // Temporary: a permanent redirect could be cached past a later slug takeover.
  redirect(renamedProjectPath(requestPath, ctx.team.slug, projectSlug, target.projectSlug));
}

/**
 * Resolves a team slug and a project slug to the project and the caller's
 * membership, for the `/[team]/[project]` layout and every page under it.
 *
 * Same non-leaking contract as `getTeamContext` (PLAN §4.6): a project that
 * does not exist and one the caller cannot reach are the identical
 * `notFound()`. `requireProjectMember` applies team membership and
 * reads the caller's project role for settings permissions. A former slug of
 * a project redirects team members to the current one.
 */
export const getProjectContext = cache(async function getProjectContext(
  teamSlug: string,
  projectSlug: string,
): Promise<ProjectContext> {
  const ctx = await getTeamContext(teamSlug);

  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.teamId, ctx.team.id), eq(project.slug, projectSlug)));
  if (!row) {
    await redirectFromFormerSlug(ctx, projectSlug);
    notFound();
  }

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
