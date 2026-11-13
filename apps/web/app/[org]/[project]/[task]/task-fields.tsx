"use client";

import { CircleDashed, Folder, Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { type ReactNode, createContext, startTransition, useActionState, useContext, useEffect, useLayoutEffect, useOptimistic, useRef, useState } from "react";
import type { TaskTypeRef } from "@tasks/core/domain";
import { ProfileAvatar } from "@/components/profile-avatar";
import { TaskTypeIcon } from "@/components/task-type";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NO_ERROR, type ActionState } from "@/lib/action-result";
import { TASK_PRIORITIES, type Status, type TaskPriority } from "@tasks/core/schema";
import { TaskPriorityIcon, taskPriorityLabel } from "@/components/task-priority";
import { SELECT_CLASS, statusColorClass } from "@/lib/status-style";
import { cn } from "@/lib/utils";
import { CommentComposer } from "./comment-composer";
import { DescriptionEditor } from "./description-editor";
import { TaskDetailPicker, type DetailPickerOption } from "./task-detail-picker";
import { createTaskAction } from "../actions";
import {
  addCommentAction,
  archiveAction,
  assignTaskAction,
  editTaskAction,
  setReporterAction,
  setStatusAction,
  transferTaskAction,
} from "./actions";

// §7.4: transparent until hovered, then the input surface; focus is the plain
// blue ring.
const FIELD_CLASS =
  "w-full rounded-lg bg-transparent px-2 py-1 outline-none transition-colors hover:bg-input focus-visible:bg-input focus-visible:ring-2 focus-visible:ring-ring";

export const TaskDetailRefresh = createContext<(() => Promise<void>) | null>(null);
export const TaskDescriptionBusy = createContext<((busy: boolean) => void) | null>(null);

function useTaskAction(action: (state: ActionState, form: FormData) => Promise<ActionState>) {
  const refresh = useContext(TaskDetailRefresh);
  return useActionState(async (state: ActionState, form: FormData) => {
    const result = await action(state, form);
    if (!result.error) await refresh?.();
    return result;
  }, NO_ERROR);
}

export type TaskFieldsIds = {
  orgSlug: string;
  projectSlug: string;
  taskId: string;
};

function Ids({ orgSlug, projectSlug, taskId }: TaskFieldsIds) {
  return (
    <>
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="project" value={projectSlug} />
      <input type="hidden" name="taskId" value={taskId} />
    </>
  );
}

function FieldError({ state }: { state: ActionState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="mt-2 text-sm text-destructive">
      {state.error}
    </p>
  );
}

/**
 * Submits on blur, the pattern §21 established for the status rename field,
 * and remounts on the saved value so React 19's post-action form reset lands
 * on the new text rather than the old one (§17).
 */
