import { WorkspaceAssignmentPage } from "../workspace-assignment-page";

export default async function YourTeamPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return <WorkspaceAssignmentPage orgSlug={org} view="team" />;
}
