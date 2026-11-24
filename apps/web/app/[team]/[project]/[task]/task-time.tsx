"use client";

import Link from "next/link";
import { ChevronDown, Play, Plus, Square } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { cn } from "cn";
import { STALE_MS } from "@tasks/core/schema";
import { notifyTimeChange, RunningClock, TimeEntryItem, TimeEntryPopover, useNow, useTimeChange } from "@/components/time-tracking";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { browserTimeZone } from "@/lib/time-zone";
import {
  createTimeEntryAction,
  startTimerAction,
  stopTimerAction,
  type TaskTimeEntry,
  type TimeTaskTarget,
} from "@/app/time-actions";
import type { TaskTimePayload } from "./time/route";

const ENTRIES_KEY = "tasks:task-time-entries-open";

type TaskTimeData = {
  viewerId: string;
  totalMs: number;
  mineMs: number;
  runningSince: Date | null;
  entries: TaskTimeEntry[];
  more: boolean;
  /** When the totals were read, so the client can add what a running timer has added since. */
  loadedAt: number;
};

function decode(payload: TaskTimePayload): TaskTimeData {
  return {
    ...payload,
    runningSince: payload.runningSince ? new Date(payload.runningSince) : null,
    entries: payload.entries.map((entry) => ({
      ...entry,
      startedAt: new Date(entry.startedAt),
      endedAt: entry.endedAt ? new Date(entry.endedAt) : null,
    })),
    loadedAt: Date.now(),
  };
}

/**
 * The task panel's Time block. Totals and the viewer's entries are read on
 * demand, never from the list snapshot. Every member can track time, so this
 * does not depend on edit rights; archived tasks do not render it.
 */
export function TaskTime({ teamSlug, projectSlug, taskKey }: TimeTaskTarget) {
  const [data, setData] = useState<TaskTimeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [timeZone] = useState(browserTimeZone);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(`/${teamSlug}/${projectSlug}/${taskKey}/time`, {
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new Error("Task time unavailable");
      const next = decode(await response.json() as TaskTimePayload);
      if (!controller.signal.aborted) {
        setData(next);
        setFailed(false);
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    }
  }, [teamSlug, projectSlug, taskKey]);

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);
  useTimeChange(load);

  const target = { teamSlug, projectSlug, taskKey };
  const [showEntries, setShowEntries] = useState(false);
  // Remembered in this browser, like the sidebar's collapses.
  useEffect(() => {
    try {
      setShowEntries(localStorage.getItem(ENTRIES_KEY) === "true");
    } catch {
      // Starts closed when browser storage is unavailable.
    }
  }, []);
  function toggleEntries() {
    const next = !showEntries;
    setShowEntries(next);
    try {
      localStorage.setItem(ENTRIES_KEY, String(next));
    } catch {
      // The toggle still works for this page.
    }
  }
  const entriesId = useId();

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {data ? <TimeTotals data={data} /> : failed ? "Couldn’t load time." : "Loading…"}
      </p>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        aria-label={data?.runningSince ? "Stop timer" : undefined}
        disabled={!data || pending}
        onClick={() => startTransition(async () => {
          const result = data?.runningSince ? await stopTimerAction() : await startTimerAction(target);
          setError(result.error);
          notifyTimeChange();
        })}
      >
        {data?.runningSince
          ? <><Square aria-hidden className="size-3 fill-current" /> Stop <RunningClock aria-hidden since={data.runningSince} /></>
          : <><Play aria-hidden className="size-3 fill-current" /> Start timer</>}
      </Button>
      <div className="flex items-center justify-between gap-2">
        <TimeEntryPopover
          label="Add time"
          align="start"
          trigger={
            <Button type="button" variant="ghost" size="sm" className="-ml-3" disabled={!data}>
              <Plus aria-hidden /> Add time
            </Button>
          }
          timeZone={timeZone}
          submitLabel="Add time"
          onSubmit={(values) => createTimeEntryAction(target, { ...values, startedAt: values.startedAt!, endedAt: values.endedAt! })}
        />
        {data && data.entries.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-3"
            aria-expanded={showEntries}
            aria-controls={entriesId}
            onClick={toggleEntries}
          >
            Your entries
            <ChevronDown aria-hidden className={cn("transition-transform", showEntries && "rotate-180")} />
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {/* Collapsed by default so the timer stays the focus of the block. */}
      {showEntries && data && data.entries.length > 0 && (
        <div id={entriesId} className="flex flex-col gap-2">
          <ul className="divide-y divide-border/50">
            {data.entries.map((entry) => <TimeEntryItem key={entry.id} entry={entry} timeZone={timeZone} />)}
          </ul>
          {data.more && (
            <Link href={`/settings/time?${new URLSearchParams({ people: data.viewerId })}`} prefetch={false} className="self-start rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              See all in Time
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Totals as read, plus what the viewer's running timer has added since, capped as the stop paths cap it. */
function TimeTotals({ data }: { data: TaskTimeData }) {
  const now = useNow();
  const since = data.runningSince?.getTime();
  const live = since === undefined ? 0
    : Math.max(0, Math.min(now, since + STALE_MS) - Math.min(data.loadedAt, since + STALE_MS));
  return (
    <>
      <span>Logged <span suppressHydrationWarning className="numeral text-foreground">{formatDuration(data.totalMs + live)}</span></span>
      <span>You <span suppressHydrationWarning className="numeral text-foreground">{formatDuration(data.mineMs + live)}</span></span>
    </>
  );
}