export function TitleField({ ids, title }: { ids: TaskFieldsIds; title: string }) {
  const [state, edit] = useTaskAction(editTaskAction);

  return (
    <form action={edit} className="mt-3">
      <Ids {...ids} />
      <input
        key={title}
        name="title"
        required
        defaultValue={state.values?.title ?? title}
        aria-label="Task title"
        className={cn(FIELD_CLASS, "-ml-2 text-2xl")}
        onBlur={(event) => {
          // `requestSubmit` runs constraint validation, and `required` on an
          // empty field focuses it back — trapping anyone who clears the
          // title and clicks away. Restore instead.
          if (!event.currentTarget.value.trim()) {
            event.currentTarget.value = title;
            return;
          }
          if (event.currentTarget.value !== title || state.error) {
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <FieldError state={state} />
    </form>
  );
}

export function DescriptionField({
  ids,
  description,
}: {
  ids: TaskFieldsIds;
  description: string | null;
}) {
  const [state, edit, saving] = useTaskAction(editTaskAction);
  const current = description ?? "";
  const [saved, setSaved] = useState(current);
  const [draft, setDraft] = useState(current);
  const [uploading, setUploading] = useState(false);
  const notifyBusy = useContext(TaskDescriptionBusy);
  const uploadInFlight = useRef(false);
  const deferredSave = useRef(false);
  const attempted = useRef<string | null>(null);
  const descriptionForm = useRef<HTMLFormElement>(null);
  if (saved !== current) {
    setSaved(current);
    const acknowledged = attempted.current === current;
    if (!acknowledged) attempted.current = null;
    if ((!acknowledged && draft === saved) || draft.trim() === current) setDraft(current);
  }
  const normalized = draft.trim();
  const dirty = normalized !== current;
  const failedThisDraft = dirty && Boolean(state.error) && state.values?.description?.trim() === normalized;
  const savedThisDraft = !state.error && attempted.current === normalized;
  const saveState = !dirty || savedThisDraft ? "saved" : "ready";

  useEffect(() => {
    if (!dirty || uploading || saving || attempted.current === normalized) return;
    const timer = window.setTimeout(() => descriptionForm.current?.requestSubmit(), 800);
    return () => window.clearTimeout(timer);
  }, [dirty, normalized, saving, uploading]);

  useLayoutEffect(() => {
    notifyBusy?.(uploading || saving);
  }, [notifyBusy, uploading, saving]);

  useLayoutEffect(() => () => notifyBusy?.(false), [notifyBusy]);

  useLayoutEffect(() => {
    if (uploading || saving || !deferredSave.current) return;
    deferredSave.current = false;
    const form = descriptionForm.current;
    // Wait until the latest draft is in the form and the previous request has finished.
    if (dirty && form && !form.contains(document.activeElement)) form.requestSubmit();
  }, [dirty, uploading, saving]);

  return (
    <form
      ref={descriptionForm}
      data-description-busy={uploading || saving || undefined}
      data-description-save={failedThisDraft && attempted.current === normalized ? "failed" : saveState}
      action={edit}
      onSubmit={(event) => {
        if (saving || uploadInFlight.current || !dirty || attempted.current === normalized) {
          event.preventDefault();
          return;
        }
        attempted.current = normalized;
      }}
      onBlur={(event) => {
        // Keep edits together while moving between the text, toolbar, and file picker.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        if (uploadInFlight.current || saving) {
          deferredSave.current = true;
          return;
        }
        if (dirty) event.currentTarget.requestSubmit();
      }}
    >
      <Ids {...ids} />
      <DescriptionEditor
        key={ids.taskId}
        value={draft}
        onChange={setDraft}
        imagesPath={`/${ids.orgSlug}/${ids.projectSlug}/images`}
        onUploadChange={(next) => {
          uploadInFlight.current = next;
          setUploading(next);
        }}
      />
      <p role="status" className="mt-2 text-xs text-muted-foreground empty:hidden">
        {saving ? "Saving description…" : savedThisDraft ? "Description saved" : ""}
      </p>
      {failedThisDraft && <FieldError state={state} />}
    </form>
  );
}

export type FieldStatus = Pick<Status, "id" | "name" | "color">;

export function DueDateField({ ids, dueDate }: { ids: TaskFieldsIds; dueDate: string | null }) {
  const [state, edit, pending] = useTaskAction(editTaskAction);
  const current = dueDate ?? "";

  return (
    <form
      action={edit}
      onBlur={(event) => {
        const form = event.currentTarget;
        if (form.contains(event.relatedTarget)) return;
        const input = form.elements.namedItem("dueDate");
        if (input instanceof HTMLInputElement && input.validity.valid && input.value !== current) form.requestSubmit();
      }}
    >
      <Ids {...ids} />
      <div className="flex items-center gap-1">
        <input
          key={current}
          type="date"
          name="dueDate"
          min="0001-01-01"
          max="9999-12-31"
          defaultValue={state.values?.dueDate ?? current}
          aria-label="Due date"
          disabled={pending}
          className={cn(SELECT_CLASS, "w-full min-w-0 flex-1")}
        />
        {dueDate && (
          <Button type="submit" name="clearDueDate" value="1" variant="ghost" size="xs" className="shrink-0" formNoValidate disabled={pending}>
            Clear
          </Button>
        )}
      </div>
      <FieldError state={state} />
    </form>
  );
}

const propertyActions = {
  statusId: { label: "Status", action: setStatusAction },
  assigneeUserId: { label: "Assignee", action: assignTaskAction },
  reporterUserId: { label: "Reporter", action: setReporterAction },
  typeId: { label: "Type", action: editTaskAction },
  priority: { label: "Priority", action: editTaskAction },
};

function TaskPropertyPicker({ ids, field, value, options }: {
  ids: TaskFieldsIds;
  field: keyof typeof propertyActions;
  value: string;
  options: DetailPickerOption[];
}) {
  const { label, action } = propertyActions[field];
  const [state, submit, pending] = useTaskAction(action);
  const [optimistic, setOptimistic] = useOptimistic(value);

  function select(next: string) {
    if (pending) return;
    const form = new FormData();
    form.set("org", ids.orgSlug);
    form.set("project", ids.projectSlug);
    form.set("taskId", ids.taskId);
    form.set(field, next);
    startTransition(() => {
      setOptimistic(next);
      submit(form);
    });
  }

  return (
    <div>
      <TaskDetailPicker label={label} value={optimistic} options={options} onSelect={select} pending={pending} />
      <FieldError state={state} />
    </div>
  );
}

export function TypeField({ ids, typeId, taskTypes }: { ids: TaskFieldsIds; typeId: string; taskTypes: TaskTypeRef[] }) {
  return <TaskPropertyPicker ids={ids} field="typeId" value={typeId} options={taskTypes.map((type) => ({
    id: type.id, label: type.name, icon: <TaskTypeIcon icon={type.icon} color={type.color} />,
  }))} />;
}

export function PriorityField({ ids, priority }: { ids: TaskFieldsIds; priority: TaskPriority }) {
  return <TaskPropertyPicker ids={ids} field="priority" value={priority} options={TASK_PRIORITIES.map((id) => ({
    id, label: taskPriorityLabel(id), icon: <span aria-hidden><TaskPriorityIcon priority={id} /></span>,
  }))} />;
}

export function StatusField({ ids, statuses, statusId }: { ids: TaskFieldsIds; statuses: FieldStatus[]; statusId: string }) {
  return <TaskPropertyPicker ids={ids} field="statusId" value={statusId} options={statuses.map(({ id, name, color }) => ({
    id, label: name,
    icon: <CircleDashed aria-hidden className={cn("size-4 shrink-0 text-(--status-color)", statusColorClass(color))} />,
  }))} />;
}

export type FieldPerson = { userId: string; name: string; image?: string | null };

const personOption = (person: FieldPerson) => ({
  id: person.userId,
  label: person.name,
  icon: <ProfileAvatar name={person.name} image={person.image} className="size-5 bg-muted text-xs" />,
});

export function AssigneeField({
  ids,
  people,
  detached,
  assigneeUserId,
}: {
  ids: TaskFieldsIds;
  people: FieldPerson[];
  detached: FieldPerson | null;
  assigneeUserId: string | null;
}) {
  const options = [
    { id: "", label: "Unassigned", icon: <UserRound aria-hidden className="size-4 shrink-0 text-muted-foreground" /> },
    ...people.map(personOption),
    ...(detached ? [{ ...personOption(detached), unavailable: "No longer in this organization" }] : []),
  ];
  return <TaskPropertyPicker ids={ids} field="assigneeUserId" value={assigneeUserId ?? ""} options={options} />;
}

/** A reporter is never cleared, so there is no "Unassigned" option. */
export function ReporterField({
  ids,
  people,
  detached,
  reporterUserId,
}: {
  ids: TaskFieldsIds;
  people: FieldPerson[];
  detached: FieldPerson | null;
  reporterUserId: string;
}) {
  const options = [
    ...people.map(personOption),
    ...(detached ? [{ ...personOption(detached), unavailable: "No longer in this organization" }] : []),
  ];
  return <TaskPropertyPicker ids={ids} field="reporterUserId" value={reporterUserId} options={options} />;
}

export function MoveTaskButton({ ids, targets }: {
  ids: TaskFieldsIds;
  targets: { id: string; name: string }[];
}) {
  const [state, move, pending] = useActionState(transferTaskAction, NO_ERROR);
  const [destination, setDestination] = useState("");
  const [descriptionBlocked, setDescriptionBlocked] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <Popover onOpenChange={(open) => {
      setDescriptionBlocked(false);
      if (open) setDestination(state.values?.destinationProjectId ?? "");
    }}>
      <PopoverTrigger asChild>
        <Button ref={trigger} type="button" variant="outline" size="sm" className="w-full" disabled={pending}>
          Move
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Move to another project"
        align="end"
        collisionPadding={12}
        className="z-[60] w-64 p-4"
      >
        <form
          action={move}
          className="space-y-3"
          onSubmit={(event) => {
            if (!destination) {
              event.preventDefault();
              return;
            }
            const description = trigger.current?.closest("[data-task-detail]")
              ?.querySelector<HTMLFormElement>("form[data-description-save]");
            const blocked = !!description &&
              (description.dataset.descriptionBusy === "true" || description.dataset.descriptionSave !== "saved");
            setDescriptionBlocked(blocked);
            if (blocked) event.preventDefault();
          }}
        >
          <Ids {...ids} />
          <input type="hidden" name="destinationProjectId" value={destination} />
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Destination project</p>
            <TaskDetailPicker
              label="Destination project"
              value={destination}
              placeholder="Choose a project"
              pending={pending}
              onSelect={setDestination}
              options={targets.map(({ id, name }) => ({
                id, label: name, icon: <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />,
              }))}
              className="z-[70]"
            />
          </div>
          <FieldError state={descriptionBlocked ? { error: "Save the description before moving this work item." } : state} />
          <Button type="submit" variant="outline" size="sm" disabled={pending || !destination}>
            {pending ? "Moving…" : "Move work item"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Detaches a sub-task. Re-parenting is MCP-only. */
export function RemoveParentButton({ ids }: { ids: TaskFieldsIds }) {
  const [state, act, pending] = useTaskAction(editTaskAction);

  return (
    <form action={act}>
      <Ids {...ids} />
      <Button type="submit" name="clearParent" value="1" variant="ghost" size="xs" className="-ml-2" disabled={pending}>
        Remove parent
      </Button>
      <FieldError state={state} />
    </form>
  );
}

/**
 * Blurs the focused field first, like the dialog's full-page link, so a
 * blur-save control submits before the route changes.
 */
export function TaskLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const link = useRef<HTMLAnchorElement>(null);
  return (
    <Link
      ref={link}
      href={href}
      prefetch={false}
      className={className}
      onClick={(event) => {
        // Like the dialog's full-page link: wait for an upload or save to finish.
        if (link.current?.closest("[data-task-detail]")?.querySelector("form[data-description-busy]")) event.preventDefault();
      }}
      onNavigate={() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && link.current?.closest("[data-task-detail]")?.contains(active)) active.blur();
      }}
    >
      {children}
    </Link>
  );
}

/** A ghost trigger, not a CTA: the comment button is this view's one primary. */
export function AddSubtask({ ids }: { ids: TaskFieldsIds }) {
  const [open, setOpen] = useState(false);
  const [state, add, pending] = useTaskAction(createTaskAction);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const escaped = useRef(false);

  // Disabling the input while pending drops its focus; take it back so the
  // next title can be typed straight away.
  useEffect(() => {
    if (open && !pending) input.current?.focus();
  }, [open, pending]);

  // Escape returns focus to the trigger it came from.
  useEffect(() => {
    if (!open && escaped.current) {
      escaped.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  if (!open) {
    return (
      // Matches the board's "New work item" row: visible, but not a blue CTA.
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex min-h-9 w-full items-center gap-2 rounded-lg bg-muted px-2.5 text-left text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus aria-hidden className="size-4 shrink-0" />
        Add sub-task
      </button>
    );
  }

  return (
    <form action={add} className="mt-3">
      <Ids {...ids} />
      <input type="hidden" name="parentTaskId" value={ids.taskId} />
      <Input
        ref={input}
        name="title"
        required
        aria-label="Sub-task title"
        placeholder="Sub-task title"
        defaultValue={state.values?.title}
        disabled={pending}
        // The task dialog leaves Escape to this composer.
        data-dialog-keep-escape
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            escaped.current = true;
            setOpen(false);
          }
        }}
        onBlur={(event) => {
          if (!pending && !event.currentTarget.value.trim()) setOpen(false);
        }}
      />
      <FieldError state={state} />
    </form>
  );
}

/**
 * Archiving is reversible — `unarchiveTask` is right next to it — so it is not
 * a destructive confirmation and does not take `--destructive` (§7.5).
 */
export function ArchiveButton({
  ids,
  archived,
  className,
}: {
  ids: TaskFieldsIds;
  archived: boolean;
  className?: string;
}) {
  const [state, act, pending] = useTaskAction(archiveAction);

  return (
    <form action={act}>
      <Ids {...ids} />
      <Button
        type="submit"
        name="intent"
        value={archived ? "unarchive" : "archive"}
        className={className}
        variant="outline"
        size="sm"
        disabled={pending}
      >
        {archived ? "Unarchive" : "Archive"}
      </Button>
      <FieldError state={state} />
    </form>
  );
}

/**
 * §7.5's single `--primary` element for this view. The detail page's one
 * creative act is adding a comment; every other control here edits something
 * that already exists.
 */
export function CommentForm({ ids, people }: { ids: TaskFieldsIds; people: FieldPerson[] }) {
  const [draftVersion, setDraftVersion] = useState(0);
  const [state, add, pending] = useTaskAction(async (previous, form) => {
    const result = await addCommentAction(previous, form);
    if (!result.error) setDraftVersion((version) => version + 1);
    return result;
  });

  return (
    <form action={add} className="mt-6 flex flex-col gap-3">
      <Ids {...ids} />
      <CommentComposer
        key={draftVersion}
        people={people}
        pending={pending}
        className={cn(
          FIELD_CLASS,
          "resize-y bg-input leading-relaxed shadow-subtle-2",
        )}
      />
      <div className="flex items-center justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Posting" : "Comment"}
        </Button>
      </div>
      <FieldError state={state} />
    </form>
  );
}
