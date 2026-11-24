import type { TeamRole } from "@tasks/core/access";
import type { OrgRole } from "@tasks/core/schema";

const LABELS: Record<OrgRole | TeamRole, string> = { owner: "Super admin", admin: "Admin", member: "Member" };

/** How a stored org or team role reads in the UI: the org `owner` role shows as "Super admin". */
export function roleLabel(role: OrgRole | TeamRole): string {
  return LABELS[role];
}

/** A team badge: an org owner's implicit admin access reads as their org role. */
export function teamRoleLabel(teamRole: TeamRole, orgRole: OrgRole | null): string {
  return roleLabel(orgRole === "owner" ? "owner" : teamRole);
}
