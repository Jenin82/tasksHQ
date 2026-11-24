"use client";

import { Check, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAX_PEOPLE, TIME_FILTER_COOKIE } from "./filter-cookie";

type Person = { id: string; name: string; email: string };

/**
 * Chips for the selected people and an Add people picker. `base` is the
 * page's query without `people`; removing the last person shows everyone.
 * At most `MAX_PEOPLE` can be chosen.
 */
export function PeopleFilter({ path, base, people, selected }: {
  path: string;
  base: string;
  people: Person[];
  selected: string[] | "all";
}) {
  const router = useRouter();
  const chosen = selected === "all" ? [] : selected;
  const go = (ids: string[]) => router.push(`${path}?${base}&${new URLSearchParams({ people: ids.length ? ids.join(",") : "all" })}`);
  const toggle = (id: string) => go(chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id]);
  const full = chosen.length >= MAX_PEOPLE;

  return (
    <div role="group" aria-label="People" className="flex flex-wrap items-center gap-1">
      {selected === "all" ? (
        <span className="rounded-full bg-muted px-3 py-1 text-sm">Everyone</span>
      ) : people.filter(({ id }) => chosen.includes(id)).map(({ id, name }) => (
        <span key={id} className="flex h-8 min-w-0 items-center gap-1 rounded-full bg-muted pr-1 pl-3 text-sm">
          <span className="max-w-40 truncate">{name}</span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${name}`} onClick={() => toggle(id)}>
            <X aria-hidden />
          </Button>
        </span>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm"><Plus aria-hidden /> Add people</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <Command label="People">
            <CommandInput placeholder="Search people…" aria-label="Search people" />
            <CommandList>
              <CommandEmpty>No people match.</CommandEmpty>
              {people.map(({ id, name, email }) => (
                <CommandItem key={id} value={`${name} ${email}`} disabled={full && !chosen.includes(id)} onSelect={() => toggle(id)}>
                  <span className="grid size-4 shrink-0 place-items-center rounded-sm border border-foreground/40" aria-hidden>
                    {chosen.includes(id) && <Check className="size-3" />}
                  </span>
                  <span className="truncate">{name}</span>
                  <span className="truncate text-muted-foreground">{email}</span>
                  <span className="sr-only">{chosen.includes(id) ? "Selected" : "Not selected"}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {full && <span className="text-sm text-muted-foreground">Up to {MAX_PEOPLE} people</span>}
    </div>
  );
}

/** Remembers the filter the URL chose (or a healed saved one), so the next visit without one opens on it. */
export function SaveTimeFilter({ value }: { value: string | null }) {
  useEffect(() => {
    // Read by the page when the URL has no filter.
    const secure = location.protocol === "https:" ? "; secure" : "";
    if (value !== null) document.cookie = `${TIME_FILTER_COOKIE}=${encodeURIComponent(value)}; path=/settings/time; max-age=31536000; samesite=lax${secure}`;
  }, [value]);
  return null;
}
