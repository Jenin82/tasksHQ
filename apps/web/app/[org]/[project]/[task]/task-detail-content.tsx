import { CircleDashed, UserRound } from "lucide-react";
import type { TaskWithHistory } from "@tasks/core/domain";
import { ProfileAvatar } from "@/components/profile-avatar";
import { TaskPriorityIcon, taskPriorityLabel } from "@/components/task-priority";
import { TaskTypeBadge } from "@/components/task-type";
import { shortDateTime } from "@/lib/format";
import { statusColorClass } from "@/lib/status-style";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { cn } from "@/lib/utils";
import { ActivityLog, groupDescriptionActivity, SourceBadge } from "./activity-log";
import { DescriptionEditor } from "./description-editor";
import type { TaskDetailData } from "./task-detail-data";
import {
  ArchiveButton,
  AssigneeField,
  CommentForm,
  DescriptionField,
  DueDateField,
  MoveTaskButton,
  PriorityField,
  StatusField,
  TitleField,
  TypeField,
} from "./task-fields";
import { ShareTaskButton } from "./share-task-button";

/** §7.2: a section rule, not a card. The hairline is the only boundary. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 border-t border-border pt-6 sm:mt-12">
      <div className="flex items-baseline justify-between gap-6">
        <h3 className="stutter">{title}</h3>
        {/* §7.1: the count sits at the far edge with whitespace as the only
            separator — never `Comments (3)`. */}
        {count === undefined ? null : (
          <span className="stutter numeral">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Property({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <dt className="stutter">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function CommentBody({ comment }: { comment: TaskWithHistory["comments"][number] }) {
  if (!comment.mentions?.length) return comment.body;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const { start, end } of comment.mentions) {
    parts.push(comment.body.slice(cursor, start));
    parts.push(
      <span key={start} className="box-decoration-clone rounded-sm bg-primary/10 px-0.5 font-semibold text-foreground">
        {comment.body.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  return [...parts, comment.body.slice(cursor)];
}

function Comments({ comments }: { comments: TaskWithHistory["comments"] }) {
  if (comments.length === 0) {
    return (
      <p className="mt-4 text-base text-muted-foreground">
        No comments yet. The first one starts the thread.
      </p>
    );
  }

  return (
    <ul className="mt-4 divide-y divide-border/50">
      {comments.map((c) => (
        <li key={c.id} className="py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="min-w-0 text-sm font-medium wrap-anywhere">
              {c.author.displayName}
            </span>
            <span className="flex items-baseline gap-4">
              <SourceBadge source={c.source} />
              <span className="stutter numeral">
                {shortDateTime(c.createdAt)}
              </span>
            </span>
          </div>
          <p className="mt-1.5 leading-relaxed wrap-anywhere whitespace-pre-wrap"><CommentBody comment={c} /></p>
        </li>
      ))}
    </ul>
  );
}

export function TaskDetailContent({
  data: { detail, canEdit, statuses, taskTypes, assignable, detached, ids, moveTargets },
  inDialog = false,
}: {
  data: TaskDetailData;
  inDialog?: boolean;
}) {
  const activity = groupDescriptionActivity(detail.activity);
  const { assignee, description, dueDate, priority, status, type } = detail;
  const readOnlyValue = "flex min-h-8 items-center gap-2 text-sm";
  const heading = (
    <>
      {/* The visible title is an input, which is no heading. An h2: the
          project layout owns the page's h1. */}
      {canEdit && !inDialog && (
        <h2 className="sr-only">
          {detail.key} {detail.title}
        </h2>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="stutter numeral shrink-0">{detail.key}</span>
          <TaskTypeBadge type={detail.type} />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {detail.archivedAt ? (
            <span className="stutter numeral">
              Archived {shortDateTime(detail.archivedAt)}
            </span>
          ) : null}
          <ShareTaskButton
            key={ids.taskId}
            orgSlug={ids.orgSlug}
            projectSlug={ids.projectSlug}
            taskKey={detail.key}
          />
        </div>
      </div>

      {canEdit ? <TitleField ids={ids} title={detail.title} /> : (
        <>
          {inDialog ? <p className="mt-3 text-2xl">{detail.title}</p> : (
            <h2 className="mt-3 text-2xl"><span className="sr-only">{detail.key} </span>{detail.title}</h2>
          )}
          <p className="mt-2 text-sm text-muted-foreground">Only the creator, current assignee, or an admin can edit this task.</p>
        </>
      )}

      {/* Archived tasks are filtered out of the board and table (§18). */}
      {detail.archivedAt ? (
        <p className="mt-3 text-muted-foreground">
          This task is archived, so it stays out of the board and the table
          until it is unarchived.
        </p>
      ) : null}
    </>
  );

  return (
    <div data-task-detail className={cn("min-w-0 wrap-anywhere", !inDialog && "w-full px-4 py-8 sm:px-10 sm:py-12")}>
      {!inDialog && heading}
      {/* §7.2: the properties sit to the right of the content they describe,
          in the one card panel on the page. */}
      <div
        className={cn(
          "grid grid-cols-1 gap-x-8",
          inDialog
            ? "md:grid-cols-[minmax(0,1fr)_18rem] md:grid-rows-[auto_1fr]"
            : "mt-6 sm:mt-10 lg:grid-cols-[minmax(0,1fr)_16rem] lg:grid-rows-[auto_1fr]",
        )}
      >
        <div className="min-w-0">
          {inDialog && heading}
          <div className={inDialog ? "mt-6 sm:mt-10" : undefined}>
            {canEdit ? <DescriptionField ids={ids} description={description} /> : description ? (
              <DescriptionEditor key={ids.taskId} value={description} imagesPath={`/${ids.orgSlug}/${ids.projectSlug}/images`} readOnly />
            ) : <p className="text-sm text-muted-foreground">No description</p>}
          </div>
        </div>

        <aside
          className={cn(
            "mt-6 min-w-0 self-start rounded-2xl bg-card p-4 shadow-subtle sm:p-6",
            inDialog
              // Reserve room for the dialog header, padding, and outer gutters.
              ? "md:sticky md:top-6 md:col-start-2 md:row-start-1 md:row-span-2 md:mt-0 md:max-h-[calc(100dvh-8rem-1px)] md:overflow-y-auto md:scrollbar-thin"
              // Project tabs wrap below xl. Reserve the page’s bottom padding too.
              : "lg:sticky lg:top-(--task-properties-top) lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:mt-0 lg:max-h-[calc(100dvh-var(--task-properties-top)-3rem)] lg:overflow-y-auto lg:scrollbar-thin lg:[--task-properties-top:9.75rem] xl:[--task-properties-top:7.5rem]",
          )}
        >
          <dl className={cn(
            "grid grid-cols-1 gap-x-4 gap-y-5",
            inDialog ? "min-[420px]:max-md:grid-cols-2" : "min-[420px]:max-lg:grid-cols-2",
          )}>
            <Property label="Status">
              {canEdit ? <StatusField ids={ids} statuses={statuses} statusId={status.id} /> : (
                <span className={readOnlyValue}>
                  <CircleDashed aria-hidden className={cn("size-4 shrink-0 text-(--status-color)", statusColorClass(status.color))} />
                  {status.name}
                </span>
              )}
            </Property>
            <Property label="Assignee">
              {canEdit ? <AssigneeField ids={ids} people={assignable} detached={detached} assigneeUserId={assignee?.id ?? null} /> : (
                <span className={readOnlyValue}>
                  {assignee ? <ProfileAvatar name={assignee.displayName} image={assignee.image} className="size-5" /> : (
                    <UserRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  {assignee?.displayName ?? "Unassigned"}
                </span>
              )}
            </Property>
            <Property label="Due date" className="col-span-full">
              {canEdit ? <DueDateField ids={ids} dueDate={dueDate} /> : (
                <span className={readOnlyValue}>
                  {dueDate ? <time dateTime={dueDate}>{formatTaskDueDate(dueDate)}</time> : "No due date"}
                </span>
              )}
            </Property>
            <Property label="Type">
              {canEdit ? <TypeField ids={ids} typeId={type.id} taskTypes={taskTypes} /> : <TaskTypeBadge type={type} />}
            </Property>
            <Property label="Priority">
              {canEdit ? <PriorityField ids={ids} priority={priority} /> : (
                <span className={readOnlyValue}>
                  <span aria-hidden><TaskPriorityIcon priority={priority} /></span>
                  {taskPriorityLabel(priority)}
                </span>
              )}
            </Property>
            <Property label="Created">
              <span className="stutter numeral">
                {shortDateTime(detail.createdAt)}
              </span>
            </Property>
            <Property label="Created by">
              <span className="text-sm wrap-anywhere">{detail.createdBy.displayName}</span>
            </Property>
            <Property label="Updated">
              <span className="stutter numeral">
                {shortDateTime(detail.updatedAt)}
              </span>
            </Property>
          </dl>
          {canEdit && (
            <div className={cn("mt-6 pt-2", moveTargets.length > 0 && "grid grid-cols-2 items-start gap-2")}>
              {moveTargets.length > 0 && <MoveTaskButton ids={ids} targets={moveTargets} />}
              <ArchiveButton ids={ids} archived={detail.archivedAt !== null} className="w-full" />
            </div>
          )}
        </aside>

        <div className="min-w-0">
          <Section title="Comments" count={detail.comments.length}>
            <Comments comments={detail.comments} />
            <CommentForm key={ids.taskId} ids={ids} people={assignable} />
          </Section>

          <Section title="Activity" count={activity.length}>
            <div className="mt-4">
              <ActivityLog entries={activity} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
