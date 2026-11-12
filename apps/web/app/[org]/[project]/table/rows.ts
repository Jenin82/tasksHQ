import type { TaskSummary } from "@tasks/core/domain";
import { shortDate } from "@/lib/format";
import type { TaskRow, TaskTableStatus } from "./task-table";

/**
 * The table's read model. `tasks` arrives from `listTasks`, whose
 * `includeArchived` default is false — archived tasks are out of the table
 * without this page asking for it.
 */
export function toRows(
  tasks: TaskSummary[],
  statuses: TaskTableStatus[],
  base: string,
  canEdit: (task: TaskSummary) => boolean = () => true,
): TaskRow[] {
  // The status column sorts on board order rather than name: `Todo` before
  // `In Progress` before `Done` is the meaningful sequence, and alphabetical
  // would scramble it.
  const order = new Map(statuses.map((s, index) => [s.id, index]));

  return tasks.map((t) => ({
    id: t.id,
    key: t.key,
    number: t.number,
    title: t.title,
    href: `${base}/${t.key}`,
    statusId: t.status.id,
    statusName: t.status.name,
    statusColor: t.status.color,
    statusOrder: order.get(t.status.id) ?? statuses.length,
    assignee: t.assignee,
    createdBy: t.createdBy,
    canEdit: canEdit(t),
    dueDate: t.dueDate,
    priority: t.priority,
    type: t.type,
    createdAt: t.createdAt.getTime(),
    created: shortDate(t.createdAt),
    updatedAt: t.updatedAt.getTime(),
    updated: shortDate(t.updatedAt),
  }));
}
