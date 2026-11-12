"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NO_ERROR, type ActionState } from "@/lib/action-result";
import { setReportingLeadAction } from "./actions";

export type Person = { userId: string; name: string; email: string; leadUserId: string | null };

function PersonPicker({ label, people, value, onChange, disabled }: {
  label: string;
  people: Person[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const labelId = useId();
  const valueId = useId();
  const [open, setOpen] = useState(false);
  const selected = people.find((person) => person.userId === value);

  return (
    <div className="grid gap-1.5">
      <span id={labelId} className="text-sm font-medium">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between rounded-md"
            aria-labelledby={`${labelId} ${valueId}`}
            disabled={disabled}
          >
            <span id={valueId} className="truncate">{selected?.name ?? `Choose ${label.toLowerCase()}`}</span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="z-[60] w-(--radix-popover-trigger-width)">
          <Command label={`Choose ${label.toLowerCase()}`}>
            <CommandInput placeholder="Search names or emails…" aria-label={`Search ${label.toLowerCase()}`} />
            <CommandList>
              <CommandEmpty>No people found.</CommandEmpty>
              {people.map((person) => (
                <CommandItem
                  key={person.userId}
                  value={person.userId}
                  keywords={[person.name, person.email]}
                  onSelect={() => {
                    onChange(person.userId);
                    setOpen(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate">{person.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{person.email}</span>
                  </div>
                  {person.userId === value && <Check aria-label="Selected" />}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ReportingLineForm({ orgSlug, people, person, onPendingChange, onClose }: {
  orgSlug: string;
  people: Person[];
  person?: Person;
  onPendingChange: (pending: boolean) => void;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState(person?.userId ?? "");
  const [leadUserId, setLeadUserId] = useState(person?.leadUserId ?? "");
  const [removing, setRemoving] = useState(false);
  const [state, submit, pending] = useActionState(async (previous: ActionState, formData: FormData) => {
    onPendingChange(true);
    try {
      formData.set("userId", userId);
      formData.set("leadUserId", removing ? "" : leadUserId);
      const result = await setReportingLeadAction(orgSlug, person?.leadUserId ?? null, previous, formData);
      if (!result.error) onClose();
      return result;
    } finally {
      onPendingChange(false);
    }
  }, NO_ERROR);

  const leads = people.filter((candidate) => candidate.userId !== userId);
  const eligibleReports = people.filter((candidate) => candidate.userId !== leadUserId && !candidate.leadUserId);

  return (
    <form action={submit} className="mt-5 grid gap-4">
      {removing ? (
        <p className="text-sm">Remove the direct lead for {person?.name}?</p>
      ) : (
        <>
          <PersonPicker label="Direct lead" people={leads} value={leadUserId} onChange={setLeadUserId} disabled={pending} />
          {person ? (
            <div>
              <p className="text-sm font-medium">Team member</p>
              <p className="mt-1 text-sm text-muted-foreground">{person.name} ({person.email})</p>
            </div>
          ) : (
            <PersonPicker label="Team member" people={eligibleReports} value={userId} onChange={setUserId} disabled={pending} />
          )}
        </>
      )}
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {person && !removing && (
          <Button type="button" variant="ghost" className="mr-auto rounded-md" disabled={pending} onClick={() => setRemoving(true)}>
            Remove line
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="rounded-md"
          disabled={pending}
          onClick={() => removing ? setRemoving(false) : onClose()}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant={removing ? "destructive" : "default"}
          className="rounded-md"
          disabled={pending || (!removing && (!userId || !leadUserId || leadUserId === person?.leadUserId))}
        >
          {removing ? (pending ? "Removing…" : "Remove reporting line") : (pending ? "Saving…" : "Save reporting line")}
        </Button>
      </div>
    </form>
  );
}
