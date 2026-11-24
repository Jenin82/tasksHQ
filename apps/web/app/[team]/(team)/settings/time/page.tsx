import { redirect } from "next/navigation";
import { teamTimeRedirect } from "./team-time-redirect";

export default async function OldTeamTimePage({ params, searchParams }: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ team }, query] = await Promise.all([params, searchParams]);
  redirect(await teamTimeRedirect(team, query, "/settings/time"));
}
