import type { OrgRole } from "@tasks/core/access";
import { SELECT_CLASS } from "@/lib/status-style";
import { cn } from "@/lib/utils";

/**
 * The roles of §3's matrix, in one native control both forms reuse.
 * `actorRole` is the signed-in member's: an admin "cannot grant owner", so
 * the option is not offered rather than refused on submit.
 */
export function RoleSelect({
  actorRole,
  className,
  ...props
}: React.ComponentProps<"select"> & { actorRole: OrgRole }) {
  return (
    <select
      {...props}
      className={cn(SELECT_CLASS, className)}
    >
      <option value="member">Member</option>
      <option value="admin">Admin</option>
      {actorRole === "owner" ? <option value="owner">Owner</option> : null}
    </select>
  );
}
