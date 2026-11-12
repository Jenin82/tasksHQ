"use client";

import { Button } from "@/components/ui/button";

type SortOption = { id: string; label: string; desc: boolean };

export const SORT_GLYPH = { asc: "↑", desc: "↓" } as const;

export function TableSortControls<T extends SortOption>({
  options,
  sort,
  onSort,
  onToggleDirection,
}: {
  options: readonly T[];
  sort: { id: string; desc: boolean };
  onSort: (option: T) => void;
  onToggleDirection: () => void;
}) {
  const toggleLabel = sort.desc ? "Sort ascending" : "Sort descending";

  return (
    <div className="flex items-center gap-2 border-t border-border pt-3" role="group" aria-label="Table sorting">
      <select
        aria-label="Sort by"
        className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={sort.id}
        onChange={(event) => {
          const selected = options.find(({ id }) => id === event.currentTarget.value);
          if (selected) onSort(selected);
        }}
      >
        {options.map(({ id, label }) => <option key={id} value={id}>Sort by {label}</option>)}
      </select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 rounded-md border-border bg-background shadow-none hover:bg-muted"
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={onToggleDirection}
      >
        <span aria-hidden>{sort.desc ? SORT_GLYPH.desc : SORT_GLYPH.asc}</span>
      </Button>
    </div>
  );
}
