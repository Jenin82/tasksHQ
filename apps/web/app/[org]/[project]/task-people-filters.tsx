"use client";

import type { TaskTypeRef } from "@tasks/core/domain";
import { useContext, useMemo, type Dispatch, type SetStateAction } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSavedTaskFilters } from "@/components/use-saved-task-filters";
import { emptyProjectFilters, ProjectFiltersContext, type ProjectFilters } from "@/components/project-filters-context";

type Person = { id: string; displayName: string };

export type TaskPeople = { assignee: Person | null; createdBy: Person; reportedBy: Person };

type Option = { id: string | null; displayName: string };
type Selection = ReadonlySet<Option["id"]>;

export function filterTasksByPeople<T extends TaskPeople>(tasks: T[], assignees: Selection, creators: Selection, reporters: Selection) {
  if (assignees.size === 0 && creators.size === 0 && reporters.size === 0) return tasks;
  return tasks.filter((task) => (
    (assignees.size === 0 || assignees.has(task.assignee?.id ?? null)) &&
    (creators.size === 0 || creators.has(task.createdBy.id)) &&
    (reporters.size === 0 || reporters.has(task.reportedBy.id))
  ));
}

export function useTaskPeopleFilters<T extends TaskPeople & {
  key: string;
  title: string;
  statusId: string;
  type: TaskTypeRef;
  typeFilterId?: string;
  orgSlug?: string;
  projectId?: string;
  parent?: { id: string } | null;
}>(tasks: T[], storageScope?: string) {
  const shared = useContext(ProjectFiltersContext);
  const [local, setLocal] = useSavedTaskFilters(storageScope);
  const state = shared?.filters ?? local;
  const setState = shared?.setFilters ?? setLocal;
  const currentUser = shared?.currentUser;
  const { assignees, creators, reporters, status, type, query, organization, projectId, hideSubtasks } = state;
  const peopleActive = assignees.size > 0 || creators.size > 0 || reporters.size > 0;
  const activeCount = assignees.size + creators.size + reporters.size +
    [status, type, organization, projectId, query.trim(), hideSubtasks].filter(Boolean).length;

  const options = useMemo(() => {
    const assigned = new Map<string, Person>();
    if (currentUser) assigned.set(currentUser.id, currentUser);
    const created = new Map<string, Person>();
    const reported = new Map<string, Person>();
    const types = new Map<string, string>();
    for (const task of tasks) {
      if (task.assignee) assigned.set(task.assignee.id, task.assignee);
      created.set(task.createdBy.id, task.createdBy);
      reported.set(task.reportedBy.id, task.reportedBy);
      types.set(task.typeFilterId ?? task.type.id, task.type.name);
    }
    const sorted = (people: Map<string, Person>) => [...people.values()]
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return {
      assignees: [{ id: null, displayName: "Unassigned" }, ...sorted(assigned)],
      creators: sorted(created),
      reporters: sorted(reported),
      types: [...types.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    };
  }, [tasks, currentUser]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return filterTasksByPeople(tasks, assignees, creators, reporters).filter((task) =>
      (!status || task.statusId === status) &&
      (!type || (task.typeFilterId ?? task.type.id) === type) &&
      (!organization || task.orgSlug === organization) &&
      (!projectId || task.projectId === projectId) &&
      (!hideSubtasks || !task.parent) &&
      (!needle || task.title.toLowerCase().includes(needle) || task.key.toLowerCase().includes(needle)),
    );
  }, [tasks, assignees, creators, reporters, query, status, type, organization, projectId, hideSubtasks]);

  function setPeople(field: "assignees" | "creators" | "reporters", value: SetStateAction<Selection>) {
    setState((current) => ({ ...current, [field]: typeof value === "function" ? value(current[field]) : value }));
  }
  function setFilter(field: "query" | "status" | "type" | "organization" | "projectId", value: string) {
    setState((current: ProjectFilters) => ({ ...current, [field]: value }));
  }
  return { active: activeCount > 0, activeCount, peopleActive, visible, options, assignees, creators, reporters, query, status, type, organization, projectId, hideSubtasks, setFilter,
    setHideSubtasks: (value: boolean) => setState((current) => ({ ...current, hideSubtasks: value })),
    setAssignees: (value: SetStateAction<Selection>) => setPeople("assignees", value),
    setCreators: (value: SetStateAction<Selection>) => setPeople("creators", value),
    setReporters: (value: SetStateAction<Selection>) => setPeople("reporters", value),
    clear: () => setState(emptyProjectFilters()),
  };
}

