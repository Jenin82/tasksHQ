import { canEditTask } from "@tasks/core/access";
import { listWorkspaceAssignments } from "@tasks/core/domain";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getTeamContext, listUserTeams } from "@/lib/team-context";
import { cn } from "@/lib/utils";
import { TaskDialogProvider } from "../../[project]/task-dialog";
import { AssignmentCreateTask } from "./assignment-create-task";
import { listAssignmentCreateProjects } from "./assignment-create-projects";
import { readAssignmentEditors } from "./workspace-assignment-editors";
import { WorkspaceAssignmentTable } from "./workspace-assignment-table";

export async function WorkspaceAssignmentPage({ teamSlug, view, allTeams = false }: {
  teamSlug: string;
  view: "mine" | "assigned" | "reports";
  allTeams?: boolean;
}) {
  const { team, user, member } = await getTeamContext(teamSlug);
  const teams = allTeams ? await listUserTeams(user.id) : [{ ...team, role: member.role }];
  if (allTeams && teams.length < 2) redirect(`/${team.slug}/settings/your-tasks`);

  const ctx = { db, actorUserId: user.id, source: "web" as const };
  const reports = view === "reports";
  const [assignments, createTeams] = await Promise.all([
    Promise.all(teams.map(async (workspace) => {
      const tasks = await listWorkspaceAssignments(ctx, { teamId: workspace.id, view });
      const editors = await readAssignmentEditors(workspace.id, user.id, tasks);
      return {
        tasks: tasks.map((task) => ({
          ...task,
          teamSlug: workspace.slug,
          teamName: workspace.name,
          canEdit: canEditTask(editors[task.projectId].canEditAnyTask, user.id, task.createdBy.id, task.assignee.id, task.reportedBy.id),
        })),
        editors,
      };
    })),
    reports ? [] : listAssignmentCreateProjects(teams, user.id),
  ]);
  const tasks = assignments.flatMap((assignment) => assignment.tasks);
  const editors = Object.assign({}, ...assignments.map((assignment) => assignment.editors));
  const title = allTeams ? "All My Tasks" : reports ? "Your Reports" : "Your Tasks";
  const scope = allTeams ? "across your teams" : "in this workspace";
  const description = view === "assigned" ? `Active tasks you assigned to others ${scope}.`
    : reports ? "Active tasks assigned to your direct reports." : `Active tasks assigned to you ${scope}.`;
  const empty = view === "assigned" ? "You haven’t assigned any active tasks to others."
    : reports ? "No active tasks are assigned to your direct reports." : "No active tasks are assigned to you.";
  const yourTasksPath = `/${team.slug}/settings/${allTeams ? "all-tasks" : "your-tasks"}`;

  return (
    <TaskDialogProvider>
      <main data-task-list tabIndex={-1} className="min-w-0 px-4 py-8 sm:px-10 sm:py-12">
        <h1 className="text-2xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {!reports && (
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
              teams={createTeams}
              currentTeamSlug={team.slug}
              showTeam={allTeams}
            />
          </div>
        )}
        <WorkspaceAssignmentTable
          title={title}
          tasks={tasks}
          editors={editors}
          emptyMessage={empty}
          teams={allTeams ? teams.map(({ slug, name }) => ({ slug, name })) : undefined}
          showProjectFilter={!reports}
          // "team" is the pre-rename view name, kept so saved Your Reports filters survive.
          filterScope={JSON.stringify([user.id, allTeams ? null : team.id, "assignments", reports ? "team" : view])}
        />
      </main>
    </TaskDialogProvider>
  );
}
