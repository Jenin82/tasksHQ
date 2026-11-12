"use client";

import { createContext, useContext, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { TaskTypeRef } from "@tasks/core/domain";
import { TaskTypeBadge, TaskTypeIcon } from "@/components/task-type";
import { TASK_PRIORITIES, type Status, type TaskPriority } from "@tasks/core/schema";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskPriorityIcon, taskPriorityLabel } from "@/components/task-priority";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { statusDot } from "@/lib/status-style";
import { cn } from "@/lib/utils";
import { assignTaskAction, editTaskAction, setStatusAction } from "../[task]/actions";

export const TableEditContext = createContext<{
  boardHref: string;
  statuses: { id: string; name: string; color?: Status["color"] }[];
  people: { userId: string; name: string; image?: string | null }[];
} | null>(null);

export const TaskTypeEditContext = createContext<{
  boardHref: string;
  taskTypes: TaskTypeRef[];
} | null>(null);

const labels = { statusId: "Status", assigneeUserId: "Assignee", priority: "Priority", dueDate: "Due date", typeId: "Type" };
type Field = keyof typeof labels;
type Option = { id: string; label: string; icon?: ReactNode };

export function InlineTaskField({ task, field, value, children, priorityIconOnly = false }: {
  task: { id: string; key: string; canEdit?: boolean };
  field: Field;
  value: string;
  children: ReactNode;
  priorityIconOnly?: boolean;
}) {
  const table = useContext(TableEditContext);
  const typeEditor = useContext(TaskTypeEditContext);
  const boardHref = field === "typeId" ? typeEditor?.boardHref : table?.boardHref ?? (field === "priority" ? typeEditor?.boardHref : undefined);
  const [optimistic, setOptimistic] = useOptimistic(value);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const label = labels[field];
  if (!boardHref || task.canEdit === false) return children;
  const [, org, project] = boardHref.split("/");

  const options: Option[] = field === "typeId" ? (typeEditor?.taskTypes ?? []).map((type) => ({
    id: type.id, label: type.name, icon: <TaskTypeIcon icon={type.icon} color={type.color} />,
  })) : field === "statusId" ? (table?.statuses ?? []).map((status) => ({
    id: status.id,
    label: status.name,
    icon: <span aria-hidden className={cn("size-2 rounded-full", statusDot(status.color ?? null))} />,
  })) : field === "assigneeUserId" ? [
    { id: "", label: "Unassigned" },
    ...(table?.people ?? []).map((person) => ({ id: person.userId, label: person.name })),
  ] : field === "priority" ? TASK_PRIORITIES.map((priority) => ({
    id: priority, label: taskPriorityLabel(priority), icon: <TaskPriorityIcon priority={priority} />,
  })) : [];

  function select(next: string) {
    setOpen(false);
    if (pending || next === value) return;
    setError("");
    const data = new FormData();
    data.set("org", org);
    data.set("project", project);
    data.set("taskId", task.id);
    data.set(field, next);
    const action = field === "statusId" ? setStatusAction : field === "assigneeUserId" ? assignTaskAction : editTaskAction;
    startTransition(async () => {
      setOptimistic(next);
      try {
        const result = await action({}, data);
        if (result.error) setError(result.error);
      } catch {
        setError("Couldn’t save this change. Try again.");
      }
    });
  }

  const selected = options.find(({ id }) => id === optimistic);
  const optimisticType = typeEditor?.taskTypes.find((type) => type.id === optimistic);
  const display = optimistic === value ? children
    : field === "typeId" && optimisticType ? <TaskTypeBadge type={optimisticType} />
    : field === "dueDate" ? (optimistic ? formatTaskDueDate(optimistic) : "No due date")
    : field === "priority" ? <span className="inline-flex items-center gap-1.5"><TaskPriorityIcon priority={optimistic as TaskPriority} />{!priorityIconOnly && taskPriorityLabel(optimistic as TaskPriority)}</span>
    : selected?.label ?? children;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${label} for ${task.key}`} aria-busy={pending} disabled={pending}
          className="flex min-h-8 w-full items-center rounded px-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
          {display}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={`Edit ${label.toLowerCase()}`} align="start" className="w-60">
        {field === "dueDate" ? <DatePicker value={optimistic} onSelect={select} /> : (
          <Command label={`Edit ${label.toLowerCase()}`} defaultValue={optimistic || "unassigned"}>
            <CommandInput autoFocus aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} />
            <CommandList>
              <CommandEmpty>No matches</CommandEmpty>
              {options.map((option) => (
                <CommandItem key={option.id} value={option.id || "unassigned"} keywords={[option.label]} onSelect={() => select(option.id)}>
                  {option.icon}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.id === optimistic && <Check aria-label="Current value" />}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
      {error && <p role="alert" className="max-w-48 whitespace-normal text-xs text-destructive">{error}</p>}
    </Popover>
  );
}

function DatePicker({ value, onSelect }: { value: string; onSelect: (value: string) => void }) {
  return (
    <form className="space-y-2 p-2" onSubmit={(event) => {
      event.preventDefault();
      onSelect(String(new FormData(event.currentTarget).get("date") ?? ""));
    }}>
      <Input autoFocus type="date" name="date" aria-label="Due date" defaultValue={value} />
      <div className="flex justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => onSelect("")}>Clear</Button>
        <Button type="submit" size="sm">Apply</Button>
      </div>
    </form>
  );
}
