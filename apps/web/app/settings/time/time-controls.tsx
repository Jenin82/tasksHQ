"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { TimeEntryItem, TimeEntryPopover } from "@/components/time-tracking";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { createTimeEntryAction, setTimezoneAction, type TaskTimeEntry } from "@/app/time-actions";

type ListedEntry = TaskTimeEntry & { key: string; title: string; teamName: string; href: string; editable: boolean };

export function TimeEntryList({ entries, timeZone }: { entries: ListedEntry[]; timeZone: string }) {
  return (
    <ul className="mt-2 divide-y divide-border/50">
      {entries.map(({ key, title, teamName, href, editable, ...entry }) => (
        <TimeEntryItem key={entry.id} entry={entry} timeZone={timeZone} readOnly={!editable}>
          <Link href={href} prefetch={false} className="mb-0.5 flex min-w-0 items-baseline gap-2 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            <span className="stutter numeral shrink-0">{key}</span>
            <span className="truncate">{title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{teamName}</span>
          </Link>
        </TimeEntryItem>
      ))}
    </ul>
  );
}

type FoundTask = { key: string; title: string; href: string; projectSlug: string };

/** Picks a team, then a task through that team's search route, then logs a manual entry on it. */
export function AddTimeEntry({ teams, timeZone }: { teams: { slug: string; name: string }[]; timeZone: string }) {
  const [teamSlug, setTeamSlug] = useState(teams[0].slug);
  const [task, setTask] = useState<FoundTask | null>(null);

  return (
    <TimeEntryPopover
      label="Add time"
      className="w-80"
      trigger={<Button type="button" className="rounded-md"><Plus aria-hidden /> Add time</Button>}
      timeZone={timeZone}
      submitLabel="Add time"
      onSubmit={async (values) => {
        if (!task) return { error: "Choose a task." };
        return createTimeEntryAction(
          { teamSlug, projectSlug: task.projectSlug, taskKey: task.key },
          { ...values, startedAt: values.startedAt!, endedAt: values.endedAt! },
        );
      }}
    >
      {teams.length > 1 && (
        <select
          aria-label="Team"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
          value={teamSlug}
          onChange={(event) => {
            setTeamSlug(event.currentTarget.value);
            setTask(null);
          }}
        >
          {teams.map(({ slug, name }) => <option key={slug} value={slug}>{name}</option>)}
        </select>
      )}
      {task ? (
        <div className="flex min-w-0 items-baseline gap-2 text-sm">
          <span className="stutter numeral shrink-0">{task.key}</span>
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setTask(null)}>Change</Button>
        </div>
      ) : <TaskSearch key={teamSlug} teamSlug={teamSlug} onSelect={setTask} />}
    </TimeEntryPopover>
  );
}

function TaskSearch({ teamSlug, onSelect }: { teamSlug: string; onSelect: (task: FoundTask) => void }) {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<{ query: string; tasks: FoundTask[] | null }>();
  const query = input.trim();

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(teamSlug)}/search?${new URLSearchParams({ q: query })}`, {
          signal: controller.signal,
        });
        if (!response.ok || response.redirected) throw new Error("Search failed");
        const { tasks } = await response.json() as { tasks: FoundTask[] };
        setResults({ query, tasks });
      } catch {
        if (!controller.signal.aborted) setResults({ query, tasks: null });
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [teamSlug, query]);

  const current = results?.query === query ? results : null;
  const message = !query ? "" : !current ? "Searching…" : !current.tasks ? "Search is unavailable." : current.tasks.length ? "" : "No matches.";

  return (
    <Command label="Task" shouldFilter={false} className="rounded-lg shadow-subtle-2">
      <CommandInput aria-label="Task" value={input} maxLength={100} onValueChange={setInput} placeholder="Search tasks…" />
      <CommandList className="max-h-48">
        {message && <CommandEmpty>{message}</CommandEmpty>}
        {current?.tasks?.map((found) => (
          <CommandItem key={found.href} value={found.href} onSelect={() => onSelect(found)}>
            <span className="stutter numeral shrink-0">{found.key}</span>
            <span className="min-w-0 flex-1 truncate">{found.title}</span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

/**
 * Saves the browser's zone once when none is stored. A stored zone that
 * differs is never overwritten without asking.
 */
export function TimezoneNotice({ saved }: { saved: string | null }) {
  const [browser, setBrowser] = useState<string>();
  const [pending, startTransition] = useTransition();
  const attempted = useRef(false);

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setBrowser(zone);
    if (saved === null && zone && !attempted.current) {
      attempted.current = true;
      void setTimezoneAction(zone);
    }
  }, [saved]);

  if (!browser || !saved || saved === browser) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      Times shown in {saved}.
      <Button
        type="button"
        variant="link"
        size="xs"
        className="px-0"
        disabled={pending}
        onClick={() => startTransition(async () => {
          await setTimezoneAction(browser);
        })}
      >
        Use {browser}?
      </Button>
    </p>
  );
}
