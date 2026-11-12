"use client";

import { Plus, Search } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ReportingLineForm, type Person } from "./reporting-line-form";

function PersonCell({ person }: { person: Person }) {
  return (
    <>
      <span className="block font-medium wrap-anywhere">{person.name}</span>
      <span className="block text-sm text-muted-foreground wrap-anywhere">{person.email}</span>
    </>
  );
}

export function ReportingLines({ orgSlug, people }: { orgSlug: string; people: Person[] }) {
  const [search, setSearch] = useState("");
  const [leadFilter, setLeadFilter] = useState("");
  const [dialog, setDialog] = useState<{ person?: Person } | null>(null);
  const [pending, setPending] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const peopleById = new Map(people.map((person) => [person.userId, person]));
  const lines = people.flatMap((person) => {
    const lead = peopleById.get(person.leadUserId ?? "");
    return lead ? [{ person, lead }] : [];
  });
  const leadIds = new Set(lines.map(({ lead }) => lead.userId));
  const selectedLead = leadIds.has(leadFilter) ? leadFilter : "";
  const query = search.trim().toLowerCase();
  const visibleLines = lines.filter(({ person, lead }) =>
    (!selectedLead || lead.userId === selectedLead)
    && [person, lead].some(({ name, email }) => `${name} ${email}`.toLowerCase().includes(query))
  );

  function closeDialog() {
    setDialog(null);
    setPending(false);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-10 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Reporting lines</h1>
        <Button
          ref={addButton}
          aria-haspopup="dialog"
          className="rounded-md"
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setDialog({});
          }}
        >
          <Plus aria-hidden /> Add reporting line
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Each person can have one direct lead. Leads get access to their direct reports’ projects and can track their assignments in Your Team.
      </p>
      <section aria-label="Reporting lines" className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap gap-3 border-b border-border p-3">
          <div className="relative min-w-48 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search reporting lines"
              placeholder="Search names or emails"
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </div>
          <select
            aria-label="Filter by direct lead"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm sm:w-auto"
            value={selectedLead}
            onChange={(event) => setLeadFilter(event.currentTarget.value)}
          >
            <option value="">All leads</option>
            {people.filter(({ userId }) => leadIds.has(userId)).map(({ userId, name }) => (
              <option key={userId} value={userId}>{name}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium sm:px-4">Team member</th>
                <th scope="col" className="px-3 py-2 font-medium sm:px-4">Direct lead</th>
                <th scope="col" className="w-px"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleLines.map(({ person, lead }) => (
                <tr key={person.userId}>
                  <td className="px-3 py-3 sm:px-4"><PersonCell person={person} /></td>
                  <td className="px-3 py-3 sm:px-4"><PersonCell person={lead} /></td>
                  <td className="px-3 py-3 text-right sm:px-4">
                    <Button
                      aria-label={`Edit reporting line for ${person.name}`}
                      aria-haspopup="dialog"
                      size="sm"
                      variant="ghost"
                      onClick={(event) => {
                        trigger.current = event.currentTarget;
                        setDialog({ person });
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {visibleLines.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                    {lines.length ? "No reporting lines match your filters." : "No reporting lines yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open && !pending) closeDialog(); }}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-border bg-card"
          closeDisabled={pending}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (trigger.current?.isConnected ? trigger.current : addButton.current)?.focus();
          }}
        >
          <DialogTitle>{dialog?.person ? "Edit reporting line" : "Add reporting line"}</DialogTitle>
          <DialogDescription>Set who this team member reports to directly.</DialogDescription>
          {dialog && (
            <ReportingLineForm
              orgSlug={orgSlug}
              people={people}
              person={dialog.person}
              onPendingChange={setPending}
              onClose={closeDialog}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
