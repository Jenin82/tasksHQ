import { forbidden } from "next/navigation";
import { readProjectSlack } from "@tasks/core/domain";
import { canProject } from "@tasks/core/access";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { SlackIntegration } from "../slack-integration";

export default async function ProjectIntegrationsSettingsPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  // Re-checked here, not inherited from the layout: a layout is not a
  // security boundary and every read re-proves reach independently (§4.6).
  const { org, project, user, member, projectRole } = await getProjectContext(
    orgSlug,
    projectSlug,
  );

  // Slack itself checks `project:manage_members`, so the page requires both.
  if (
    !canProject(member.role, projectRole, "project:manage_statuses")
    || !canProject(member.role, projectRole, "project:manage_members")
  ) forbidden();

  const slack = await readProjectSlack({ db, actorUserId: user.id, source: "web" }, { projectId: project.id });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-10">
      <SlackIntegration orgSlug={org.slug} projectSlug={project.slug} {...slack} />
    </div>
  );
}
