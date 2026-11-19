import { WorkspaceAssignmentPage } from "../workspace-assignment-page";

export default async function YourReportsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <WorkspaceAssignmentPage teamSlug={team} view="reports" />;
}
