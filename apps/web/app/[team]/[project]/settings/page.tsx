import { asc, eq } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { can, canProject } from "@tasks/core/access";
import { status as statusTable } from "@tasks/core/schema";
import { DeleteSettingsSection } from "@/components/delete-settings-section";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { deleteProjectAction, renameProjectAction } from "./actions";
import { ProjectDetailsSettings } from "./project-details-settings";
import { TaskEditingSettings } from "./task-editing-settings";
import { AutoArchiveSettings } from "./auto-archive-settings";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ team: string; project: string }>;
}) {
  const { team: teamSlug, project: projectSlug } = await params;
  // Re-checked here, not inherited from the layout: a layout is not a
  // security boundary and every read re-proves reach independently (§4.6).
  const { team, project, member, projectRole } = await getProjectContext(
    teamSlug,
    projectSlug,
  );

  if (!canProject(member.role, projectRole, "project:manage_statuses")) forbidden();

  const statuses = await db
    .select({ id: statusTable.id, name: statusTable.name })
    .from(statusTable)
    .where(eq(statusTable.projectId, project.id))
    .orderBy(asc(statusTable.position), asc(statusTable.id));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-10">
      {can(member.role, "project:rename") && (
        <ProjectDetailsSettings
          teamSlug={team.slug}
          name={project.name}
          slug={project.slug}
          action={renameProjectAction.bind(null, team.slug, project.slug, project.id)}
        />
      )}
      <TaskEditingSettings teamSlug={team.slug} projectSlug={project.slug} restricted={project.restrictTaskEdits} />
      <AutoArchiveSettings
        teamSlug={team.slug}
        projectSlug={project.slug}
        statuses={statuses}
        currentStatusId={project.autoArchiveStatusId}
        currentDays={project.autoArchiveDays}
      />
      {can(member.role, "project:delete") && (
        <DeleteSettingsSection
          resource="project"
          name={project.name}
          slug={project.slug}
          description="All tasks, comments, and project history will also be deleted."
          action={deleteProjectAction.bind(null, team.slug, project.slug, project.id)}
        />
      )}
    </div>
  );
}
