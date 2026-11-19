import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team-context";

// Reporting lines moved to `settings/reporting-lines` when organizations became
// teams; this keeps old links working for one release.
export default async function OldReportingLinesPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await getTeamContext((await params).team);
  redirect(`/${team.slug}/settings/reporting-lines`);
}
