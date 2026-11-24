import type { OrgRole } from "@tasks/core/schema";
import { roleLabel } from "@/lib/role-label";
import { SELECT_CLASS } from "@/lib/status-style";
import { cn } from "@/lib/utils";

export type RoleOption = { value: string; label: string };

/** Team roles: admin and member only. */
export const TEAM_ROLE_OPTIONS: readonly RoleOption[] = (["member", "admin"] as const)
  .map((value) => ({ value, label: roleLabel(value) }));

/** An org admin cannot grant Super admin (`owner`), so the option is not offered rather than refused on submit. */
export function orgRoleOptions(actorRole: OrgRole): readonly RoleOption[] {
  return actorRole === "owner" ? [...TEAM_ROLE_OPTIONS, { value: "owner", label: roleLabel("owner") }] : TEAM_ROLE_OPTIONS;
}

/** One native role control, shared by the team and org member forms. */
export function RoleSelect({
  options,
  className,
  ...props
}: React.ComponentProps<"select"> & { options: readonly RoleOption[] }) {
  return (
    <select
      {...props}
      className={cn(SELECT_CLASS, className)}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}