export function TaskPeopleFilters({ filters, statuses, organizations, projects, disabled = false, showSearch = true, showSubtaskFilter = false }: {
  filters: ReturnType<typeof useTaskPeopleFilters>;
  statuses?: { id: string; name: string }[];
  organizations?: { slug: string; name: string }[];
  projects?: { id: string; name: string }[];
  showSearch?: boolean;
  /** Only views whose items carry `parent` can hide sub-tasks. */
  showSubtaskFilter?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-2" role="group" aria-label="Work item filters">
      {statuses && <>
        {showSearch && <Input type="search" aria-label="Filter by title" placeholder="Filter work items" className="col-span-2 h-9 w-full rounded-md border border-border bg-background shadow-none"
          disabled={disabled} value={filters.query} onChange={(event) => filters.setFilter("query", event.target.value)} />}
        <select aria-label="Filter by status" className="col-span-2 h-9 min-w-0 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={disabled}
          value={filters.status} onChange={(event) => filters.setFilter("status", event.target.value)}>
          <option value="">All statuses</option>
          {filters.status && !statuses.some(({ id }) => id === filters.status) && (
            <option value={filters.status}>Previously selected status</option>
          )}
          {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
        </select>
      </>}
      {organizations && (
        <select
          aria-label="Filter by organization"
          className="col-span-2 h-9 min-w-0 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={disabled}
          value={filters.organization}
          onChange={(event) => filters.setFilter("organization", event.target.value)}
        >
          <option value="">All organizations</option>
          {filters.organization && !organizations.some(({ slug }) => slug === filters.organization) && (
            <option value={filters.organization}>Previously selected organization</option>
          )}
          {organizations.map(({ slug, name }) => <option key={slug} value={slug}>{name}</option>)}
        </select>
      )}
      {projects && (
        <select
          aria-label="Filter by project"
          className="col-span-2 h-9 min-w-0 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={disabled}
          value={filters.projectId}
          onChange={(event) => filters.setFilter("projectId", event.target.value)}
        >
          <option value="">All projects</option>
          {filters.projectId && !projects.some(({ id }) => id === filters.projectId) && (
            <option value={filters.projectId}>Previously selected project</option>
          )}
          {projects.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      )}
      <select
        aria-label="Filter by type"
        className="col-span-2 h-9 min-w-0 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        disabled={disabled}
        value={filters.type}
        onChange={(event) => filters.setFilter("type", event.target.value)}
      >
        <option value="">All types</option>
        {filters.type && !filters.options.types.some(([id]) => id === filters.type) && (
          <option value={filters.type}>Previously selected type</option>
        )}
        {filters.options.types.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <PeopleFilter
        label="Assignee"
        className="col-span-2"
        options={filters.options.assignees}
        selected={filters.assignees}
        onChange={filters.setAssignees}
        disabled={disabled}
      />
      <PeopleFilter
        label="Created by"
        options={filters.options.creators}
        selected={filters.creators}
        onChange={filters.setCreators}
        disabled={disabled}
      />
      <PeopleFilter
        label="Reported by"
        options={filters.options.reporters}
        selected={filters.reporters}
        onChange={filters.setReporters}
        disabled={disabled}
      />
      {showSubtaskFilter && (
        <label className="col-span-2 flex min-h-9 items-center gap-2 px-0.5 text-sm has-disabled:opacity-50">
          <input
            type="checkbox"
            className="accent-primary"
            disabled={disabled}
            checked={filters.hideSubtasks}
            onChange={(event) => filters.setHideSubtasks(event.target.checked)}
          />
          Hide sub-tasks
        </label>
      )}
      {filters.active && (
        <Button type="button" variant="ghost" size="sm" className="col-span-2 justify-self-end rounded-md" onClick={filters.clear} disabled={disabled}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

function PeopleFilter({ label, options, selected, onChange, disabled, className }: {
  label: string;
  className?: string;
  options: Option[];
  selected: Selection;
  onChange: Dispatch<SetStateAction<Selection>>;
  disabled: boolean;
}) {
  // Preserve selected values when a live update removes all of their tasks.
  // The filter stays visible and can always be cleared.
  function toggle(id: Option["id"]) {
    onChange((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("h-9 w-full min-w-0 justify-between rounded-md border-border bg-background px-2.5 text-foreground shadow-none hover:bg-muted", className)}
          disabled={disabled}
          aria-label={`Filter by ${label.toLowerCase()}${selected.size ? `, ${selected.size} selected` : ""}`}
        >
          <span className="truncate">{label}</span>
          {selected.size > 0 && <span className="numeral text-muted-foreground">{selected.size}</span>}
          <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <Command label={`Filter by ${label.toLowerCase()}`}>
          <CommandInput placeholder="Search people…" aria-label={`Search ${label.toLowerCase()}`} />
          <CommandList>
            <CommandEmpty>No people match.</CommandEmpty>
            {options.map(({ id, displayName }) => {
              const key = id === null ? "unassigned" : `person:${id}`;
              return (
                <CommandItem key={key} value={key} keywords={[displayName]} onSelect={() => toggle(id)}>
                  <span className="grid size-4 shrink-0 place-items-center rounded-sm border border-foreground/40" aria-hidden>
                    {selected.has(id) && <Check className="size-3" />}
                  </span>
                  <span className="truncate">{displayName}</span>
                  <span className="sr-only">{selected.has(id) ? "Selected" : "Not selected"}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
