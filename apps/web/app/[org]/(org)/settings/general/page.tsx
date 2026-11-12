import { forbidden } from "next/navigation";
import { can } from "@tasks/core/access";
import { DeleteSettingsSection } from "@/components/delete-settings-section";
import { getOrgContext } from "@/lib/org-context";
import { deleteOrgAction, renameOrgAction } from "./actions";
import { RenameOrgForm } from "./rename-form";

export default async function OrganizationGeneralPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  if (!can(member.role, "org:rename")) forbidden();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-10 sm:py-12">
      <h1 className="text-2xl">General</h1>
      <section className="mt-6 rounded-2xl bg-card p-6 shadow-subtle" aria-labelledby="organization-details">
        <h2 id="organization-details" className="text-xl">Organization details</h2>
        <RenameOrgForm name={org.name} action={renameOrgAction.bind(null, org.slug, org.id)} />
      </section>
      {can(member.role, "org:delete") && (
        <DeleteSettingsSection
          resource="organization"
          name={org.name}
          slug={org.slug}
          description="All projects, tasks, comments, and history in this organization will also be deleted."
          action={deleteOrgAction.bind(null, org.slug, org.id)}
        />
      )}
    </main>
  );
}
