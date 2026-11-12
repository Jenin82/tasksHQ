"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_ERROR, type ActionState } from "@/lib/action-result";

export function RenameOrgForm({
  name,
  action,
}: {
  name: string;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, submit, pending] = useActionState(action, NO_ERROR);

  return (
    <form action={submit} className="mt-5">
      <Label htmlFor="organization-name" className="stutter">
        Organization name
      </Label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Input
          id="organization-name"
          name="name"
          required
          defaultValue={state.values?.name ?? name}
          readOnly={pending}
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "organization-name-error" : undefined}
          className="max-w-sm"
        />
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save name"}</Button>
      </div>
      {state.error ? (
        <p id="organization-name-error" role="alert" className="mt-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : state.values && !pending ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">Organization name saved.</p>
      ) : null}
    </form>
  );
}
