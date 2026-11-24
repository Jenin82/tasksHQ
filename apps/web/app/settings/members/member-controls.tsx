"use client";

import { useActionState, useRef, useState } from "react";
import type { OrgRole } from "@tasks/core/schema";
import { Button } from "@/components/ui/button";
import { NO_ERROR } from "@/lib/action-result";
import { RoleSelect, orgRoleOptions } from "@/app/[team]/(team)/settings/members/role-select";
import { changeOrgMemberRoleAction, removeOrgMemberAction, revokeOrgInviteAction } from "./actions";

export function RevokeOrgInvite({ email }: { email: string }) {
  const [state, revoke, pending] = useActionState(revokeOrgInviteAction, NO_ERROR);
  return (
    <form action={revoke}>
      <input type="hidden" name="email" value={email} />
      <Button variant="ghost" size="sm" disabled={pending} aria-label={`Revoke invitation for ${email}`}>
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

// As the team's MemberControls, against the org actions.
export function OrgMemberControls({ userId, role, name, actorRole }: {
  userId: string;
  role: OrgRole;
  name: string;
  actorRole: OrgRole;
}) {
  const roleForm = useRef<HTMLFormElement>(null);
  const [roleState, changeRole, changing] = useActionState(changeOrgMemberRoleAction, NO_ERROR);
  const [removeState, remove, removing] = useActionState(removeOrgMemberAction, NO_ERROR);
  const [confirming, setConfirming] = useState(false);
  const error = roleState.error ?? removeState.error;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <form ref={roleForm} action={changeRole}>
          <input type="hidden" name="userId" value={userId} />
          {/* Keyed on the role so a saved change does not snap back on form reset. */}
          <RoleSelect
            key={role}
            options={orgRoleOptions(actorRole)}
            name="role"
            defaultValue={role}
            disabled={changing}
            aria-label={`Role for ${name}`}
            onChange={() => roleForm.current?.requestSubmit()}
          />
        </form>
        {confirming ? (
          <form action={remove} className="flex items-center gap-1">
            <input type="hidden" name="userId" value={userId} />
            <Button type="submit" variant="destructive" size="sm" disabled={removing}>
              {removing ? "Removing" : "Confirm removal"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={removing} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
      {error ? <p role="alert" className="max-w-sm text-right text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
