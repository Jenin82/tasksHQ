# Plane-inspired TasksHQ workflow

## Goal

Let a PM switch projects, scan work, create tasks, and update task properties using the same sequence of interactions shown in the Plane screenshots. Keep the existing TasksHQ project data, permissions, and task URLs. The screenshots are the design reference for the layout and interactions.

## Proposed first release

| Area | Proposed experience |
| --- | --- |
| Workspace shell | Put the workspace switcher and account controls in the top bar. Use a collapsible left sidebar for Projects, the reachable project list, and the active project's Work items, Settings, and Archive. Show a drawer on narrow screens. |
| Workspace search | Put Search in the top bar and offer a Cmd/Ctrl+K shortcut. Find projects by name or key and active tasks by title or key across the current workspace. Show each task's project and status. Open the matching project or task directly from the results. |
| Work items | Use a shared project header with the breadcrumb, matching task count, Board/Table switch, filters, and Add work item. Remember the last view per project. Keep project-level filters when switching views and preserve the existing Board and Table URLs. |
| Board | Use subtle column backgrounds and compact cards with task key, title, status, priority, assignee, and due date. Keep column counts, quick add inside each column, and drag and drop. Use color accents for state, priority, and overdue dates. Let the board scroll horizontally within the content area. |
| Table | Put the key and title together in a sticky first column. Follow with Status, Priority, Assignee, Due date, and Created on. Keep sorting and make Updated available as an optional column if Display controls ship. Clicking the title opens the task dialog. Clicking an editable cell opens its picker. |
| Inline editing | Start with the searchable Status picker shown in the reference. Add a priority menu, searchable assignee picker, and date picker with a clear action. Show the current value and support keyboard navigation and Escape. Keep the current one-assignee model. |
| Creation and detail | Provide the same creation entry point from the header and the sidebar when a project is active. Column quick add preselects that column's status. The existing task dialog continues to handle description editing, image uploads, comments, and activity. |

The first release uses existing custom statuses and priority values. The reference's Backlog, Cancelled, and Urgent labels do not require a data change. Analytics, Cycles, Modules, and saved Views are separate from this release. The Work items header retains filters for the current project, while top-bar Search covers the current workspace.

## Implementation order

1. **Workspace shell and shared header.** Use the authorized project list already loaded by the org layout. Move Board and Table controls into the shared project header and implement a common filter state for search, status, and people. Keep sort and column display preferences specific to the table. Use neutral surfaces and compact controls, with matching light and dark themes.
2. **Board and table layout.** Restyle existing board cards and table rows. Keep horizontal overflow inside each view, preserve drag interactions, and limit sticky columns on narrow screens so they leave room for editable cells. Include loading, empty, no-results, and error states.
3. **Inline updates and creation.** Reuse existing task mutations and the project's authorized status and assignee options. Apply edits immediately, reconcile with the server result, and show an inline error if the server rejects a change. Keep failed drafts recoverable. Ensure a status change updates the board column, filters, and counts. Use the same create form wherever the project is known.
4. **Workspace search.** Add a server endpoint scoped to the active workspace. Apply the existing project-access rules before matching or ranking results. Prioritize exact keys, then prefixes, then title and project-name matches. Debounce requests, cap the initial results, and ignore stale responses when the query or workspace changes. Show loading, no-results, and error states. Keep descriptions, comments, and archived tasks outside the initial search scope.
5. **PM walkthrough and rollout.** Review the local build with the PM before rollout. Exercise the daily flow with an existing project and a disposable task, then find that task from another project via Search. Run type checks and task and permission tests. Verify both themes, keyboard navigation, and mobile scrolling in the browser.

## Acceptance criteria

- The PM can switch projects from the sidebar and reaches Work items in one click. The active project and view are visible.
- Board and Table show the same filtered work items and count after switching views.
- The PM can create a task in a specific status, find it in Table, and change its status, priority, assignee, and due date without opening its dialog.
- Inline controls work by keyboard. Opening a cell picker does not open its row's task dialog. Failed changes surface an error and reconcile to the saved value.
- A user can find an active task in another project within the current workspace by title or exact key. Enter opens the highlighted result, and Escape closes Search and restores focus.
- Search never returns results from inaccessible projects or other workspaces. Test this with a member who can access one project but lacks access to a second, using the same search term in both.
- Existing project and task links still open. The current detail editor, image uploads, archive workflow, and permissions still work. Users only see projects and assignees they are allowed to access.
- On mobile, the sidebar collapses and the project page stays usable without the entire page scrolling horizontally.
