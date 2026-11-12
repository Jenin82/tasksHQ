"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NO_ERROR } from "@/lib/action-result";
import type { TaskFieldsIds } from "../[task]/task-fields";
import { deleteArchivedTaskAction } from "./actions";

type DeleteTaskProps = { ids: TaskFieldsIds; taskKey: string; title: string };

export function DeleteTaskButton(props: DeleteTaskProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (pending) return;
      if (next) list.current = trigger.current?.closest<HTMLElement>("[data-task-list]") ?? null;
      setOpen(next);
    }}>
      <DialogTrigger asChild>
        <Button ref={trigger} type="button" size="sm" variant="outline">Delete permanently</Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        closeDisabled={pending}
        onCloseAutoFocus={(event) => {
          if (!trigger.current?.isConnected) {
            event.preventDefault();
            list.current?.focus();
          }
        }}
      >
        <DialogTitle className="pr-8">Delete {props.taskKey} permanently?</DialogTitle>
        <DialogDescription>
          <strong className="font-medium text-foreground wrap-anywhere">{props.title}</strong>
          {" and its comments and activity history will be deleted. This cannot be undone."}
        </DialogDescription>
        {open && (
          <ConfirmDeleteTask
            {...props}
            close={() => setOpen(false)}
            onPendingChange={setPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDeleteTask({ ids, taskKey, close, onPendingChange }: DeleteTaskProps & {
  close: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const id = useId();
  const [state, submit, pending] = useActionState(async (previous: typeof NO_ERROR, form: FormData) => {
    onPendingChange(true);
    try {
      const next = await deleteArchivedTaskAction(ids.orgSlug, ids.projectSlug, ids.taskId, previous, form);
      if (!next.error) close();
      return next;
    } finally {
      onPendingChange(false);
    }
  }, NO_ERROR);

  return (
    <form action={submit} className="mt-5">
      <label htmlFor={id} className="block text-sm">
        Type <span className="font-mono numeral">{taskKey}</span> to confirm.
      </label>
      <Input
        id={id}
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
        aria-describedby={state.error ? `${id}-error` : undefined}
      />
      {state.error && <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-destructive">{state.error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={close} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={pending || value !== taskKey}>
          {pending ? "Deleting…" : "Delete permanently"}
        </Button>
      </div>
    </form>
  );
}
