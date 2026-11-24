import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org-context";

// Your Time merged into the Time page; this opens it on your own time.
export default async function YourTimePage({ searchParams }: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const [{ user }, { week }] = await Promise.all([getOrgContext(), searchParams]);
  redirect(`/settings/time?${new URLSearchParams({ people: user.id, ...(typeof week === "string" ? { week } : {}) })}`);
}
