import { forbidden } from "next/navigation";
import { canOrg } from "@tasks/core/access";
import { getOrgContext } from "@/lib/org-context";
import { RenameOrgForm } from "./rename-form";

export default async function OrgGeneralPage() {
  const { org, role } = await getOrgContext();
  if (!canOrg(role, "org:rename")) forbidden();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-10 sm:py-12">
      <h1 className="text-2xl">General</h1>
      <section className="mt-6 rounded-2xl bg-card p-6 shadow-subtle" aria-labelledby="org-details">
        <h2 id="org-details" className="text-xl">Organization details</h2>
        <RenameOrgForm name={org.name} />
      </section>
    </main>
  );
}
