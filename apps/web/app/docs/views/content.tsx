import { DocLink, Note, Screenshot, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "board-and-table",
    title: "Switch between Board and Table",
    content: <>
      <p>Use the <strong>Board</strong> and <strong>Table</strong> tabs at the top of a project to switch between two views of the same tasks.</p>
      <ul className="list-disc space-y-2 pl-6 marker:text-muted-foreground">
        <li><strong>Board</strong> groups tasks by status. Drag a card you can edit into another column to change its status, or drag it within a column to reorder it.</li>
        <li><strong>Table</strong> puts properties such as assignee, reporter, status, priority, and due date side by side. Select a column heading to sort or use the sorting controls inside <strong>Filters</strong>.</li>
      </ul>
      <Screenshot name="board" alt="Project board showing work item cards grouped into status columns" caption="The Board groups cards by status. Use Table to scan task properties or sort the list." />
      <p>Open <strong>Filters</strong> to narrow the project view by title or task key, status, type, assignee, creator, or reporter. Choose <strong>Clear filters</strong> to show the full view again.</p>
    </>,
  },
  {
    id: "assignment-views",
    title: "Find work assigned to you or your team",
    content: <>
      <ul className="list-disc space-y-2 pl-6 marker:text-muted-foreground">
        <li><strong>Your Tasks</strong> shows active work in the current organization. Switch between <strong>Assigned to you</strong> and <strong>Assigned by you</strong>.</li>
        <li><strong>All My Tasks</strong> combines those views across your organizations. The sidebar shows this option when you belong to more than one organization.</li>
        <li><strong>Your Team</strong> shows active tasks assigned to your direct reports. See <DocLink topic="organization-settings">Organization settings</DocLink> for reporting lines.</li>
      </ul>
    </>,
  },
  {
    id: "project-filter",
    title: "Filter Your Tasks by project",
    content: <>
      <Steps>
        <li>Open <strong>Your Tasks</strong> or <strong>All My Tasks</strong> from the sidebar.</li>
        <li>Choose <strong>Filters</strong> and select a project from <strong>All projects</strong>. On <strong>All My Tasks</strong>, project names include their organization so you can tell similarly named projects apart.</li>
        <li>Combine the project with other filters as needed. Choose <strong>Clear filters</strong> to start over.</li>
      </Steps>
      <Screenshot name="task-filters" alt="Task list Filters menu with the project selector" caption="Use the project selector to narrow an assignment view to one project." />
      <p>TasksHQ remembers filters in the current browser, so the same selection is available when you return to that view.</p>
    </>,
  },
  {
    id: "workspace-search",
    title: "Search the workspace",
    content: <>
      <p>Choose <strong>Search workspace</strong> in the top bar, or press <kbd>⌘ K</kbd> on Mac or <kbd>Ctrl K</kbd> on Windows or Linux. Search for a project by name or key, or for a work item by title or task key. Select a result to open it.</p>
    </>,
  },
  {
    id: "bulk-actions",
    title: "Update several tasks at once",
    content: <>
      <Steps>
        <li>In a project’s <strong>Table</strong> or an assignment view, use the checkboxes to select the tasks you want to update.</li>
        <li>Choose a bulk action to change status, priority, type, or assignee, or to archive the selection.</li>
        <li>Choose a value if required and select <strong>Apply</strong>. For archiving, choose <strong>Confirm</strong>.</li>
      </Steps>
      <Note>Bulk actions require admin access to the selected tasks’ projects. When selecting tasks across projects, the picker only offers values available in every selected project.</Note>
    </>,
  },
];
