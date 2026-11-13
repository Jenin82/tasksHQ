"use client";

import { useContext } from "react";
import { bulkProjectKey, TaskBulkEdit, useTaskSelection } from "@/components/task-bulk-edit";
import type { TaskTypeRef } from "@tasks/core/domain";
import Link from "next/link";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { SORT_GLYPH, TableSortControls } from "@/components/table-sort-controls";
import { TaskTypeBadge } from "@/components/task-type";
import { TaskPriorityIcon, taskPriorityLabel } from "@/components/task-priority";
import type { Status, TaskPriority } from "@tasks/core/schema";
import { statusDot } from "@/lib/status-style";
import { formatTaskDueDate, isPastTaskDueDate } from "@/lib/task-due-date";
import { cn } from "@/lib/utils";
import { ProjectTabFilters } from "@/components/tab-link";
import { TaskPreviewLink } from "../task-dialog";
import { InlineTaskField, TableEditContext, TaskTypeEditContext } from "./inline-task-field";
import { ProfileAvatar } from "@/components/profile-avatar";
import { TaskPeopleFilters, useTaskPeopleFilters, type TaskPeople } from "../task-people-filters";

export type TaskRow = TaskPeople & {
  assignee: (NonNullable<TaskPeople["assignee"]> & { image?: string }) | null;
  reportedBy: TaskPeople["reportedBy"] & { image?: string };
  id: string;
  key: string;
  parent: { id: string; key: string } | null;
  /** The key sorts on this. `WEB-10` as a string sorts before `WEB-2`. */
  number: number;
  title: string;
  href: string;
  statusId: string;
  statusName: string;
  statusColor: Status["color"];
  statusOrder: number;
  dueDate: string | null;
  priority: TaskPriority;
  type: TaskTypeRef;
  canEdit: boolean;
  /** Epoch ms, so the column sorts on the instant and renders the shape. */
  createdAt: number;
  created: string;
  updatedAt: number;
  updated: string;
};

export type TaskTableStatus = Pick<Status, "id" | "name"> & { color?: Status["color"] };

/**
 * Filtering and sorting both run on the client: a project's task list is
 * bounded by what the board already renders in one page, so a round trip per
 * keystroke would buy nothing. Both row models are registered here; neither
 * exists without its feature.
 */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

const helper = createColumnHelper<typeof features, TaskRow>();
const PRIORITY_RANK = { low: 0, medium: 1, high: 2 } satisfies Record<TaskPriority, number>;

const SORT_OPTIONS = [
  { id: "key", label: "Key", desc: false },
  { id: "title", label: "Title", desc: false },
  { id: "type", label: "Type", desc: false },
  { id: "status", label: "Status", desc: false },
  { id: "assignee", label: "Assignee", desc: false },
  { id: "reporter", label: "Reporter", desc: false },
  { id: "created", label: "Created on", desc: true },
  { id: "priority", label: "Priority", desc: true },
  { id: "dueDate", label: "Due date", desc: false },
] as const;

function StatusValue({ task }: { task: TaskRow }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", statusDot(task.statusColor))} />
      <span>{task.statusName}</span>
    </span>
  );
}

function PriorityValue({ priority }: { priority: TaskPriority }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden><TaskPriorityIcon priority={priority} /></span>
      <span>{taskPriorityLabel(priority)}</span>
    </span>
  );
}

function DueDateValue({ date }: { date: string | null }) {
  return date ? (
    <time dateTime={date} className={cn("tabular-nums", isPastTaskDueDate(date) && "text-destructive")}>{formatTaskDueDate(date)}</time>
  ) : (
    <span className="stutter" aria-label="No due date">—</span>
  );
}

/**
 * Module scope, not a hook: v9 invalidates every row model when `columns`,
 * `features` or `data` change identity.
 */
