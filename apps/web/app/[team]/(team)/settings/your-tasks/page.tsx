import { WorkspaceAssignmentPage } from "../workspace-assignment-page";

export default async function YourTasksPage({ params, searchParams }: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ team }, { view }] = await Promise.all([params, searchParams]);
  return <WorkspaceAssignmentPage teamSlug={team} view={view === "assigned" ? "assigned" : "mine"} />;
}
