import { listProjectTaskTypes } from "@tasks/core/domain";
import { db } from "@/lib/db";
import { ProjectTabs } from "@/components/tab-link";
import { TaskDialogProvider } from "./task-dialog";
import { getProjectContext } from "@/lib/project-context";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  // A project that does not exist, and one this caller cannot reach, are the
  // same `notFound()` — the contract the rest of the app keeps (§4.6).
  const { org, project, user } = await getProjectContext(orgSlug, projectSlug);
  const taskTypes = await listProjectTaskTypes({ db, actorUserId: user.id, source: "web" }, { projectId: project.id });
  const base = `/${org.slug}/${project.slug}`;

  // The project's name and key live in the top bar's breadcrumb (§7.2), so the
  // page's one h1 is for screen readers only. The task page sits under it, so
  // its heading is an h2 and its sections h3.
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">{project.name}</h1>
      <TaskDialogProvider key={base}>
        <ProjectTabs
          base={base}
          projectName={project.name}
          currentUser={{ id: user.id, displayName: user.name }}
          createTarget={{ org: org.slug, project: { slug: project.slug, key: project.key, name: project.name }, taskTypes }}
        >
          {children}
        </ProjectTabs>
      </TaskDialogProvider>
    </main>
  );
}
