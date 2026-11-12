"use client";

import { Plus } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { NO_ERROR } from "@/lib/action-result";
import { useOpenTaskDialog } from "./task-dialog-context";
import { createTaskAction, type CreateTaskState } from "./actions";

type Target = {
  orgSlug: string;
  projectSlug: string;
  statusId: string;
  statusName: string;
};

export function AddTask(target: Target) {
  const [open, setOpen] = useState(false);
  // Escape hands focus back to the button; a blur-collapse does not steal it.
  const [refocus, setRefocus] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        autoFocus={refocus}
        onClick={() => setOpen(true)}
        aria-label={`New work item in ${target.statusName}`}
        className="flex min-h-9 w-full items-center gap-2 rounded-lg bg-muted px-2.5 text-left text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-opacity [@media(hover:hover)]:opacity-0 group-hover/status:opacity-100 group-focus-within/status:opacity-100"
      >
        <Plus aria-hidden className="size-4 shrink-0" />
        New work item
      </button>
    );
  }

  return (
    <Composer
      {...target}
      onClose={(viaEscape) => {
        setRefocus(viaEscape);
        setOpen(false);
      }}
    />
  );
}

function Composer({
  orgSlug,
  projectSlug,
  statusId,
  statusName,
  onClose,
}: Target & { onClose: (viaEscape: boolean) => void }) {
  const openTask = useOpenTaskDialog();
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (previous: CreateTaskState, data: FormData) => {
    const next = await createTaskAction(previous, data);
    const list = form.current?.closest<HTMLElement>("[data-task-list]");
    if (next.task && list && openTask) {
      onClose(false);
      openTask(next.task, list);
    }
    return next;
  }, NO_ERROR);
  const input = useRef<HTMLInputElement>(null);

  // Disabling the input while pending drops its focus; take it back when the
  // submit settles so the next title can be typed straight away.
  useEffect(() => {
    if (!pending) input.current?.focus();
  }, [pending]);

  return (
    <form ref={form} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="project" value={projectSlug} />
      <input type="hidden" name="statusId" value={statusId} />
      <Input
        ref={input}
        name="title"
        required
        autoFocus
        aria-label={`New task in ${statusName}`}
        placeholder="Task title"
        defaultValue={state.values?.title}
        disabled={pending}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose(true);
        }}
        onBlur={(event) => {
          if (!pending && event.currentTarget.value.trim() === "") {
            onClose(false);
          }
        }}
      />
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
