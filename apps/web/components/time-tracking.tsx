"use client";

import { useEffect, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { Pencil, Square, Trash2 } from "lucide-react";
import type { RunningTimer } from "@tasks/core/domain";
import { STALE_MS } from "@tasks/core/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ActionState } from "@/lib/action-result";
import { formatClock, formatDuration } from "@/lib/format";
import { addDays, browserTimeZone, zonedTime, zonedWallTime } from "@/lib/time-zone";
import { cn } from "@/lib/utils";
import { deleteTimeEntryAction, stopTimerAction, updateTimeEntryAction, type TaskTimeEntry } from "@/app/[org]/time-actions";

/**
 * Timer controls live in the top bar, the task panel and Your time. Each
 * mutation revalidates the server trees; this event also tells task panels,
 * whose time data is client state, to read it again.
 */
const TIME_CHANGED = "taskshq:time-changed";

export function notifyTimeChange() {
  window.dispatchEvent(new Event(TIME_CHANGED));
}

export function useTimeChange(callback: () => void) {
  useEffect(() => {
    window.addEventListener(TIME_CHANGED, callback);
    return () => window.removeEventListener(TIME_CHANGED, callback);
  }, [callback]);
}

/** Ticks once a second; the server and first client render may differ, so callers suppress that warning. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Capped where every stop path caps a running entry, so a timer the sweep has not reached yet stops counting. */
export function RunningClock({ since, ...props }: { since: Date } & ComponentProps<"span">) {
  const now = useNow();
  return (
    <span suppressHydrationWarning className="numeral" {...props}>
      {formatClock(Math.min(now - since.getTime(), STALE_MS))}
    </span>
  );
}

/** The running timer, which can belong to another organization, so it links with its own slugs. */
export function RunningTimerChip({ timer }: { timer: RunningTimer }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="relative flex h-8 shrink-0 items-center rounded-full bg-input text-sm">
      <Link
        href={`/${timer.orgSlug}/${timer.projectSlug}/${timer.key}`}
        prefetch={false}
        title={timer.title}
        aria-label={"Timer running on " + timer.key}
        className="relative flex h-full items-center gap-2 rounded-l-full pl-3 pr-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-foreground" />
        <span aria-hidden className="stutter numeral hidden sm:inline">{timer.key}</span>
        <RunningClock aria-hidden since={timer.startedAt} />
      </Link>
      <button
        type="button"
        aria-label="Stop timer"
        title={error}
        disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await stopTimerAction();
          setError(result.error);
          notifyTimeChange();
        })}
        className="grid h-full w-8 place-items-center rounded-r-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <Square aria-hidden className="size-3 fill-current" />
      </button>
      {error && <span role="alert" className="sr-only">{error}</span>}
    </div>
  );
}

export type TimeEntryValues = { startedAt?: string; endedAt?: string; note: string };

/**
 * Date, start, end and note, read in `timeZone` (the zone the surrounding list
 * shows) and sent as ISO instants. An end earlier than the start runs past
 * midnight. A running entry has no end to set. The fields hold minutes, so an
 * edit sends a time only when it differs from the stored one at that
 * precision; otherwise the stored seconds stay and the entry is not marked
 * edited.
 */
