"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ui/shimmer";
import { TaskTypeBadge } from "@/components/task-type";
import { TaskPriorityIcon, taskPriorityLabel } from "@/components/task-priority";
import { formatTaskDueDate } from "@/lib/task-due-date";
import type { TaskTypeRef } from "@tasks/core/domain";
import type { TaskPriority } from "@tasks/core/schema";
import { statusDot } from "@/lib/status-style";
import { cn } from "@/lib/utils";
import type { TaskDetailPayload } from "./[task]/details/route";
import type { TaskDetailData } from "./[task]/task-detail-data";
import { TaskDetailContent } from "./[task]/task-detail-content";
import { TaskDescriptionBusy, TaskDetailRefresh } from "./[task]/task-fields";
import { OpenTaskContext, useOpenTaskDialog, type OpenTask } from "./task-dialog-context";

export type TaskPreview = {
  href: string;
  key: string;
  title: string;
  status: { name: string; color: TaskDetailData["detail"]["status"]["color"] };
  assignee: string | null;
  updated: string;
  dueDate?: string | null;
  priority?: TaskPriority;
  type?: TaskTypeRef;
};

export function TaskPreviewLink({
  task,
  children,
  className,
}: {
  task: TaskPreview;
  children: React.ReactNode;
  className?: string;
}) {
  const open = useOpenTaskDialog();
  return (
    <Link
      href={task.href}
      prefetch={false}
      aria-haspopup={open ? "dialog" : undefined}
      className={className}
      onClick={(event) => {
        if (!open || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        open(task, event.currentTarget);
      }}
    >
      {children}
    </Link>
  );
}

export function TaskDialogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [dialogPath, setDialogPath] = useState(pathname);
  const [selection, setSelection] = useState<TaskPreview | null>(null);
  const [descriptionBusy, setDescriptionBusy] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const list = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const closeAfterDescriptionSave = useRef(false);
  const scrollRegion = useRef<HTMLDivElement>(null);
  const open = useCallback<OpenTask>((task, element) => {
    trigger.current = element;
    list.current = element.closest<HTMLElement>("[data-task-list]");
    setSelection(task);
  }, []);

  if (dialogPath !== pathname) {
    setDialogPath(pathname);
    setSelection(null);
    setDescriptionBusy(false);
  }

  function blurActiveField() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && content.current?.contains(active)) active.blur();
  }

  useEffect(() => {
    if (!selection) {
      closeAfterDescriptionSave.current = false;
      return;
    }
    if (descriptionBusy || !closeAfterDescriptionSave.current) return;
    const form = content.current?.querySelector<HTMLFormElement>("form[data-description-save]");
    const saveState = form?.getAttribute("data-description-save");
    if (form && saveState === "ready") {
      form.requestSubmit();
      return;
    }
    closeAfterDescriptionSave.current = false;
    if (saveState === "saved") {
      blurActiveField();
      setSelection(null);
    }
  }, [descriptionBusy, selection]);

  return (
    <OpenTaskContext.Provider value={open}>
      {children}
      <Dialog
        open={selection !== null}
        onOpenChange={(next) => {
          if (next) return;
          if (descriptionBusy) {
            closeAfterDescriptionSave.current = true;
            return;
          }
          const description = content.current?.querySelector<HTMLFormElement>('form[data-description-save="ready"]');
          if (description) {
            closeAfterDescriptionSave.current = true;
            description.requestSubmit();
            return;
          }
          // Blur-save controls need to submit before Radix unmounts them.
          blurActiveField();
          setSelection(null);
        }}
      >
        {selection && (
          <DialogContent
            ref={content}
            showClose={false}
            className="top-0 right-0 left-0 flex h-dvh w-auto max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none bg-task-dialog p-0 md:top-1/2 md:right-auto md:left-1/2 md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-[calc(100%-2rem)] md:max-w-[72rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              scrollRegion.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // Archiving or changing columns can remove the original card.
              (trigger.current?.isConnected ? trigger.current : list.current)?.focus();
            }}
            onEscapeKeyDown={(event) => {
              // Let Escape dismiss the comment suggestions before this dialog.
              if (event.target instanceof HTMLTextAreaElement && event.target.getAttribute("aria-activedescendant")) {
                event.preventDefault();
              }
            }}
          >
            <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border px-4 pb-1 pt-[max(0.25rem,env(safe-area-inset-top))] md:gap-3 md:px-6 md:py-2">
              <Link
                href={selection.href}
                prefetch={false}
                aria-disabled={descriptionBusy || undefined}
                tabIndex={descriptionBusy ? -1 : undefined}
                onClick={(event) => {
                  if (descriptionBusy) event.preventDefault();
                }}
                onNavigate={blurActiveField}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-sm px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-50 md:min-h-8"
              >
                Open full page <ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
              <DialogClose disabled={descriptionBusy} className="size-11 shrink-0 md:size-8" />
            </div>
            <div
              ref={scrollRegion}
              tabIndex={-1}
              className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none [scrollbar-width:none] sm:px-8 sm:py-6 md:py-0 [&::-webkit-scrollbar]:hidden"
            >
              <TaskDescriptionBusy.Provider value={setDescriptionBusy}>
                <TaskDialogBody key={selection.href} preview={selection} />
              </TaskDescriptionBusy.Provider>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </OpenTaskContext.Provider>
  );
}