export const columns = helper.columns([
  helper.accessor("number", { id: "key", header: "Key", sortFn: sortFn_basic }),
  helper.accessor("title", {
    id: "title",
    header: "Work items",
    sortFn: sortFn_text,
    cell: ({ row }) => (
      <>
        <span className="mr-3 text-xs tabular-nums text-muted-foreground">{row.original.key}</span>
        <TaskPreviewLink
          task={{
            ...row.original,
            status: { name: row.original.statusName, color: row.original.statusColor },
            assignee: row.original.assignee?.displayName ?? null,
          }}
          className="rounded-sm font-medium wrap-anywhere underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.original.title}
        </TaskPreviewLink>
        {row.original.parent && (
          <span className="ml-2 text-xs tabular-nums text-muted-foreground">
            <span className="sr-only">Sub-task of </span><span aria-hidden>↳ </span>{row.original.parent.key}
          </span>
        )}
      </>
    ),
  }),
  helper.accessor((row) => row.type.name, {
    id: "type",
    header: "Type",
    sortFn: sortFn_text,
    cell: ({ row }) => (
      <InlineTaskField task={row.original} field="typeId" value={row.original.type.id}>
        <TaskTypeBadge type={row.original.type} />
      </InlineTaskField>
    ),
  }),
  helper.accessor((row) => row.statusId, {
    id: "status",
    header: "Status",
    sortFn: (a, b) => a.original.statusOrder - b.original.statusOrder,
    cell: ({ row }) => (
      <InlineTaskField task={row.original} field="statusId" value={row.original.statusId}>
        <StatusValue task={row.original} />
      </InlineTaskField>
    ),
  }),
  helper.accessor((row) => PRIORITY_RANK[row.priority], {
    id: "priority",
    header: "Priority",
    sortFn: sortFn_basic,
    cell: ({ row }) => (
      <InlineTaskField task={row.original} field="priority" value={row.original.priority}>
        <PriorityValue priority={row.original.priority} />
      </InlineTaskField>
    ),
  }),
  helper.accessor((row) => row.assignee?.displayName ?? "", {
    id: "assignee",
    header: "Assignee",
    sortFn: sortFn_text,
    cell: ({ row }) => (
      <InlineTaskField task={row.original} field="assigneeUserId" value={row.original.assignee?.id ?? ""}>
        {row.original.assignee ? <span className="flex items-center gap-2">
          <ProfileAvatar name={row.original.assignee.displayName} image={row.original.assignee.image} className="size-5" />
          {row.original.assignee.displayName}
        </span> : <span className="text-muted-foreground">Unassigned</span>}
      </InlineTaskField>
    ),
  }),
  helper.accessor((row) => row.reportedBy.displayName, {
    id: "reporter",
    header: "Reporter",
    sortFn: sortFn_text,
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <ProfileAvatar name={row.original.reportedBy.displayName} image={row.original.reportedBy.image} className="size-5" />
        {row.original.reportedBy.displayName}
      </span>
    ),
  }),
  helper.accessor((row) => row.dueDate ?? undefined, {
    id: "dueDate",
    header: "Due date",
    sortFn: sortFn_basic,
    sortUndefined: "last",
    cell: ({ row }) => (
      <InlineTaskField task={row.original} field="dueDate" value={row.original.dueDate ?? ""}>
        <DueDateValue date={row.original.dueDate} />
      </InlineTaskField>
    ),
  }),
  helper.accessor("createdAt", {
    id: "created",
    header: "Created on",
    sortFn: sortFn_basic,
    cell: ({ row }) => <span className="tabular-nums">{row.original.created}</span>,
  }),
]);

const cell = (columnId: string) => cn(
  "border-r border-border/60 px-3 last:border-r-0",
  columnId === "title"
    ? "sticky left-0 z-10 min-w-52 after:pointer-events-none after:absolute after:inset-y-0 after:left-full after:w-3 after:bg-linear-to-r after:from-black/8 after:to-transparent lg:min-w-72 dark:after:from-white/6"
    : "min-w-32 whitespace-nowrap",
);

