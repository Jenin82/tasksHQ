"use client";

import { lazy, Suspense, useActionState, useRef, useState } from "react";
import type { TaskTypeRef } from "@tasks/core/domain";
import { Plus } from "lucide-react";
import { createTaskAction, type CreateTaskState } from "@/app/[org]/[project]/actions";
import { useOpenTaskDialog } from "@/app/[org]/[project]/task-dialog-context";
import type { TaskPreview } from "@/app/[org]/[project]/task-dialog";
import { NO_ERROR } from "@/lib/action-result";
import { TaskTypeIcon } from "./task-type";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

const DescriptionEditor = lazy(() => import("@/app/[org]/[project]/[task]/description-editor")
  .then(({ DescriptionEditor }) => ({ default: DescriptionEditor })));

export type CreateTarget = {
  org: string;
  taskTypes: (TaskTypeRef & { isDefault: boolean })[];
  project: { slug: string; name: string; key: string };
};

export function AddWorkItemButton(target: CreateTarget) {
  const openTask = useOpenTaskDialog();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const created = useRef<TaskPreview | null>(null);

  return (
    <>
      <Button ref={trigger} type="button" aria-haspopup="dialog" className="rounded-md" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add work item
      </Button>
      {open && <CreateWorkItem
        {...target}
        onClose={() => setOpen(false)}
        onCreated={(task) => {
          created.current = task;
          setOpen(false);
        }}
        onClosed={() => {
          const task = created.current;
          created.current = null;
          if (!trigger.current?.isConnected) return;
          if (task) openTask?.(task, trigger.current);
          else trigger.current.focus();
        }}
      />}
    </>
  );
}

function CreateWorkItem({ org, project, taskTypes, onClose, onCreated, onClosed }: CreateTarget & {
  onClose: () => void;
  onCreated: (task: TaskPreview) => void;
  onClosed: () => void;
}) {
  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState(taskTypes.find((type) => type.isDefault)?.id ?? "");
  const selectedType = taskTypes.find((type) => type.id === typeId);
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadInFlight = useRef(false);
  const [state, action, pending] = useActionState(async (previous: CreateTaskState, data: FormData) => {
    const next = await createTaskAction(previous, data);
    if (next.task) onCreated(next.task);
    return next;
  }, NO_ERROR);

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <DialogContent
        showClose={false}
        className="flex max-h-[calc(100dvh-1.5rem)] max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card p-0 shadow-none"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        <header className="relative shrink-0 border-b border-border px-4 py-4 pr-14 sm:px-6 sm:pr-16">
          <DialogTitle className="font-semibold">Add work item</DialogTitle>
          <DialogDescription className="mt-1 flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className="numeral shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground">{project.key}</span>
            <span className="truncate">{project.name}</span>
          </DialogDescription>
          <DialogClose disabled={pending} className="absolute top-3 right-3 rounded-md hover:bg-muted sm:top-4 sm:right-4" />
        </header>
        <form action={action} className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
          if (pending || uploadInFlight.current) event.preventDefault();
        }}>
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="project" value={project.slug} />
          <div className="min-h-0 space-y-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5" inert={pending}>
            <div className="space-y-2">
              <label htmlFor="create-work-item-title" className="block text-sm font-medium">Title</label>
              <Input
                id="create-work-item-title"
                name="title"
                autoFocus
                required
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="What needs to be done?"
                className="h-10 rounded-md border border-border bg-background focus-visible:ring-1"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="create-work-item-type" className="block text-sm font-medium">Type</label>
              <div className="flex items-center gap-2">
                {selectedType && <TaskTypeIcon icon={selectedType.icon} color={selectedType.color} />}
                <select
                  id="create-work-item-type"
                  name="typeId"
                  value={typeId}
                  onChange={(event) => setTypeId(event.currentTarget.value)}
                  className="h-10 max-w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {taskTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Description <span className="ml-1 text-xs font-normal text-muted-foreground">Optional</span></p>
              <Suspense fallback={<p role="status" className="min-h-32 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">Loading editor…</p>}>
                <DescriptionEditor
                  value={description}
                  onChange={setDescription}
                  imagesPath={`/${org}/${project.slug}/images`}
                  onUploadChange={(next) => {
                    uploadInFlight.current = next;
                    setUploading(next);
                  }}
                />
              </Suspense>
            </div>
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-2 border-t border-border px-4 py-3 sm:px-6">
            {state.error && <p role="alert" className="basis-full text-sm text-destructive">{state.error}</p>}
            <Button type="button" variant="ghost" className="h-9 rounded-md" disabled={pending} onClick={onClose}>Cancel</Button>
            <Button type="submit" className="h-9 rounded-md" disabled={pending || uploading || !title.trim()}>
              {pending ? "Adding…" : "Add work item"}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
