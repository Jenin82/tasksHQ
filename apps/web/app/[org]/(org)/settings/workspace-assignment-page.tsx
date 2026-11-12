import { canEditTask } from "@tasks/core/access";
import { listWorkspaceAssignments } from "@tasks/core/domain";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getOrgContext, listUserOrganizations } from "@/lib/org-context";
import { cn } from "@/lib/utils";
import { TaskDialogProvider } from "../../[project]/task-dialog";
import { AssignmentCreateTask } from "./assignment-create-task";
import { listAssignmentCreateProjects } from "./assignment-create-projects";
import { readAssignmentEditors } from "./workspace-assignment-editors";
import { WorkspaceAssignmentTable } from "./workspace-assignment-table";

export async function WorkspaceAssignmentPage({ orgSlug, view, allOrganizations = false }: {
  orgSlug: string;
  view: "mine" | "assigned" | "team";
  allOrganizations?: boolean;
}) {
  const { org, user, member } = await getOrgContext(orgSlug);
  const organizations = allOrganizations ? await listUserOrganizations(user.id) : [{ ...org, role: member.role }];
  if (allOrganizations && organizations.length < 2) redirect(`/${org.slug}/settings/your-tasks`);

  const ctx = { db, actorUserId: user.id, source: "web" as const };
  const team = view === "team";
  const [assignments, createOrganizations] = await Promise.all([
    Promise.all(organizations.map(async (workspace) => {
      const tasks = await listWorkspaceAssignments(ctx, { orgId: workspace.id, view });
      const editors = await readAssignmentEditors(workspace.id, user.id, tasks);
      return {
        tasks: tasks.map((task) => ({
          ...task,
          orgSlug: workspace.slug,
          orgName: workspace.name,
          canEdit: canEditTask(editors[task.projectId].canEditAnyTask, user.id, task.createdBy.id, task.assignee.id),
        })),
        editors,
      };
    })),
    team ? [] : listAssignmentCreateProjects(organizations, user.id),
  ]);
  const tasks = assignments.flatMap((assignment) => assignment.tasks);
  const editors = Object.assign({}, ...assignments.map((assignment) => assignment.editors));
  const title = allOrganizations ? "All My Tasks" : team ? "Your Team" : "Your Tasks";
  const scope = allOrganizations ? "across your organizations" : "in this workspace";
  const description = view === "assigned" ? `Active tasks you assigned to others ${scope}.`
    : team ? "Active tasks assigned to your direct reports." : `Active tasks assigned to you ${scope}.`;
  const empty = view === "assigned" ? "You haven’t assigned any active tasks to others."
    : team ? "No active tasks are assigned to your direct reports." : "No active tasks are assigned to you.";
  const yourTasksPath = `/${org.slug}/settings/${allOrganizations ? "all-tasks" : "your-tasks"}`;

  return (
    <TaskDialogProvider>
      <main data-task-list tabIndex={-1} className="min-w-0 px-4 py-8 sm:px-10 sm:py-12">
        <h1 className="text-2xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {!team && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <nav aria-label={`${title} views`} className="inline-flex gap-1 rounded-md border border-border bg-muted p-1">
              {([
                ["mine", "Assigned to you", yourTasksPath],
                ["assigned", "Assigned by you", `${yourTasksPath}?view=assigned`],
              ] as const).map(([mode, label, href]) => (
                <Link
                  key={mode}
                  href={href}
                  aria-current={view === mode ? "page" : undefined}
                  className={cn(
                    "rounded px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    view === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <AssignmentCreateTask
              organizations={createOrganizations}
              currentOrgSlug={org.slug}
              showOrganization={allOrganizations}
            />
          </div>
        )}
        <WorkspaceAssignmentTable
          title={title}
          tasks={tasks}
          editors={editors}
          emptyMessage={empty}
          organizations={allOrganizations ? organizations.map(({ slug, name }) => ({ slug, name })) : undefined}
          showProjectFilter={!team}
          filterScope={JSON.stringify([user.id, allOrganizations ? null : org.id, "assignments", view])}
        />
      </main>
    </TaskDialogProvider>
  );
}
