"use client";

import { useActionState, useState } from "react";
import { TASK_TYPE_ICONS, type ProjectTaskType } from "@tasks/core/schema";
import { TaskTypeBadge, TaskTypeIcon, taskTypeIcons } from "@/components/task-type";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NO_ERROR } from "@/lib/action-result";
import { StatusColorPicker } from "./status-list";
import { saveTaskTypeAction } from "./task-type-actions";

type Scope = { orgSlug: string; projectSlug: string };

export function TaskTypeList({ types, canManage, ...scope }: Scope & {
  types: ProjectTaskType[];
  canManage: boolean;
}) {
  return (
    <section className="mt-8 rounded-2xl bg-card p-6 shadow-subtle">
      <h2 className="text-xl">Task types</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        New work items use the default type. Changing the default applies to future work items.
      </p>
      <ul className="mt-5 divide-y divide-border border-y border-border">
        {types.map((type) => (
          <li key={type.id} className="py-3">
            {canManage ? <TaskTypeForm key={JSON.stringify(type)} {...scope} type={type} /> : (
              <div className="flex items-center gap-3">
                <TaskTypeBadge type={type} />
                {type.isDefault && <span className="text-xs text-muted-foreground">Default</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {canManage && <div className="mt-4"><TaskTypeForm {...scope} /></div>}
    </section>
  );
}

function TaskTypeForm({ orgSlug, projectSlug, type }: Scope & { type?: ProjectTaskType }) {
  const [color, setColor] = useState<ProjectTaskType["color"]>(type?.color ?? "gray");
  const [icon, setIcon] = useState<ProjectTaskType["icon"]>(type?.icon ?? "task");
  const [name, setName] = useState(type?.name ?? "");
  const [state, action, pending] = useActionState(async (previous: typeof NO_ERROR, form: FormData) => {
    const next = await saveTaskTypeAction(orgSlug, projectSlug, type?.id ?? null, previous, form);
    if (!next.error && !type) {
      setName("");
      setColor("gray");
      setIcon("task");
    }
    return next;
  }, NO_ERROR);
  const changed = name.trim() !== type?.name || color !== type?.color || icon !== type?.icon;
  const label = type?.name ?? "New task type";

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="color" value={color} />
      <input type="hidden" name="icon" value={icon} />
      <StatusColorPicker color={color} label={`${label} color`} pending={pending} onSelect={setColor} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" disabled={pending}
            aria-label={`${label} icon: ${taskTypeIcons[icon].label}`}>
            <TaskTypeIcon color={color} icon={icon} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={icon}>
            {TASK_TYPE_ICONS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} onSelect={() => setIcon(option)}>
                <TaskTypeIcon color={color} icon={option} />
                {taskTypeIcons[option].label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Input
        name="name"
        aria-label={`${label} name`}
        placeholder="New task type"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        className="min-w-28 flex-1"
        required
        readOnly={pending}
      />
      <Button type="submit" name="operation" value="save" size="sm" variant="outline" disabled={pending || !name.trim() || !changed}>
        {type ? "Save" : "Add type"}
      </Button>
      {type?.isDefault ? <span className="px-2 text-xs text-muted-foreground">Default</span> : type && (
        <>
          <Button type="submit" name="operation" value="default" size="sm" variant="ghost" formNoValidate disabled={pending}>
            Set as default
          </Button>
          <Button type="submit" name="operation" value="delete" size="sm" variant="ghost" formNoValidate disabled={pending}>
            Delete
          </Button>
        </>
      )}
      {state.error && <p role="alert" className="basis-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
