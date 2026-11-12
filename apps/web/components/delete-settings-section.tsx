"use client";

import { useActionState, useId, useState } from "react";
import { NO_ERROR, type ActionState } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type DeleteProps = {
  resource: "organization" | "project";
  name: string;
  slug: string;
  description: string;
  action: (state: ActionState, data: FormData) => Promise<ActionState>;
};

export function DeleteSettingsSection(props: DeleteProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const headingId = useId();
  const label = `Delete ${props.resource}`;

  return (
    <section aria-labelledby={headingId} className="mt-8 rounded-2xl bg-card p-6 shadow-subtle">
      <h2 id={headingId} className="text-xl">{label}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{props.description}</p>
      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
        <DialogTrigger asChild>
          <Button className="mt-5" variant="outline">{label}</Button>
        </DialogTrigger>
        <DialogContent closeDisabled={pending} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogTitle className="pr-8">{label}?</DialogTitle>
          <DialogDescription>
            <strong className="wrap-break-word font-medium text-foreground">{props.name}</strong>
            {" will be permanently deleted. "}{props.description}
          </DialogDescription>
          {open && (
            <DeleteForm
              {...props}
              onCancel={() => setOpen(false)}
              onPendingChange={setPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DeleteForm({
  action,
  slug,
  resource,
  onCancel,
  onPendingChange,
}: DeleteProps & { onCancel: () => void; onPendingChange: (pending: boolean) => void }) {
  const [value, setValue] = useState("");
  const inputId = useId();
  const errorId = useId();
  const [state, submit, pending] = useActionState(async (prev: ActionState, data: FormData) => {
    onPendingChange(true);
    try {
      return await action(prev, data);
    } finally {
      onPendingChange(false);
    }
  }, NO_ERROR);

  return (
    <form action={submit} className="mt-5">
      <label htmlFor={inputId} className="block text-sm">
        Type <span className="wrap-break-word font-mono">{slug}</span> to confirm.
      </label>
      <Input
        id={inputId}
        name="confirmation"
        className="mt-2"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        readOnly={pending}
        required
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={Boolean(state.error)}
        aria-describedby={state.error ? errorId : undefined}
      />
      {state.error && <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">{state.error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={pending || value !== slug}>
          {pending ? "Deleting…" : `Delete ${resource}`}
        </Button>
      </div>
    </form>
  );
}
