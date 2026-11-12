"use client";

import { startTransition, useActionState, useState } from "react";
import type { Status } from "@tasks/core/schema";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_ERROR } from "@/lib/action-result";
import {
  SELECT_CLASS,
  STATUS_PALETTE,
  statusDot,
} from "@/lib/status-style";
import { cn } from "@/lib/utils";
import {
  createStatusAction,
  deleteStatusAction,
  recolorStatusAction,
  renameStatusAction,
  reorderStatusAction,
} from "./actions";

export type SettingsStatus = Pick<Status, "id" | "name" | "color"> & {
  /**
   * Every task pointing at this status, archived ones included — the same set
   * `deleteStatus` counts, so the number shown is the number that blocks.
   */
  taskCount: number;
};

type StatusColor = NonNullable<Status["color"]>;
const colors = Object.keys(STATUS_PALETTE) as StatusColor[];

function Count({ value }: { value: number }) {
  // §7.1: the count gets its own right-aligned column with whitespace as the
  // only separator — never `Todo (5)`, never a divider.
  return (
    <span className="stutter numeral w-20 shrink-0 text-right">
      {value} {value === 1 ? "task" : "tasks"}
    </span>
  );
}

export function StatusColorPicker({
  color,
  label,
  pending,
  onSelect,
}: {
  color: Status["color"];
  label: string;
  pending: boolean;
  onSelect: (color: StatusColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = color ?? "gray";
  const swatch = STATUS_PALETTE[current];

  return (
    <DropdownMenu open={open} onOpenChange={(next) => { if (!next || !pending) setOpen(next); }}>
      <DropdownMenuTrigger
        aria-label={`${label}: ${swatch.label}`}
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-border outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-foreground/5"
      >
        <span aria-hidden className={cn("size-2.5 rounded-full", swatch.dot)} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        <DropdownMenuRadioGroup value={current}>
          {colors.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              disabled={pending}
              onSelect={() => onSelect(option)}
            >
              <span aria-hidden className={cn("size-2.5 rounded-full", STATUS_PALETTE[option].dot)} />
              {STATUS_PALETTE[option].label}
              {option === current && <Check aria-hidden className="ml-auto size-3.5" />}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusRow({
  orgSlug,
  projectSlug,
  statuses,
  index,
}: {
  orgSlug: string;
  projectSlug: string;
  statuses: SettingsStatus[];
  index: number;
}) {
  const status = statuses[index];
  const others = statuses.filter((s) => s.id !== status.id);
  // The only status, holding tasks: there is nowhere to move them to.
  const stranded = status.taskCount > 0 && others.length === 0;

  const [renameState, rename] = useActionState(renameStatusAction, NO_ERROR);
  const [colorState, recolor, recoloring] = useActionState(
    recolorStatusAction,
    NO_ERROR,
  );
  const [reorderState, reorder, reordering] = useActionState(
    reorderStatusAction,
    NO_ERROR,
  );
  const [deleteState, remove, deleting] = useActionState(
    deleteStatusAction,
    NO_ERROR,
  );
  const [confirming, setConfirming] = useState(false);

  // Each action keeps its last result until it runs again, so merging them
  // would leave a stale refusal on screen after a later, different action
  // succeeded. Only the most recently submitted one speaks.
  const states = {
    rename: renameState,
    color: colorState,
    reorder: reorderState,
    delete: deleteState,
  };
  const [last, setLast] = useState<keyof typeof states | null>(null);
  const error = last ? states[last].error : undefined;

  const ids = (
    <>
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="project" value={projectSlug} />
      <input type="hidden" name="statusId" value={status.id} />
    </>
  );

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <StatusColorPicker
          color={status.color}
          label={`Color of ${status.name}`}
          pending={recoloring}
          onSelect={(color) => {
            const data = new FormData();
            data.set("org", orgSlug);
            data.set("project", projectSlug);
            data.set("statusId", status.id);
            data.set("color", color);
            setLast("color");
            startTransition(() => recolor(data));
          }}
        />

        <form
          action={rename}
          onSubmit={() => setLast("rename")}
          className="min-w-28 flex-1"
        >
          {ids}
          <Input
            // React 19 resets an uncontrolled form once its action settles,
            // back to the defaultValue it mounted with; keying on the name
            // remounts once the server reports the new one (§17).
            key={status.name}
            name="name"
            required
            defaultValue={renameState.values?.name ?? status.name}
            aria-label={`Name of ${status.name}`}
            className="h-8 bg-transparent px-2 shadow-none hover:bg-input"
            onBlur={(event) => {
              // `requestSubmit` runs constraint validation, and `required`
              // on an empty field focuses it back — trapping anyone who
              // clears the name and clicks away. Restore instead.
              if (!event.currentTarget.value.trim()) {
                event.currentTarget.value = status.name;
                return;
              }
              // `|| renameState.error`: typing a refused name back to the
              // original is otherwise a no-op that leaves the refusal on
              // screen. `renameStatus` returns early when nothing changed.
              if (event.currentTarget.value !== status.name || renameState.error) {
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </form>

        <Count value={status.taskCount} />

        <div className="flex shrink-0 items-center gap-1">
          {/* Up and down are the same move with a different neighbour, so one
              form carries both: `after` is the status this one lands behind,
              empty for first. Moving up means landing behind the row two
              above, which is why the list is rendered in `(position, id)` —
              the same order `reorderStatus` reads its siblings in.
              Both are disabled while a move is in flight: the neighbour ids
              come from props, and a second click before the new tree arrives
              would carry the stale ones. */}
          <form
            action={reorder}
            onSubmit={() => setLast("reorder")}
            className="flex items-center gap-1"
          >
            {ids}
            <Button
              type="submit"
              name="after"
              value={index >= 2 ? statuses[index - 2].id : ""}
              variant="ghost"
              size="icon-sm"
              disabled={reordering || index === 0}
              aria-label={`Move ${status.name} up`}
            >
              <span aria-hidden>↑</span>
            </Button>
            <Button
              type="submit"
              name="after"
              value={statuses[index + 1]?.id ?? ""}
              variant="ghost"
              size="icon-sm"
              disabled={reordering || index === statuses.length - 1}
              aria-label={`Move ${status.name} down`}
            >
              <span aria-hidden>↓</span>
            </Button>
          </form>

          {confirming ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Delete ${status.name}`}
              onClick={() => setConfirming(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {confirming ? (
        <form
          action={remove}
          onSubmit={() => setLast("delete")}
          className="mt-3 flex flex-wrap items-end justify-end gap-3"
        >
          {ids}
          {/* §3: a status holding tasks cannot be deleted without a
              destination, so the destination is asked for before the delete
              rather than after a refusal. */}
          {stranded ? (
            // A required select with no options cannot submit — say so rather
            // than offer a delete that silently does nothing.
            <p className="text-sm text-muted-foreground">
              Add another status to move these tasks to first.
            </p>
          ) : status.taskCount > 0 ? (
            <span className="flex flex-col gap-2">
              {/* §7.3: a field label, not a sentence — the count is already
                  on this row, in its own column. */}
              <Label htmlFor={`move-${status.id}`} className="stutter">
                Move to
              </Label>
              <select
                id={`move-${status.id}`}
                name="moveTasksTo"
                required
                defaultValue=""
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  Choose a status
                </option>
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </span>
          ) : null}
          {stranded ? null : (
            <Button type="submit" variant="destructive" size="sm" disabled={deleting}>
              {deleting ? "Deleting" : status.taskCount > 0 ? "Move and delete" : "Delete"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function AddStatusForm({
  orgSlug,
  projectSlug,
}: {
  orgSlug: string;
  projectSlug: string;
}) {
  const [state, action, pending] = useActionState(createStatusAction, NO_ERROR);
  const [color, setColor] = useState<StatusColor>("gray");

  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="project" value={projectSlug} />
      <input type="hidden" name="color" value={color} />

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-2">
          <Label htmlFor="status-name" className="stutter">
            Name
          </Label>
          <Input
            id="status-name"
            name="name"
            required
            placeholder="In Review"
            defaultValue={state.values?.name}
          />
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="stutter">Color</span>
          <StatusColorPicker color={color} label="New status color" pending={pending} onSelect={setColor} />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Adding" : "Add status"}
        </Button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * §4.10's statuses section. `canManage` is `project:manage_statuses` from
 * §3's one matrix: without it this renders the list and no control at all,
 * rather than controls that refuse on submit.
 */
export function StatusList({
  orgSlug,
  projectSlug,
  statuses,
  canManage,
}: {
  orgSlug: string;
  projectSlug: string;
  statuses: SettingsStatus[];
  canManage: boolean;
}) {
  // §16 lets the last status be deleted, so zero is reachable. The add form
  // has to survive that state or the project is stuck with no statuses and no
  // way to make one — `createTask` refuses, and the board has no columns.
  if (statuses.length === 0) {
    return (
      <>
        <p className="mt-6 text-base text-muted-foreground">
          This project has no statuses, so it can hold no tasks.
          {canManage
            ? " Add the first one below."
            : " An owner or an admin adds the first one."}
        </p>
        {canManage ? (
          <AddStatusForm orgSlug={orgSlug} projectSlug={projectSlug} />
        ) : null}
      </>
    );
  }

  return (
    <>
      <ul className="mt-6 divide-y divide-border border-y border-border">
        {canManage
          ? statuses.map((s, index) => (
              <StatusRow
                key={s.id}
                orgSlug={orgSlug}
                projectSlug={projectSlug}
                statuses={statuses}
                index={index}
              />
            ))
          : statuses.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-x-4 py-3"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    statusDot(s.color),
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <Count value={s.taskCount} />
              </li>
            ))}
      </ul>

      {canManage ? (
        <AddStatusForm orgSlug={orgSlug} projectSlug={projectSlug} />
      ) : null}
    </>
  );
}
