"use client";

import { useMemo, useState, type ContextType } from "react";
import type { listWorkspaceAssignments } from "@tasks/core/domain";
import { bulkProjectKey, TaskBulkEdit, useTaskSelection } from "@/components/task-bulk-edit";
import { Input } from "@/components/ui/input";
import { FilterToolbar } from "@/components/tab-link";
import { SORT_GLYPH, TableSortControls } from "@/components/table-sort-controls";
import { TaskTypeBadge } from "@/components/task-type";
import { TaskPriorityIcon, taskPriorityLabel } from "@/components/task-priority";
import { shortDate } from "@/lib/format";
import { statusDot } from "@/lib/status-style";
import { formatTaskDueDate, isPastTaskDueDate } from "@/lib/task-due-date";
import { cn } from "@/lib/utils";
import { InlineTaskField, TableEditContext, TaskTypeEditContext } from "../../[project]/table/inline-task-field";
import { TaskPreviewLink } from "../../[project]/task-dialog";
import { TaskPeopleFilters, useTaskPeopleFilters } from "../../[project]/task-people-filters";

type Assignment = Awaited<ReturnType<typeof listWorkspaceAssignments>>[number] & {
  orgSlug: string;
  orgName: string;
  canEdit?: boolean;
};

export type AssignmentEditors = Record<string, {
  canBulkEdit: boolean;
  canEditAnyTask: boolean;
  statuses: NonNullable<ContextType<typeof TableEditContext>>["statuses"];
  people: NonNullable<ContextType<typeof TableEditContext>>["people"];
  taskTypes: NonNullable<ContextType<typeof TaskTypeEditContext>>["taskTypes"];
}>;

const columns = [
  { id: "title", label: "Work item", desc: false },
  { id: "organization", label: "Organization", desc: false },
  { id: "project", label: "Project", desc: false },
  { id: "assignee", label: "Assignee", desc: false },
  { id: "status", label: "Status", desc: false },
  { id: "type", label: "Type", desc: false },
  { id: "priority", label: "Priority", desc: true },
  { id: "dueDate", label: "Due date", desc: false },
] as const;
const DEFAULT_SORT = { id: "updated", label: "Updated on", desc: true } as const;
const sortOptions = [
  { id: "key", label: "Key", desc: false },
  ...columns,
  { id: "created", label: "Created on", desc: true },
  DEFAULT_SORT,
] as const;
type SortId = typeof sortOptions[number]["id"];
type Sort = { id: SortId; desc: boolean };

const pinnedColumn = "sticky left-0 z-10 min-w-48 border-r border-border";
const priorityRank = { low: 0, medium: 1, high: 2 };
const compareText = new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare;
const comparators: Record<SortId, (a: Assignment, b: Assignment) => number> = {
  key: (a, b) => compareText(a.key, b.key),
  title: (a, b) => compareText(a.title, b.title),
  organization: (a, b) => compareText(a.orgName, b.orgName),
  project: (a, b) => compareText(a.projectName, b.projectName),
  assignee: (a, b) => compareText(a.assignee.displayName, b.assignee.displayName),
  status: (a, b) => compareText(a.status.name, b.status.name),
  type: (a, b) => compareText(a.type.name, b.type.name),
  priority: (a, b) => priorityRank[a.priority] - priorityRank[b.priority],
  dueDate: (a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""),
  created: (a, b) => a.createdAt - b.createdAt,
  updated: (a, b) => a.updatedAt - b.updatedAt,
};

