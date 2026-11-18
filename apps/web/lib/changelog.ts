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
