import { can, canEditAnyTask, canEditTask } from "@tasks/core/access";
import { listTasks } from "@tasks/core/domain";
import { TaskTypeBadge } from "@/components/task-type";
import { db } from "@/lib/db";
import { shortDate, shortDateTime } from "@/lib/format";
import { getProjectContext } from "@/lib/project-context";
import { statusDot } from "@/lib/status-style";
import { cn } from "@/lib/utils";
import { ArchiveButton } from "../[task]/task-fields";
import { TaskPreviewLink } from "../task-dialog";
import { DeleteTaskButton } from "./delete-task-button";

export default async function ArchivedPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  const access = await getProjectContext(orgSlug, projectSlug);
  const { org, project, member, user } = access;
  const tasks = await listTasks(
    { db, actorUserId: user.id, source: "web" },
    { projectId: project.id, archivedOnly: true },
  );
  const canEditAny = canEditAnyTask(access);
  const canDelete = can(member.role, "task:delete_archived");

  return (
      <section
        aria-labelledby="archived-heading"
        data-task-list
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl px-4 py-10 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-10"
      >
        <div className="flex items-baseline justify-between gap-6">
          <h2 id="archived-heading" className="text-2xl">Archived tasks</h2>
          <span className="stutter numeral">{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Unarchive a task to return it to the board and table.</p>

        {tasks.length === 0 ? (
          <p className="mt-8 border-t border-border pt-6 text-muted-foreground">No archived tasks.</p>
        ) : (
          <ul className="mt-8 divide-y divide-border border-y border-border">
            {tasks.map((task) => {
              const ids = { orgSlug: org.slug, projectSlug: project.slug, taskId: task.id };
              const canEdit = canEditTask(canEditAny, user.id, task.createdBy.id, task.assignee?.id);
              return (
              <li key={task.id} className="grid items-center gap-x-6 gap-y-3 py-4 lg:grid-cols-[minmax(0,1fr)_10rem_auto]">
                <TaskPreviewLink
                  task={{
                    href: `/${org.slug}/${project.slug}/${task.key}`,
                    key: task.key,
                    title: task.title,
                    status: task.status,
                    assignee: task.assignee?.displayName ?? null,
                    updated: shortDate(task.updatedAt),
                    dueDate: task.dueDate,
                    priority: task.priority,
                    type: task.type,
                  }}
                  className="block w-fit max-w-full rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="stutter numeral">{task.key}</span>
                  <span className="mt-1 block wrap-anywhere">{task.title}</span>
                </TaskPreviewLink>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 lg:flex-col lg:items-start">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", statusDot(task.status.color))} />
                    <span className="stutter wrap-anywhere">{task.status.name}</span>
                  </span>
                  <TaskTypeBadge type={task.type} />
                  {task.archivedAt && (
                    <time dateTime={task.archivedAt.toISOString()} className="stutter numeral">
                      Archived {shortDateTime(task.archivedAt)}
                    </time>
                  )}
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-start gap-2">
                    <ArchiveButton ids={ids} archived />
                    {canDelete && <DeleteTaskButton ids={ids} taskKey={task.key} title={task.title} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
