import { and, asc, count, eq, isNull } from "drizzle-orm";
import { can } from "@tasks/core/access";
import { project, task } from "@tasks/core/schema";
import { IsoLattice } from "@/components/iso-lattice";
import { ProjectViewLink } from "@/components/project-view-link";
import { SiteFooter } from "@/components/site-footer";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";
import { NewProjectDialog } from "./new-project-dialog";

/**
 * `/[org]` is where a project is picked (§26), laid out like the signed-in
 * `/`: the lattice, a heading with the page's actions beside it, a card grid.
 * Organization settings are available in the workspace sidebar.
 */
export default async function OrgPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const canCreate = can(member.role, "project:create");

  const projects = await db
    .select({
      id: project.id,
      slug: project.slug,
      name: project.name,
      key: project.key,
      tasks: count(task.id),
    })
    .from(project)
    .leftJoin(task, and(eq(task.projectId, project.id), isNull(task.archivedAt)))
    .where(eq(project.orgId, org.id))
    .groupBy(project.id)
    .orderBy(asc(project.name), asc(project.id));

  const listing = (
    <main className="relative flex-1 px-4 py-12 sm:px-6">
      <IsoLattice />
      <div className="relative mx-auto max-w-[1200px] px-6 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            {/* The org's name is already in the bar's crumb. */}
            <p className="stutter">Projects</p>
            <h1 className="mt-3 text-2xl">What are you working on?</h1>
          </div>
          {canCreate && <NewProjectDialog orgSlug={org.slug} />}
        </div>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.length === 0 ? (
            <li className="rounded-2xl bg-card p-5 shadow-subtle">
              <p>No projects yet</p>
              {canCreate && <p className="mt-1 text-sm text-muted-foreground">Create the first one.</p>}
            </li>
          ) : (
            projects.map((p) => (
              <li key={p.id}>
                {/* As the org cards on `/`: a foreground wash on hover, not
                    `--accent` or the blue (§7.4, §7.5) — the stutter is muted. */}
                <ProjectViewLink
                  href={`/${org.slug}/${p.slug}`}
                  className="flex h-full flex-col gap-3 rounded-2xl bg-card p-5 shadow-subtle outline-none transition-colors hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate text-base">{p.name}</span>
                  {/* §7.1: key and count at opposite edges, no divider. */}
                  <span className="flex items-baseline justify-between gap-4">
                    <span className="stutter numeral">{p.key}</span>
                    <span className="stutter">
                      <span className="numeral">{p.tasks}</span>{" "}
                      {p.tasks === 1 ? "task" : "tasks"}
                    </span>
                  </span>
                </ProjectViewLink>
              </li>
            ))
          )}
        </ul>
      </div>
    </main>
  );

  return (
    <>
      {listing}
      <SiteFooter />
    </>
  );
}
