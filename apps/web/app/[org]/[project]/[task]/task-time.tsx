"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
} from "../../time-actions";
import type { TaskTimePayload } from "./time/route";

type TaskTimeData = {
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
export function TaskTime({ orgSlug, projectSlug, taskKey }: TimeTaskTarget) {
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
      const response = await fetch(`/${orgSlug}/${projectSlug}/${taskKey}/time`, {
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
  }, [orgSlug, projectSlug, taskKey]);

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);
  useTimeChange(load);

  const target = { orgSlug, projectSlug, taskKey };

  return (
    <div className="mt-6 border-t border-border pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="stutter">Time</h3>
        <p className="text-xs text-muted-foreground">
          {data ? <TimeTotals data={data} /> : failed ? "Couldn’t load time." : "Loading…"}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={data?.runningSince ? "Stop timer" : undefined}
          disabled={!data || pending}
          onClick={() => startTransition(async () => {
            const result = data?.runningSince ? await stopTimerAction() : await startTimerAction(target);
            setError(result.error);
            notifyTimeChange();
          })}
        >
          {data?.runningSince ? <>Stop <span aria-hidden><RunningClock since={data.runningSince} /></span></> : "Start timer"}
        </Button>
        <TimeEntryPopover
          label="Add time"
          trigger={
            <Button type="button" variant="ghost" size="sm" disabled={!data}>
              <Plus aria-hidden /> Add time
            </Button>
          }
          timeZone={timeZone}
          submitLabel="Add time"
          onSubmit={(values) => createTimeEntryAction(target, { ...values, startedAt: values.startedAt!, endedAt: values.endedAt! })}
        />
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {data && data.entries.length > 0 && (
        <ul className="mt-2 divide-y divide-border/50">
          {data.entries.map((entry) => <TimeEntryItem key={entry.id} entry={entry} timeZone={timeZone} />)}
        </ul>
      )}
      {data?.more && (
        <Link href={`/${orgSlug}/settings/your-time`} prefetch={false} className="mt-2 inline-block rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          See all in Your Time
        </Link>
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
      Logged <span suppressHydrationWarning className="numeral text-foreground">{formatDuration(data.totalMs + live)}</span>
      {" · "}You <span suppressHydrationWarning className="numeral text-foreground">{formatDuration(data.mineMs + live)}</span>
    </>
  );
}