export function TaskTable({
  statuses,
  rows,
  boardHref,
  people,
  canBulkEdit = false,
}: {
  statuses: TaskTableStatus[];
  rows: TaskRow[];
  boardHref: string;
  people?: { userId: string; name: string; image?: string | null }[];
  canBulkEdit?: boolean;
}) {
  const filters = useTaskPeopleFilters(rows);
  const table = useTable({
    features,
    columns,
    data: filters.visible,
    getRowId: (row) => row.id,
    // A column always carries the sort, so a third click cannot drop the
    // table back into the order the rows happened to arrive in.
    enableSortingRemoval: false,
    sortDescFirst: false,
    initialState: { sorting: [{ id: "key", desc: false }] },
  });

  const visible = table.getRowModel().rows;
  const [, orgSlug, projectSlug] = boardHref.split("/");
  const typeEditor = useContext(TaskTypeEditContext);
  const selectable = canBulkEdit ? visible.filter(({ original }) => original.canEdit) : [];
  const selection = useTaskSelection(selectable.map(({ original }) => ({ id: original.id, key: original.key, orgSlug, projectSlug })));
  const sort = table.state.sorting[0] ?? SORT_OPTIONS[0];

  return (
    <TableEditContext.Provider value={people ? { statuses, people, boardHref } : null}>
      <div data-task-list tabIndex={-1} className="min-w-0">
        <ProjectTabFilters view="table" count={visible.length} activeCount={filters.activeCount}>
          <div className="min-w-0 space-y-3">
            <TaskPeopleFilters filters={filters} statuses={statuses} showSubtaskFilter />
            <TableSortControls
              options={SORT_OPTIONS}
              sort={sort}
              onSort={({ id, desc }) => table.setSorting([{ id, desc }])}
              onToggleDirection={() => table.setSorting(([primary = SORT_OPTIONS[0], ...rest]) => [
                { id: primary.id, desc: !primary.desc },
                ...rest,
              ])}
            />
          </div>
        </ProjectTabFilters>
        {canBulkEdit && people && <TaskBulkEdit selection={selection} projects={{
          [bulkProjectKey(orgSlug, projectSlug)]: { statuses, people, taskTypes: typeEditor?.taskTypes ?? [] },
        }} />}
        <div className="overflow-x-auto" role="region" aria-label="Work items table" tabIndex={0}>
          <table aria-label="Tasks" className="w-full min-w-[55rem] text-left text-sm">
            <thead className="bg-muted">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className="border-b border-border/60">
                  {group.headers.filter((header) => header.column.id !== "key").map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={sorted ? `${sorted}ending` : "none"}
                        className={cn(cell(header.column.id), "bg-muted py-2 font-medium")}
                      >
                        {selectable.length > 0 && header.column.id === "title" && (
                          <input type="checkbox" aria-label="Select all visible tasks" className="mr-2 accent-primary" {...selection.all} />
                        )}
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1.5 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <table.FlexRender header={header} />
                          <span aria-hidden className="w-2">
                            {sorted ? SORT_GLYPH[sorted] : ""}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  className="group border-b border-border hover:bg-muted/50"
                >
                  {row.getAllCells().filter((c) => c.column.id !== "key").map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        cell(c.column.id),
                        "py-1.5",
                        c.column.id === "title" && "bg-background group-hover:bg-[color-mix(in_srgb,var(--muted),var(--background))]",
                      )}
                    >
                      {canBulkEdit && row.original.canEdit && c.column.id === "title" && (
                        <input type="checkbox" aria-label={`Select ${row.original.key}`} className="mr-2 accent-primary" {...selection.row(row.id)} />
                      )}
                      <table.FlexRender cell={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visible.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {rows.length ? "No tasks match these filters." : <>No tasks yet. Add a work item or <Link href={boardHref} className="underline">open the board</Link>.</>}
          </p>
        ) : null}
      </div>
    </TableEditContext.Provider>
  );
}
