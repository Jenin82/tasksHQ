import { redirect } from "next/navigation";

// The projects list moved back to `/[org]` (§26). The route stays — and
// `projects` stays a reserved slug — so old links and bookmarks still land.
export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  redirect(`/${org}`);
}
