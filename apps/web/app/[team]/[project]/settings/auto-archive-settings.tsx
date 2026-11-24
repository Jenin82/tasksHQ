"use client";

import { useActionState, useId } from "react";
import { NO_ERROR } from "@/lib/action-result";
import { setProjectAutoArchiveAction } from "./actions";

export function AutoArchiveSettings({ teamSlug, projectSlug, statuses, currentStatusId, currentDays }: {
  teamSlug: string;
  projectSlug: string;
  statuses: { id: string; name: string }[];
  currentStatusId: string | null;
  currentDays: number;
}) {
  const statusFieldId = useId();
  const daysFieldId = useId();
  const [state, submit, pending] = useActionState(
    setProjectAutoArchiveAction.bind(null, teamSlug, projectSlug),
    NO_ERROR,
  );

  return (
    <section className="mb-8 rounded-2xl bg-card p-6 shadow-subtle">
      <h2 className="text-xl">Auto-archive</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Tasks that sit in the chosen status for this many days are archived automatically. Set the status to “Don’t auto-archive” to turn it off.
      </p>
      <form action={submit} className="mt-4 border-t border-border pt-4 space-y-4">
        <div>
          <label htmlFor={statusFieldId} className="text-sm font-medium">Archive from status</label>
          <select
            id={statusFieldId}
            name="statusId"
            defaultValue={statuses.some((s) => s.id === currentStatusId) ? currentStatusId! : ""}
            className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
          >
            <option value="">Don’t auto-archive</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={daysFieldId} className="text-sm font-medium">Days</label>
          <input
            id={daysFieldId}
            type="number"
            name="days"
            defaultValue={currentDays}
            min={1}
            max={365}
            step={1}
            className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          Save
        </button>
        {pending && <p role="status" className="mt-2 text-sm text-muted-foreground">Saving…</p>}
        {state.error && <p role="alert" className="mt-2 text-sm text-destructive">{state.error}</p>}
      </form>
    </section>
  );
}
