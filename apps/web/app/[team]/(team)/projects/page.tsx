import { redirect } from "next/navigation";

// The projects list moved back to `/[team]` (§26). The route stays — and
// `projects` stays a reserved slug — so old links and bookmarks still land.
export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  redirect(`/${team}`);
}
