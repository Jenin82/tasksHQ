"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { NO_ERROR } from "@/lib/action-result";
import { SELECT_CLASS } from "@/lib/status-style";
import { setProjectMemberRoleAction } from "./actions";

type Person = { userId: string; name: string; email: string };
type Project = { orgSlug: string; projectSlug: string };

function RevokeProjectAdmin({ orgSlug, projectSlug, person }: Project & { person: Person }) {
  const [state, revoke, pending] = useActionState(setProjectMemberRoleAction, NO_ERROR);

  return (
    <form action={revoke} className="flex flex-col items-end gap-2">
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="project" value={projectSlug} />
      <input type="hidden" name="userId" value={person.userId} />
      <input type="hidden" name="role" value="member" />
      <Button type="submit" variant="ghost" size="sm" disabled={pending} aria-label={`Revoke admin access for ${person.name}`}>
        {pending ? "Revoking" : "Revoke admin access"}
      </Button>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

function GrantProjectAdmin({ orgSlug, projectSlug, candidates }: Project & { candidates: Person[] }) {
  const [state, grant, pending] = useActionState(setProjectMemberRoleAction, NO_ERROR);

  return (
    <form action={grant} className="mt-4 flex flex-wrap items-center gap-2">
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="project" value={projectSlug} />
      <input type="hidden" name="role" value="admin" />
      <select
        name="userId"
        aria-label="Organization member to grant project admin access"
        className={`${SELECT_CLASS} max-w-full min-w-0`}
        defaultValue={state.values?.userId ?? ""}
        disabled={pending}
        required
      >
        <option value="" disabled>Choose a member</option>
        {candidates.map(({ userId, name, email }) => <option key={userId} value={userId}>{name} ({email})</option>)}
      </select>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Granting" : "Grant admin access"}
      </Button>
      {state.error && <p role="alert" className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

export function ProjectAdminList({ orgSlug, projectSlug, admins, candidates, canManage }: Project & {
  admins: Person[];
  candidates: Person[];
  canManage: boolean;
}) {
  return (
    <>
      {admins.length ? (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {admins.map((person) => (
            <li key={person.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate">{person.name}</p>
                <p className="truncate text-sm text-muted-foreground">{person.email}</p>
              </div>
              {canManage && <RevokeProjectAdmin orgSlug={orgSlug} projectSlug={projectSlug} person={person} />}
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-sm text-muted-foreground">No project admins assigned.</p>}
      {candidates.length > 0 && <GrantProjectAdmin orgSlug={orgSlug} projectSlug={projectSlug} candidates={candidates} />}
    </>
  );
}
