import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org-context";

// Bare /settings: owners and admins land on Members, other org members go home.
export default async function OrgSettingsIndex() {
  const { canManage } = await getOrgContext();
  redirect(canManage ? "/settings/members" : "/");
}