function decodeDetail(payload: TaskDetailPayload): TaskDetailData {
  const { detail } = payload;
  return {
    ...payload,
    detail: {
      ...detail,
      createdAt: new Date(detail.createdAt),
      updatedAt: new Date(detail.updatedAt),
      archivedAt: detail.archivedAt ? new Date(detail.archivedAt) : null,
      comments: detail.comments.map((entry) => ({ ...entry, createdAt: new Date(entry.createdAt) })),
      activity: detail.activity.map((entry) => ({ ...entry, createdAt: new Date(entry.createdAt) })),
    },
  };
}

function TaskDialogBody({ preview }: { preview: TaskPreview }) {
  const [data, setData] = useState<TaskDetailData | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setFailed(false);

    try {
      const response = await fetch(`${preview.href}/details`, {
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new Error("Task details unavailable");
      const next = decodeDetail(await response.json() as TaskDetailPayload);
      if (!controller.signal.aborted) setData(next);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    }
  }, [preview.href]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [refresh]);

  return (
    <TaskDetailRefresh.Provider value={refresh}>
      <DialogTitle className="sr-only">{preview.key} {data?.detail.title ?? preview.title}</DialogTitle>
      <div className="md:py-6">
        {data ? <TaskDetailContent data={data} inDialog /> : <PendingTask preview={preview} loading={!failed} />}
        {failed && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-destructive">Couldn’t load task details.</p>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>Try again</Button>
          </div>
        )}
      </div>
    </TaskDetailRefresh.Provider>
  );
}

function PendingTask({ preview, loading }: { preview: TaskPreview; loading: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_18rem] md:gap-x-8">
      <div className="min-w-0">
        <p className="stutter numeral">{preview.key}</p>
        <p className="mt-4 text-2xl wrap-anywhere">{preview.title}</p>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-4 self-start rounded-2xl bg-card p-4 shadow-subtle min-[420px]:max-md:grid-cols-2 md:col-start-2 md:row-start-1 md:row-span-2 md:p-6">
        <div>
          <dt className="stutter">Status</dt>
          <dd className="mt-1 flex items-center gap-2 text-sm wrap-anywhere">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", statusDot(preview.status.color))} />
            {preview.status.name}
          </dd>
        </div>
        <div>
          <dt className="stutter">Assignee</dt>
          <dd className="mt-1 text-sm wrap-anywhere">{preview.assignee ?? "Unassigned"}</dd>
        </div>
        {preview.type && (
          <div>
            <dt className="stutter">Type</dt>
            <dd className="mt-1 text-sm wrap-anywhere"><TaskTypeBadge type={preview.type} /></dd>
          </div>
        )}
        {preview.dueDate !== undefined && (
          <div>
            <dt className="stutter">Due date</dt>
            <dd className="mt-1 text-sm">
              {preview.dueDate ? <time dateTime={preview.dueDate}>{formatTaskDueDate(preview.dueDate)}</time> : "No due date"}
            </dd>
          </div>
        )}
        {preview.priority && (
          <div>
            <dt className="stutter">Priority</dt>
            <dd className="mt-1 flex items-center gap-2 text-sm">
              <span aria-hidden><TaskPriorityIcon priority={preview.priority} /></span>
              {taskPriorityLabel(preview.priority)}
            </dd>
          </div>
        )}
        <div>
          <dt className="stutter">Updated</dt>
          <dd className="mt-1 stutter numeral">{preview.updated}</dd>
        </div>
      </dl>
      {loading && (
        <div className="min-w-0 space-y-6">
          <span role="status" className="sr-only">Loading task details</span>
          <div className="space-y-2">
            <Shimmer className="h-3 w-4/5" />
            <Shimmer className="h-3 w-1/2" />
          </div>
          {["Comments", "Activity"].map((label) => (
            <div key={label} className="border-t border-border pt-4">
              <p className="stutter mb-3">{label}</p>
              <Shimmer className="h-8 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
