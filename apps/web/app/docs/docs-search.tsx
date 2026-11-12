"use client";

import { ArrowUpRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { searchDocs, type DocsSearchEntry } from "./search";

type Index = { state: "loading" | "error" } | { state: "ready"; entries: DocsSearchEntry[] };

function excerpt(text: string) {
  if (text.length <= 150) return text;
  return `${text.slice(0, 150).replace(/\s+\S*$/, "")}…`;
}

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<Index>();
  const destination = useRef<string>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => index?.state === "ready" ? searchDocs(index.entries, query) : [], [index, query]);

  function loadIndex() {
    if (index?.state === "ready" || index?.state === "loading") return;
    setIndex({ state: "loading" });
    void fetch("/docs/search-index.json").then(async (response) => {
      if (!response.ok) throw new Error("Docs search index unavailable");
      setIndex({ state: "ready", entries: await response.json() });
    }).catch(() => setIndex({ state: "error" }));
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) loadIndex();
    else setQuery("");
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      changeOpen(!open);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        type="button"
        aria-label="Search docs"
        aria-keyshortcuts="Meta+K Control+K"
        className="ml-auto flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-2 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:w-60 sm:px-3"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span aria-hidden className="hidden min-[360px]:inline sm:hidden">Search</span>
        <span aria-hidden className="hidden sm:inline">Search docs</span>
        <kbd aria-hidden className="ml-auto hidden text-xs sm:inline">⌘ / Ctrl K</kbd>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          const href = destination.current;
          if (!href) return;
          destination.current = null;
          event.preventDefault();
          const url = new URL(href, window.location.href);
          if (url.pathname !== window.location.pathname) {
            window.location.assign(href);
            return;
          }
          if (url.hash !== window.location.hash) window.location.hash = url.hash;
          const section = document.getElementById(url.hash.slice(1));
          section?.focus({ preventScroll: true });
          section?.scrollIntoView({ block: "start" });
        }}
        className="flex max-h-[calc(100dvh-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-xl border border-border bg-menu-surface p-0 shadow-none"
      >
        <DialogTitle className="shrink-0 border-b border-border px-4 py-4 pr-14 text-base font-medium">Search docs</DialogTitle>
        <Command label="Documentation search" shouldFilter={false} className="min-h-0 p-1">
          <CommandInput ref={input} autoFocus maxLength={120} placeholder="Search the guides…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[min(25rem,55dvh)]">
            {index?.state === "error" ? null : !query.trim() ? (
              <p className="px-3 py-4 text-sm text-foreground/75">Try “status setup”, “permissions”, or “project filters”.</p>
            ) : index?.state !== "ready" ? (
              <p role="status" className="px-3 py-4 text-sm text-foreground/75">Loading search…</p>
            ) : !results.length ? (
              <p role="status" className="px-3 py-4 text-sm text-foreground/75">No matching sections. Try a different term.</p>
            ) : results.map((result) => (
              <CommandItem key={result.href} value={result.href} className="items-start gap-3 px-3 py-2.5" onSelect={() => {
                destination.current = result.href;
                changeOpen(false);
              }}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{result.title}</span>
                  <span className="block text-xs text-foreground/75">{result.guide}</span>
                  <span className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/80">{excerpt(result.text)}</span>
                </span>
                <ArrowUpRight aria-hidden className="mt-1 size-4 text-foreground/65" />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        {index?.state === "error" && (
          <div className="flex flex-wrap items-center gap-2 px-4 pb-4 text-sm text-foreground/75">
            <span role="status">Search couldn’t load.</span>
            <button type="button" className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => {
              input.current?.focus();
              loadIndex();
            }}>Try again</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
