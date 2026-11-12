"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { Briefcase, Search, SquareCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import type { Status } from "@tasks/core/schema";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProjectViewHref } from "@/components/project-view-link";
import { statusDot } from "@/lib/status-style";
import { cn } from "@/lib/utils";
import { WorkspaceSearchNavigation, type SearchDestination } from "./workspace-search-navigation";

type Result = { key: string; title: string; href: string };
type Results = {
  projects: Result[];
  tasks: (Result & { project: string; status: string; color: Status["color"] })[];
};

export function WorkspaceSearch({ org }: { org: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const navigatingOnClose = useRef(false);
  const pathname = usePathname();
  const [navigation, setNavigation] = useState<{ destination: SearchDestination; id: number }>();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      if (!open && document.querySelector('[role="dialog"][aria-modal="true"], [data-slot="dialog-content"]')) return;
      event.preventDefault();
      setOpen(!open);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          ref={trigger}
          type="button"
          className="flex h-9 w-full max-w-96 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Search workspace"
        >
          <Search aria-hidden className="size-4 shrink-0" />
          <span className="hidden sm:inline">Search workspace</span>
          <kbd className="ml-auto hidden text-xs lg:inline">⌘ / Ctrl K</kbd>
        </DialogTrigger>
        <DialogContent
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!navigatingOnClose.current) trigger.current?.focus();
            navigatingOnClose.current = false;
          }}
          className="flex max-h-[calc(100dvh-1.5rem)] max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-menu-surface p-0 shadow-none"
        >
          <DialogTitle className="shrink-0 border-b border-border px-4 py-4 pr-14 text-base font-semibold">Search workspace</DialogTitle>
          {open && <SearchResults key={org} org={org} onSelect={(destination) => {
            setOpen(false);
            if (pathname !== destination.href) {
              navigatingOnClose.current = true;
              setNavigation((previous) => ({ destination, id: (previous?.id ?? 0) + 1 }));
            }
          }} />}
        </DialogContent>
      </Dialog>
      {navigation && <WorkspaceSearchNavigation key={navigation.id} destination={navigation.destination} />}
    </>
  );
}

function SearchResults({ org, onSelect }: { org: string; onSelect: (destination: SearchDestination) => void }) {
  const projectHref = useContext(ProjectViewHref);
  const [input, setInput] = useState("");
  const [response, setResponse] = useState<{ query: string; results: Results | null }>();
  const query = input.trim();
  const current = response?.query === query ? response : null;
  const results = current?.results;

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query });
        const result = await fetch(`/api/workspaces/${encodeURIComponent(org)}/search?${params}`, {
          signal: controller.signal,
        });
        if (!result.ok || result.redirected) throw new Error("Search failed");
        const results = await result.json() as Results;
        if (!controller.signal.aborted) setResponse({ query, results });
      } catch {
        if (!controller.signal.aborted) setResponse({ query, results: null });
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [org, query]);

  const message = !query ? "Search by project name, task title, or key."
    : !current ? "Searching…"
    : !results ? "Search is unavailable. Try again."
    : !results.tasks.length && !results.projects.length ? "No matches." : "";

  return (
    <Command label="Search workspace" shouldFilter={false} className="min-h-0 p-1">
      <CommandInput autoFocus value={input} maxLength={100} onValueChange={setInput} placeholder="Search projects and work items…" />
      <CommandList className="max-h-[min(26rem,60dvh)]">
        {message && <p role="status" className="px-3 py-4 text-sm text-muted-foreground">{message}</p>}
        {results?.tasks.map((task) => (
          <CommandItem className="min-h-10" key={task.href} value={task.href} onSelect={() => onSelect({ href: task.href, view: "task" })}>
            <SquareCheck aria-hidden className="text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{task.title}</span>
              <span className="block truncate text-xs opacity-75">{task.key} · {task.project}</span>
            </span>
            <span className="flex items-center gap-1.5 text-xs">
              <span aria-hidden className={cn("size-2 rounded-full", statusDot(task.color))} />
              {task.status}
            </span>
          </CommandItem>
        ))}
        {results?.projects.map((project) => (
          <CommandItem className="min-h-10" key={project.href} value={project.href} onSelect={() => {
            const href = projectHref(project.href);
            onSelect({ href, view: href === project.href ? "board" : "table" });
          }}>
            <Briefcase aria-hidden className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{project.title}</span>
            <span className="text-xs opacity-75">{project.key} · Project</span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
