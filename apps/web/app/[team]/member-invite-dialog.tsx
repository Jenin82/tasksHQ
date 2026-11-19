"use client";

import { useActionState, useState } from "react";
import type { TeamRole } from "@tasks/core/access";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_ERROR, type ActionState } from "@/lib/action-result";
import { RoleSelect } from "./(team)/settings/members/role-select";

export function MemberInviteDialog({
  teamSlug,
  actorRole,
  inviteAction,
}: {
  teamSlug: string;
  actorRole: TeamRole;
  inviteAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [result, submit, pending] = useActionState<{ session: number; result: ActionState }, FormData>(
    async (_previous, formData: FormData) => {
      const result = await inviteAction(NO_ERROR, formData);
      if (!result.error) setOpen(false);
      return { session, result };
    },
    { session: 0, result: NO_ERROR },
  );
  const state = result.session === session ? result.result : NO_ERROR;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        if (nextOpen) setSession((current) => current + 1);
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Invite</Button>
      </DialogTrigger>
      <DialogContent closeDisabled={pending}>
        <DialogTitle>Invite to team</DialogTitle>
        <DialogDescription>
          The recipient can access all projects after signing in with the invited address.
        </DialogDescription>
        <form key={session} action={submit} className="mt-5 flex flex-col gap-4">
          <input type="hidden" name="team" value={teamSlug} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="team-invite-email">Email</Label>
            <Input
              id="team-invite-email"
              name="email"
              type="email"
              required
              maxLength={254}
              placeholder="someone@example.com"
              defaultValue={state.values?.email}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-role">Role</Label>
            <RoleSelect
              id="invite-role"
              name="role"
              defaultValue={state.values?.role ?? "member"}
              actorRole={actorRole}
            />
          </div>
          {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Inviting…" : "Invite"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