export function TimeEntryForm({ entry, timeZone, submitLabel, onSubmit, onDone, children }: {
  entry?: Pick<TaskTimeEntry, "startedAt" | "endedAt" | "note">;
  timeZone: string;
  submitLabel: string;
  onSubmit: (values: TimeEntryValues) => Promise<ActionState>;
  onDone: () => void;
  children?: ReactNode;
}) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const running = entry !== undefined && entry.endedAt === null;
  const start = zonedWallTime((entry?.startedAt ?? new Date()).getTime(), timeZone);
  const end = entry?.endedAt ? zonedWallTime(entry.endedAt.getTime(), timeZone) : undefined;
  // Compare as the fields show it (date and HH:MM), so a repeated DST hour never reads as a change.
  const changed = (typedDate: string, typedTime: string, typed: number, stored: Date | null | undefined) => {
    const wall = stored && zonedWallTime(stored.getTime(), timeZone);
    return !wall || wall.date !== typedDate || wall.time !== typedTime ? new Date(typed).toISOString() : undefined;
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const date = String(form.get("date"));
        const startTime = String(form.get("start"));
        const startedAt = zonedTime(date, startTime, timeZone);
        let endedAt: number | undefined;
        let endDate = date;
        let endTime = "";
        if (!running) {
          endTime = String(form.get("end"));
          // An end before the start runs into the next day. An end equal to the
          // start does too only for a stored entry that already spans midnight (24h).
          const storedEnd = entry?.endedAt && zonedWallTime(entry.endedAt.getTime(), timeZone);
          if (endTime < startTime || (endTime === startTime && storedEnd && storedEnd.date !== start.date)) {
            endDate = addDays(date, 1);
          }
          endedAt = zonedTime(endDate, endTime, timeZone);
        }
        if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) {
          setError("Enter a date and times.");
          return;
        }
        startTransition(async () => {
          const result = await onSubmit({
            startedAt: changed(date, startTime, startedAt, entry?.startedAt),
            endedAt: endedAt === undefined ? undefined : changed(endDate, endTime, endedAt, entry?.endedAt),
            note: String(form.get("note") ?? ""),
          });
          setError(result.error);
          if (!result.error) {
            notifyTimeChange();
            onDone();
          }
        });
      }}
    >
      {children}
      <label className="block space-y-1.5 text-sm">
        <span className="stutter">Date</span>
        <Input type="date" name="date" required defaultValue={start.date} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1.5 text-sm">
          <span className="stutter">Start</span>
          <Input type="time" name="start" required defaultValue={entry ? start.time : undefined} />
        </label>
        {!running && (
          <label className="block space-y-1.5 text-sm">
            <span className="stutter">End</span>
            <Input type="time" name="end" required defaultValue={end?.time} />
          </label>
        )}
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="stutter">Note</span>
        <Input name="note" maxLength={500} placeholder="Optional" defaultValue={entry?.note ?? ""} />
      </label>
      {timeZone !== browserTimeZone() && <p className="text-xs text-muted-foreground">Times in {timeZone}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

/** A trigger and a popover around `TimeEntryForm`, closed once the save lands. */
export function TimeEntryPopover({ trigger, label, className, ...form }: {
  trigger: ReactNode;
  label: string;
  className?: string;
} & Omit<Parameters<typeof TimeEntryForm>[0], "onDone">) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent aria-label={label} align="end" collisionPadding={12} className={cn("z-[60] w-72 p-4", className)}>
        {open && <TimeEntryForm {...form} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One of the viewer's own entries. `timeZone` is the zone it is shown and
 * edited in.
 */
export function TimeEntryItem({ entry, timeZone, children }: {
  entry: TaskTimeEntry;
  timeZone: string;
  children?: ReactNode;
}) {
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  return (
    <li className="py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1 text-sm">
          {children}
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="stutter numeral">{day.format(entry.startedAt)}</span>
            <span className="numeral">
              {time.format(entry.startedAt)}–{entry.endedAt ? time.format(entry.endedAt) : "now"}
            </span>
            <span className="numeral text-muted-foreground">
              {entry.endedAt ? formatDuration(entry.endedAt.getTime() - entry.startedAt.getTime()) : "Running"}
            </span>
          </p>
          {(entry.autoStopped || entry.edited) && (
            <p className="mt-1 flex gap-2 text-xs text-muted-foreground">
              {entry.autoStopped && <span className="rounded-full bg-muted px-2 py-0.5">Auto-stopped</span>}
              {entry.edited && <span className="py-0.5">edited</span>}
            </p>
          )}
          {entry.note && <p className="mt-1 text-sm text-muted-foreground wrap-anywhere">{entry.note}</p>}
        </div>
        <TimeEntryPopover
          label="Edit time entry"
          trigger={
            <Button type="button" variant="ghost" size="icon" aria-label="Edit time entry" disabled={pending}>
              <Pencil aria-hidden />
            </Button>
          }
          entry={entry}
          timeZone={timeZone}
          submitLabel="Save"
          onSubmit={(values) => updateTimeEntryAction(entry.id, values)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Delete time entry"
          aria-expanded={confirming}
          disabled={pending}
          onClick={() => setConfirming((value) => !value)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {confirming && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
          <span className="mr-auto text-sm text-muted-foreground">Delete this entry?</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => startTransition(async () => {
              const result = await deleteTimeEntryAction(entry.id);
              setError(result.error);
              if (!result.error) notifyTimeChange();
            })}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
    </li>
  );
}
