"use client";

import { useActionState, useId } from "react";
import { NO_ERROR } from "@/lib/action-result";
import { setProjectTaskEditRestrictionAction } from "./actions";

export function TaskEditingSettings({ orgSlug, projectSlug, restricted }: {
  orgSlug: string;
  projectSlug: string;
  restricted: boolean;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const [state, submit, pending] = useActionState(
    setProjectTaskEditRestrictionAction.bind(null, orgSlug, projectSlug),
    NO_ERROR,
  );

  return (
    <section className="mb-8 rounded-2xl bg-card p-6 shadow-subtle">
      <h2 className="text-xl">Task editing</h2>
      <form action={submit} className="mt-4 border-t border-border pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p id={labelId} className="text-sm font-medium">Restrict task editing</p>
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              Admins, the task’s creator, its reporter, and its current assignee can edit. Other members can still create tasks and comment.
            </p>
          </div>
          <button
            type="submit"
            name="restricted"
            value={String(!restricted)}
            role="switch"
            aria-checked={restricted}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            disabled={pending}
            className="group relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <span aria-hidden className="relative inline-flex h-6 w-11 items-center rounded-full border border-border bg-input transition-colors group-aria-checked:bg-primary motion-reduce:transition-none">
              <span className="absolute left-0.5 size-4 rounded-full bg-foreground transition-transform group-aria-checked:translate-x-5 group-aria-checked:bg-white motion-reduce:transition-none" />
            </span>
          </button>
        </div>
        {pending && <p role="status" className="mt-2 text-sm text-muted-foreground">Saving…</p>}
        {state.error && <p role="alert" className="mt-2 text-sm text-destructive">{state.error}</p>}
      </form>
    </section>
  );
}