export function WorkspaceAssignmentTable({ title, tasks, editors, emptyMessage, filterScope, organizations, showProjectFilter = true }: {
  title: string;
  tasks: Assignment[];
  editors: AssignmentEditors;
  emptyMessage: string;
  filterScope: string;
  organizations?: { slug: string; name: string }[];
  showProjectFilter?: boolean;
}) {
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const showOrganization = organizations !== undefined;
  // Projects have different IDs for the same named status.
  const rows = useMemo(() => tasks.map((task) => ({
    ...task,
    statusId: task.status.name.toLowerCase(),
    typeFilterId: task.type.name.toLowerCase(),
  })), [tasks]);
  const statuses = useMemo(() => Array.from(
    new Map(rows.map(({ statusId, status }) => [statusId, { id: statusId, name: status.name }])).values(),
  ).sort((a, b) => compareText(a.name, b.name)), [rows]);
  const projectOptions = useMemo(() => {
    if (!showProjectFilter) return undefined;
    const options = new Map(tasks.map(({ projectId, projectName, projectSlug, orgName, orgSlug }) => [
      projectId, {
        id: projectId,
        name: showOrganization ? `${projectName} (${orgName})` : projectName,
        path: showOrganization ? `${orgSlug}/${projectSlug}` : projectSlug,
      },
    ]));
    const labelCounts = new Map<string, number>();
    for (const { name } of options.values()) labelCounts.set(name, (labelCounts.get(name) ?? 0) + 1);
    return [...options.values()].map(({ id, name, path }) => ({
      id, name: labelCounts.get(name) === 1 ? name : `${name} · ${path}`,
    })).sort((a, b) => compareText(a.name, b.name));
  }, [tasks, showProjectFilter, showOrganization]);
  const filters = useTaskPeopleFilters(rows, filterScope);
  const visible = useMemo(() => [...filters.visible].sort((a, b) => {
    if (sort.id === "dueDate" && Boolean(a.dueDate) !== Boolean(b.dueDate)) {
      return a.dueDate ? -1 : 1;
    }
    return comparators[sort.id](a, b) * (sort.desc ? -1 : 1);
  }), [filters.visible, sort]);

  const selectable = visible.filter((task) => task.canEdit !== false && editors[task.projectId]?.canBulkEdit);
  const selection = useTaskSelection(selectable);
  const projects = Object.fromEntries(tasks.map((task) => [bulkProjectKey(task.orgSlug, task.projectSlug), editors[task.projectId]]));

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          aria-label="Search work items"
          placeholder="Search work items"
          className="mr-auto h-9 min-w-0 max-w-xs"
          value={filters.query}
          onChange={(event) => filters.setFilter("query", event.currentTarget.value)}
        />
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{visible.length} work items</span>
        <FilterToolbar view="table" activeCount={filters.activeCount}>
          <div className="min-w-0 space-y-3">
            <TaskPeopleFilters filters={filters} statuses={statuses} organizations={organizations} projects={projectOptions} showSearch={false} />
            <TableSortControls
              options={sortOptions.filter(({ id }) => showOrganization || id !== "organization")}
              sort={sort}
              onSort={setSort}
              onToggleDirection={() => setSort((current) => ({ ...current, desc: !current.desc }))}
            />
          </div>
        </FilterToolbar>
      </div>
      {Object.values(editors).some((editor) => editor.canBulkEdit) && (
        <TaskBulkEdit selection={selection} projects={projects} />
      )}
      <div className="mt-2 overflow-x-auto rounded-xl border border-border" role="region" aria-label={title} tabIndex={0}>
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="bg-muted">
            <tr className="border-b border-border">
              {columns.filter(({ id }) => showOrganization || id !== "organization").map(({ id, label, desc }) => (
                <th
                  key={id}
                  scope="col"
                  aria-sort={sort.id === id ? (sort.desc ? "descending" : "ascending") : "none"}
                  className={cn("whitespace-nowrap px-4 py-2.5 font-medium", id === "title" && `${pinnedColumn} bg-muted`)}
                >
                  {id === "title" && selectable.length > 0 && <input type="checkbox" aria-label="Select all eligible visible tasks" className="mr-2 accent-primary" {...selection.all} />}
                  <button
                    type="button"
                    onClick={() => setSort((current) => ({ id, desc: current.id === id ? !current.desc : desc }))}
                    className="inline-flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {label}
                    <span aria-hidden className="w-2">
                      {sort.id === id && (sort.desc ? SORT_GLYPH.desc : SORT_GLYPH.asc)}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((task) => {
              const editor = editors[task.projectId];
              const boardHref = `/${task.orgSlug}/${task.projectSlug}`;
              return (
                <TableEditContext.Provider key={task.id} value={editor ? { ...editor, boardHref } : null}>
                  <TaskTypeEditContext.Provider value={editor ? { taskTypes: editor.taskTypes, boardHref } : null}>
                    <tr
                      className="group cursor-pointer hover:bg-muted/50"
                      onClick={(event) => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return;
                        if (event.target.closest("a, button, input, select, textarea, [role=button]")) return;
                        if (window.getSelection()?.toString()) return;
                        event.currentTarget.querySelector("a")?.click();
                      }}
                    >
                      <td className={cn(pinnedColumn, "bg-background px-4 py-3 group-hover:bg-[color-mix(in_srgb,var(--muted),var(--background))]")}>
                        {task.canEdit !== false && editor?.canBulkEdit && (
                          <input type="checkbox" aria-label={`Select ${task.key}${showOrganization ? ` in ${task.orgName}` : ""}`} className="mr-2 accent-primary" {...selection.row(task.id)} />
                        )}
                        <TaskPreviewLink
                          className="rounded-sm font-medium wrap-anywhere outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          task={{
                            ...task,
                            href: `${boardHref}/${task.key}`,
                            assignee: task.assignee.displayName,
                            updated: shortDate(new Date(task.updatedAt)),
                          }}
                        >
                          <span className="mr-2 text-xs tabular-nums text-muted-foreground">{task.key}</span>
                          {task.title}
                        </TaskPreviewLink>
                      </td>
                      {showOrganization && <td className="min-w-28 px-4 py-3">{task.orgName}</td>}
                      <td className="min-w-28 px-4 py-3">{task.projectName}</td>
                      <td className="min-w-28 px-4 py-3"><InlineTaskField task={task} field="assigneeUserId" value={task.assignee.id}>{task.assignee.displayName}</InlineTaskField></td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <InlineTaskField task={task} field="statusId" value={task.status.id}>
                          <span className="inline-flex items-center gap-2">
                            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", statusDot(task.status.color))} />
                            {task.status.name}
                          </span>
                        </InlineTaskField>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><InlineTaskField task={task} field="typeId" value={task.type.id}><TaskTypeBadge type={task.type} /></InlineTaskField></td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <InlineTaskField task={task} field="priority" value={task.priority}>
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden><TaskPriorityIcon priority={task.priority} /></span>
                            {taskPriorityLabel(task.priority)}
                          </span>
                        </InlineTaskField>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <InlineTaskField task={task} field="dueDate" value={task.dueDate ?? ""}>
                          {task.dueDate ? (
                            <time dateTime={task.dueDate} className={cn("tabular-nums", isPastTaskDueDate(task.dueDate) && "text-destructive")}>
                              {formatTaskDueDate(task.dueDate)}
                            </time>
                          ) : <span aria-label="No due date">—</span>}
                        </InlineTaskField>
                      </td>
                    </tr>
                  </TaskTypeEditContext.Provider>
                </TableEditContext.Provider>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && (
        <p className="p-6 text-sm text-muted-foreground">{tasks.length ? "No tasks match these filters." : emptyMessage}</p>
      )}
    </div>
  );
}
