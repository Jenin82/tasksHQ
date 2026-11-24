import { redirect } from "next/navigation";
import { getTeamContext } from "@/lib/team-context";

// Your Time moved to the organization; this keeps old links working for one release.
export default async function OldYourTimePage({ params, searchParams }: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const [{ team: slug }, { week }] = await Promise.all([params, searchParams]);
  const { user } = await getTeamContext(slug);
  redirect(`/settings/time?${new URLSearchParams({ people: user.id, ...(typeof week === "string" ? { week } : {}) })}`);
}
