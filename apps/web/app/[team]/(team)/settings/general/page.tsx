import { forbidden } from "next/navigation";
import { can } from "@tasks/core/access";
import { DeleteSettingsSection } from "@/components/delete-settings-section";
import { getTeamContext } from "@/lib/team-context";
import { deleteTeamAction, renameTeamAction } from "./actions";
import { RenameTeamForm } from "./rename-form";

export default async function TeamGeneralPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team: slug } = await params;
  const { team, member } = await getTeamContext(slug);
  if (!can(member.role, "team:rename")) forbidden();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-10 sm:py-12">
      <h1 className="text-2xl">General</h1>
      <section className="mt-6 rounded-2xl bg-card p-6 shadow-subtle" aria-labelledby="team-details">
        <h2 id="team-details" className="text-xl">Team details</h2>
        <RenameTeamForm name={team.name} action={renameTeamAction.bind(null, team.slug, team.id)} />
      </section>
      {can(member.role, "team:delete") && (
        <DeleteSettingsSection
          resource="team"
          name={team.name}
          slug={team.slug}
          description="All projects, tasks, comments, and history in this team will also be deleted."
          action={deleteTeamAction.bind(null, team.slug, team.id)}
        />
      )}
    </main>
  );
}
