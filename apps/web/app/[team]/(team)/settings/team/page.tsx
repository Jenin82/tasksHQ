import { redirect } from "next/navigation";
import { getOrgMembership } from "@/lib/org-context";
import { getTeamContext } from "@/lib/team-context";

// Reporting lines moved from `settings/team` to the organization's
// `/settings/reporting-lines`; this keeps old links working for one release.
export default async function OldReportingLinesPage({ params }: { params: Promise<{ team: string }> }) {
  const { user } = await getTeamContext((await params).team);
  // Only org owners and admins manage lines now; everyone else lands on Time.
  const { canManage } = await getOrgMembership(user.id);
  redirect(canManage ? "/settings/reporting-lines" : "/settings/time");
}
