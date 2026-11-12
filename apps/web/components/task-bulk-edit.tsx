"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { TaskTypeRef } from "@tasks/core/domain";
import { TASK_PRIORITIES, type Status } from "@tasks/core/schema";
import { bulkUpdateTasksAction } from "@/app/[org]/[project]/[task]/actions";
import { ProfileAvatar } from "@/components/profile-avatar";
import { TaskTypeIcon } from "@/components/task-type";
import { statusDot } from "@/lib/status-style";
import { cn } from "@/lib/utils";
import { TaskPriorityIcon, taskPriorityLabel } from "@/components/task-priority";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type BulkTask = { id: string; key: string; orgSlug: string; projectSlug: string };
type Option = { key: string; id: string; name: string; visual?: ReactNode; appearance?: string };
export type BulkProjectOptions = {
  statuses: { id: string; name: string; color?: Status["color"] }[];
  taskTypes: TaskTypeRef[];
  people: { userId: string; name: string; image?: string | null }[];
};
type Field = Parameters<typeof bulkUpdateTasksAction>[0]["field"];
type BulkChanges = Parameters<typeof bulkUpdateTasksAction>[0]["changes"];
const MAX_SELECTION = 50;
const fields = [
  ["statusId", "Status"],
  ["priority", "Priority"],
  ["typeId", "Type"],
  ["assigneeUserId", "Assignee"],
  ["archive", "Archive"],
] as const;

export function bulkProjectKey(orgSlug: string, projectSlug: string) {
  return `${orgSlug}/${projectSlug}`;
}

export function useTaskSelection<T extends BulkTask>(visible: T[]) {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const selected = visible.filter((task) => ids.has(task.id));
  const visibleIds = new Set(visible.map(({ id }) => id));
  // Drop hidden rows so clearing a filter cannot resurrect an old selection.
  if ([...ids].some((id) => !visibleIds.has(id))) {
    setIds(new Set(selected.map(({ id }) => id)));
  }
  return {
    selected,
    busy,
    setBusy,
    remove: (removed: string[]) => {
      const done = new Set(removed);
      setIds((previous) => new Set([...previous].filter((id) => !done.has(id))));
    },
    clear: () => setIds(new Set()),
    row: (id: string) => ({
      checked: ids.has(id),
      disabled: busy || (ids.size >= MAX_SELECTION && !ids.has(id)),
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        const checked = event.currentTarget.checked;
        setIds((previous) => {
          const next = new Set(previous);
          if (checked && next.size < MAX_SELECTION) next.add(id);
          if (!checked) next.delete(id);
          return next;
        });
      },
    }),
    all: {
      checked: visible.length > 0 && selected.length === visible.length,
      disabled: busy || visible.length === 0 || visible.length > MAX_SELECTION,
      title: visible.length > MAX_SELECTION ? `Select up to ${MAX_SELECTION} tasks individually` : undefined,
      ref: (input: HTMLInputElement | null) => {
        if (input) input.indeterminate = selected.length > 0 && selected.length < visible.length;
      },
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setIds(new Set(event.currentTarget.checked ? visible.slice(0, MAX_SELECTION).map(({ id }) => id) : []));
      },
    },
  };
}

function projectChoices(field: Field, project: BulkProjectOptions | undefined): Option[] {
  if (field === "priority") return TASK_PRIORITIES.map((id) => ({
    key: id, id, name: taskPriorityLabel(id), visual: <span aria-hidden><TaskPriorityIcon priority={id} /></span>,
  }));
  if (field === "assigneeUserId") return [
    { key: "", id: "", name: "Unassigned" },
    ...(project?.people ?? []).map(({ userId, name, image }) => ({
      key: userId, id: userId, name, visual: <ProfileAvatar name={name} image={image} className="size-5 bg-muted text-xs" />,
    })),
  ];
  if (field === "statusId") return (project?.statuses ?? []).map(({ id, name, color }) => ({
    key: name, id, name, appearance: color ?? "gray",
    visual: <span aria-hidden className={cn("size-2 shrink-0 rounded-full", statusDot(color ?? null))} />,
  }));
  if (field === "typeId") return (project?.taskTypes ?? []).map(({ id, name, color, icon }) => ({
    key: name, id, name, appearance: `${color}:${icon}`, visual: <TaskTypeIcon color={color} icon={icon} />,
  }));
  return [];
}

