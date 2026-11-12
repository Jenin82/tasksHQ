"use client";

import { useActionState, useRef, useState } from "react";
import type { OrgRole } from "@tasks/core/access";
import { Button } from "@/components/ui/button";
import { NO_ERROR } from "@/lib/action-result";
import { changeMemberRoleAction, removeMemberAction, revokeMemberInviteAction } from "./actions";
import { RoleSelect } from "./role-select";

export function RevokeMemberInvite({ orgSlug, email }: { orgSlug: string; email: string }) {
  const [state, revoke, pending] = useActionState(revokeMemberInviteAction, NO_ERROR);
  return (
    <form action={revoke}>
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="email" value={email} />
      <Button variant="ghost" size="sm" disabled={pending} aria-label={`Revoke invitation for ${email}`}>
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

export function MemberControls({
  orgSlug,
  userId,
  role,
  name,
  actorRole,
}: {
  orgSlug: string;
  userId: string;
  role: string;
  name: string;
  actorRole: OrgRole;
}) {
  const roleForm = useRef<HTMLFormElement>(null);
  const [roleState, changeRole, changing] = useActionState(
    changeMemberRoleAction,
    NO_ERROR,
  );
  const [removeState, remove, removing] = useActionState(
    removeMemberAction,
    NO_ERROR,
  );
  const [confirming, setConfirming] = useState(false);

  const error = roleState.error ?? removeState.error;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <form ref={roleForm} action={changeRole}>
          <input type="hidden" name="org" value={orgSlug} />
          <input type="hidden" name="userId" value={userId} />
          <RoleSelect
            // React resets the form once the action settles, back to the
            // defaultValue it was mounted with. Keying on the role remounts
            // the control when the server reports the new one, so a saved
            // change does not snap back to the old value.
            key={role}
            actorRole={actorRole}
            name="role"
            defaultValue={role}
            disabled={changing}
            aria-label={`Role for ${name}`}
            onChange={() => roleForm.current?.requestSubmit()}
          />
        </form>

        {confirming ? (
          <form action={remove} className="flex items-center gap-1">
            <input type="hidden" name="org" value={orgSlug} />
            <input type="hidden" name="userId" value={userId} />
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={removing}
            >
              {removing ? "Removing" : "Confirm removal"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={removing}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        )}
      </div>

      {error ? (
        <p role="alert" className="max-w-sm text-right text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
