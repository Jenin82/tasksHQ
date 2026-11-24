// The "What's new" notes, newest first. A user-facing change adds an entry at
// the top with a new id, which shows the dot again; a released id never changes.
export type ChangelogEntry = {
  id: string;
  /** Calendar date, `YYYY-MM-DD`. */
  date: string;
  title: string;
  items: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-11-19-org-time-and-reporting",
    date: "2026-11-19",
    title: "One Time page, Super admins and team admins",
    items: [
      "Your Time and Team Time are now one Time page at the top of the sidebar. It shows your own time first; use Add people to see others, or remove the last person to see everyone you can. This browser remembers your last filter, and old links still take you there.",
      "When you're one of the people shown, the week view lists your entries so you can add, edit or delete time in teams you belong to. Entries from teams you only manage are read-only.",
      "The Time page covers every team you can see, or just one. Leads see their reports' time only in teams they share. The CSV follows the filter and has a new Team column at the end.",
      "Organization owners are now called Super admins. Organization roles are Super admin, Admin and Member.",
      "Teams have Admin and Member roles only. Every team owner is now a team admin, and team admins can delete projects. Only a Super admin can delete a team, from its General settings.",
      "Super admins and admins get a Settings section in the sidebar with Teams, Members, Reporting lines and General. Your team's own link is now Team settings.",
      "Only Super admins and admins manage reporting lines. Each person has one lead across the organization, and the line applies in every team the two people share. Where someone had different leads in different teams, the line from their oldest team was kept, and lines that formed a loop were removed.",
      "The Your Team page has been removed. Use the Time page to see your reports' time.",
      "MCP time tools cover every team you can open when you leave out team, and their results name each entry's team.",
    ],
  },
  {
    id: "2026-11-19-organization-layer",
    date: "2026-11-19",
    title: "One organization above your teams",
    items: [
      "Your teams now sit in one organization. Super admins and admins manage its members, teams and name from Settings in the sidebar.",
      "Removing someone from the organization removes them from every team, unassigns their tasks and stops their timer.",
      "Super admins and admins can open and manage every team without joining it. Join a team to be assigned, mentioned or track time there.",
      "Every existing team owner is now an organization Super admin and can open, manage and delete every team. Super admins should check the list in Settings › Members and change anyone who should not have that reach.",
      "Only Super admins and admins create teams, and a team no longer needs an admin of its own.",
      "New accounts need an invitation unless the deployment sets a signup allowlist.",
      "MCP tools no longer accept org; use team.",
    ],
  },
  {
    id: "2026-11-19-organizations-are-teams",
    date: "2026-11-19",
    title: "Organizations are now teams",
    items: [
      "Organizations are now called teams. Your members, projects and links stay the same.",
      "The Your Team page has been removed. Use the Time page to see your reports' time.",
      "MCP tools take and return team instead of org.",
    ],
  },
  {
    id: "2026-11-18-sidebar-organizations",
    date: "2026-11-18",
    title: "Organizations in the sidebar",
    items: [
      "If you belong to more than one organization, they're listed in the sidebar under All My Tasks. Pick one to switch to it; its projects show below.",
      "Use + next to Organizations to create one without leaving your workspace.",
      "Collapse the Organizations and Workspace sections with the arrow beside each heading. This browser remembers your choice.",
      "The organization name in the top bar links to its projects page.",
    ],
  },
  {
    id: "2026-11-18-project-settings",
    date: "2026-11-18",
    title: "Project settings and an easier timer",
    items: [
      "Owners and admins can rename a project and change its URL. Old links keep working.",
      "Project settings is split into General, Workflow, Admins and Integrations pages.",
      "The task timer sits at the top of the task panel, with your saved time behind Your entries.",
      "This What's new button shows what changed.",
    ],
  },
  {
    id: "2026-11-17-time-tracking",
    date: "2026-11-17",
    title: "Time tracking",
    items: [
      "Start a timer or add time on any open task.",
      "See your hours by day and week in Your Time.",
      "Owners and admins see everyone's hours in Team Time, and leads see their direct reports. Reports export to CSV.",
      "Track time and get a personal work summary from AI assistants over MCP.",
    ],
  },
  {
    id: "2026-11-16-auto-archive",
    date: "2026-11-16",
    title: "Auto-archive",
    items: [
      "Projects can archive tasks that have stayed in a chosen status (Done by default) for a set number of days. Admins set this in project settings.",
    ],
  },
  {
    id: "2026-11-13-subtasks-checklists-reporter",
    date: "2026-11-13",
    title: "Sub-tasks, checklists and reporter",
    items: [
      "Add sub-tasks to a task.",
      "Tick Markdown checklists in task descriptions.",
      "Set a task's reporter, who gets its update emails.",
    ],
  },
  {
    id: "2026-11-12-open-source",
    date: "2026-11-12",
    title: "TasksHQ is open source",
    items: ["Self-host it with the setup guide in the repository."],
  },
];

export const LATEST_CHANGELOG_ID = CHANGELOG[0].id;

export function hasUnseenChangelog(stored: string | null): boolean {
  return stored !== LATEST_CHANGELOG_ID;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Built from the string, so the reader's time zone never shifts the day.
export function formatChangelogDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}
