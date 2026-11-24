"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DetailPickerOption = {
  id: string;
  label: string;
  icon: ReactNode;
  unavailable?: string;
};

export function TaskDetailPicker({ label, value, options, onSelect, pending, placeholder, className }: {
  label: string;
  value: string;
  options: DetailPickerOption[];
  onSelect: (value: string) => void;
  pending: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const valueId = useId();
  const selected = options.find((option) => option.id === value);

  return (
    <Popover open={open} onOpenChange={(next) => { if (!next || !pending) setOpen(next); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-labelledby={`${labelId} ${valueId}`}
          aria-busy={pending}
          aria-disabled={pending}
          className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg bg-input px-2.5 text-left text-sm text-foreground shadow-subtle-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-accent aria-disabled:opacity-60 sm:min-h-9"
        >
          <span id={labelId} className="sr-only">{label}</span>
          {selected?.icon}
          <span id={valueId} className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={`Choose ${label.toLowerCase()}`} collisionPadding={12} className={cn("z-[60] w-(--radix-popover-trigger-width) min-w-52", className)}>
        <Command label={`Choose ${label.toLowerCase()}`} defaultValue={selected && !selected.unavailable ? `option:${value}` : undefined}>
          <CommandInput autoFocus aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No matches</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={`option:${option.id}`}
                keywords={[option.label]}
                disabled={Boolean(option.unavailable)}
                onSelect={() => {
                  setOpen(false);
                  if (option.id !== value) onSelect(option.id);
                }}
              >
                {option.icon}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.unavailable && <span className="block text-xs text-muted-foreground">{option.unavailable}</span>}
                </span>
                {option.id === value && <Check aria-label="Current value" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
