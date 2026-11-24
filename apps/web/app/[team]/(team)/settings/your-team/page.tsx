import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team-context";

// Your Team (later Your Reports) was removed; this keeps old links working for
// one release.
export default async function OldYourTeamPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await getTeamContext((await params).team);
  redirect(`/${team.slug}/settings/your-tasks`);
}
