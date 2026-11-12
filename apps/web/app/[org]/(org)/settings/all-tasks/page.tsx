import { WorkspaceAssignmentPage } from "../workspace-assignment-page";

export default async function AllTasksPage({ params, searchParams }: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ org }, { view }] = await Promise.all([params, searchParams]);
  return <WorkspaceAssignmentPage orgSlug={org} view={view === "assigned" ? "assigned" : "mine"} allOrganizations />;
}
