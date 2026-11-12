"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { createTaskAction, type CreateTaskState } from "@/app/[org]/[project]/actions";
import type { TaskPreview } from "@/app/[org]/[project]/task-dialog";
import { useOpenTaskDialog } from "@/app/[org]/[project]/task-dialog-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NO_ERROR } from "@/lib/action-result";

type Organization = {
  slug: string;
  name: string;
  projects: { slug: string; name: string; key: string }[];
};

type CreateTaskProps = {
  organizations: Organization[];
  currentOrgSlug: string;
  showOrganization: boolean;
};

export function AssignmentCreateTask(props: CreateTaskProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const created = useRef<TaskPreview | null>(null);
  const openTask = useOpenTaskDialog();

  return (
    <>
      <Button ref={trigger} type="button" aria-haspopup="dialog" className="ml-auto rounded-md" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add task
      </Button>
      {open && (
        <AssignmentCreateForm
          {...props}
          onClose={() => setOpen(false)}
          onCreated={(task) => {
            created.current = task;
            setOpen(false);
          }}
          onClosed={() => {
            const task = created.current;
            created.current = null;
            if (!trigger.current?.isConnected) return;
            if (task && openTask) openTask(task, trigger.current);
            else trigger.current.focus();
          }}
        />
      )}
    </>
  );
}

const selectClass = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function AssignmentCreateForm({
  organizations, currentOrgSlug, showOrganization, onClose, onCreated, onClosed,
}: CreateTaskProps & {
  onClose: () => void;
  onCreated: (task: TaskPreview) => void;
  onClosed: () => void;
}) {
  const id = useId();
  const available = organizations.filter(({ projects }) => projects.length > 0);
  const initialOrg = available.find(({ slug }) => slug === currentOrgSlug) ?? available[0];
  const [orgSlug, setOrgSlug] = useState(initialOrg?.slug ?? currentOrgSlug);
  const [projectSlug, setProjectSlug] = useState(
    initialOrg?.projects.length === 1 ? initialOrg.projects[0].slug : "",
  );
  const [title, setTitle] = useState("");
  const [assignSelf, setAssignSelf] = useState(true);
  const organization = available.find(({ slug }) => slug === orgSlug);
  const project = organization?.projects.find(({ slug }) => slug === projectSlug);
  const [state, action, pending] = useActionState(async (previous: CreateTaskState, data: FormData) => {
    const next = await createTaskAction(previous, data);
    if (next.task) onCreated(next.task);
    return next;
  }, NO_ERROR);

  function changeOrganization(slug: string) {
    const next = available.find((option) => option.slug === slug);
    setOrgSlug(slug);
    setProjectSlug(next?.projects.length === 1 ? next.projects[0].slug : "");
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <DialogContent closeDisabled={pending} className="max-h-[calc(100dvh-2rem)] overflow-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}>
        <DialogTitle>Add task</DialogTitle>
        <DialogDescription>Choose a project and give the task a name.</DialogDescription>
        <form action={action} className="mt-5 space-y-4" onSubmit={(event) => {
          if (pending || !project) event.preventDefault();
        }}>
          {showOrganization && available.length > 0 ? (
            <div className="space-y-1.5">
              <label htmlFor={`${id}-org`} className="block text-sm font-medium">Organization</label>
              <select id={`${id}-org`} name="org" value={orgSlug} className={selectClass} disabled={pending}
                onChange={(event) => changeOrganization(event.currentTarget.value)}>
                {available.map(({ slug, name }) => <option key={slug} value={slug}>{name}</option>)}
              </select>
            </div>
          ) : <input type="hidden" name="org" value={orgSlug} />}
          <div className="space-y-1.5">
            <label htmlFor={`${id}-project`} className="block text-sm font-medium">Project</label>
            <select id={`${id}-project`} name="project" value={projectSlug} className={selectClass} required
              disabled={pending || !organization} onChange={(event) => setProjectSlug(event.currentTarget.value)}>
              <option value="" disabled>{organization ? "Choose a project" : "No projects available"}</option>
              {organization?.projects.map(({ slug, key, name }) => (
                <option key={slug} value={slug}>{name} ({key})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-title`} className="block text-sm font-medium">Task name</label>
            <Input id={`${id}-title`} name="title" required disabled={pending} value={title}
              onChange={(event) => setTitle(event.currentTarget.value)} placeholder="What needs to be done?" />
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="assignSelf" checked={assignSelf}
                disabled={pending}
                onChange={(event) => setAssignSelf(event.currentTarget.checked)} />
              Assign yourself
            </label>
          </div>
          {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="rounded-md" disabled={pending} onClick={onClose}>Cancel</Button>
            <Button type="submit" className="rounded-md" disabled={pending || !project || !title.trim()}>
              {pending ? "Creating…" : "Create task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