export function TaskBulkEdit({ selection, projects }: {
  selection: ReturnType<typeof useTaskSelection>;
  projects: Record<string, BulkProjectOptions>;
}) {
  const [field, setField] = useState<Field>("statusId");
  const [choice, setChoice] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const { selected, busy } = selection;
  if (selected.length === 0) {
    if (field !== "statusId") setField("statusId");
    if (choice) setChoice("");
    if (pickerOpen) setPickerOpen(false);
  }
  const projectKeys = new Set(selected.map(({ orgSlug, projectSlug }) => bulkProjectKey(orgSlug, projectSlug)));
  const choicesByProject = new Map([...projectKeys]
    .map((key) => [key, new Map(projectChoices(field, projects[key]).map((option) => [option.key, option]))]));
  const sets = [...choicesByProject.values()];
  const common = [...(sets[0]?.values() ?? [])]
    .filter((option) => sets.every((set) => set.has(option.key)))
    .map((option) => sets.every((set) => set.get(option.key)?.appearance === option.appearance)
      ? option : { ...option, visual: undefined });
  // Prefix option values so the empty assignee remains distinguishable from the placeholder.
  const target = common.find(({ key }) => `option:${key}` === choice);

  async function apply() {
    if (busy || !selected.length || (field !== "archive" && !target)) return;
    const changesByOrg = new Map<string, BulkChanges>();
    for (const { id, orgSlug, projectSlug } of selected) {
      const projectKey = bulkProjectKey(orgSlug, projectSlug);
      const value = target ? choicesByProject.get(projectKey)!.get(target.key)!.id : "";
      const change = { taskId: id, projectSlug, value };
      const changes = changesByOrg.get(orgSlug);
      if (changes) changes.push(change);
      else changesByOrg.set(orgSlug, [change]);
    }
    selection.setBusy(true);
    setMessage("");
    const updatedIds: string[] = [];
    const errors: string[] = [];
    const selectedById = new Map(selected.map((item) => [item.id, item]));
    try {
      for (const [orgSlug, changes] of changesByOrg) {
        const prefix = changesByOrg.size > 1 ? `${orgSlug} / ` : "";
        try {
          const result = await bulkUpdateTasksAction({ orgSlug, field, changes });
          updatedIds.push(...result.updatedIds);
          if (result.error) errors.push(`${prefix}${result.error}`);
          for (const { taskId, error } of result.failures) {
            errors.push(`${prefix}${selectedById.get(taskId)?.key ?? "Task"}: ${error}`);
          }
        } catch {
          errors.push(`${prefix}Could not complete the bulk action. Try again.`);
        }
      }
      selection.remove(updatedIds);
      const count = updatedIds.length;
      const verb = field === "archive" ? "Archived" : "Updated";
      setMessage([
        count ? `${verb} ${count} ${count === 1 ? "task" : "tasks"}.` : "",
        ...errors,
      ].filter(Boolean).join(" "));
    } finally {
      selection.setBusy(false);
    }
  }

  return (
    <>
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selected.length} selected</span>
          <div role="group" aria-label="Bulk actions" className="flex flex-wrap gap-1">
            {fields.map(([value, label]) => (
              <Button key={value} type="button" size="sm" variant={field === value ? "default" : "outline"}
                aria-pressed={field === value} disabled={busy}
                onClick={() => { setField(value); setChoice(""); setPickerOpen(false); setMessage(""); }}>
                {value === "archive" ? label : `Change ${label.toLowerCase()}`}
              </Button>
            ))}
          </div>
          {field !== "archive" && (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" aria-label={target ? `New value: ${target.name}` : "Choose a value"}
                  disabled={busy || common.length === 0} className="min-w-0 max-w-full rounded-md bg-background">
                  {target?.visual}
                  <span className="truncate">{target?.name ?? (common.length ? "Choose a value" : "No shared options")}</span>
                  <ChevronDown aria-hidden className="size-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent aria-label="Choose a bulk value" align="start" className="w-60">
                <Command label="Choose a bulk value">
                  <CommandInput autoFocus aria-label="Search values" placeholder="Search values…" />
                  <CommandList>
                    <CommandEmpty>No matching values</CommandEmpty>
                    {common.map(({ key, name, visual }) => (
                      <CommandItem key={key} value={`option:${key}`} keywords={[name]}
                        onSelect={() => { setChoice(`option:${key}`); setPickerOpen(false); }}>
                        {visual}
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        {target?.key === key && <Check aria-label="Selected value" />}
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
          <Button type="button" size="sm" className="rounded-md" onClick={() => void apply()} disabled={busy || (field !== "archive" && !target)}>
            {busy ? "Applying…" : field === "archive" ? "Confirm" : "Apply"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={selection.clear}>Clear selection</Button>
        </div>
      )}
      {message && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">{message}</p>}
    </>
  );
}
