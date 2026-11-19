import { redirect } from "next/navigation";

// Organization settings became Team settings when organizations were renamed to
// teams; this keeps old links (and their #section anchors) working.
export default function OldOrganizationSettingsPage() {
  redirect("/docs/team-settings");
}
