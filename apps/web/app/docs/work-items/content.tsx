import { DocLink, Note, Screenshot, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "create",
    title: "Create a work item",
    content: <>
      <Steps>
        <li>Open a project’s <strong>Board</strong> or <strong>Table</strong> and choose <strong>Add work item</strong>.</li>
        <li>Enter a title, choose a <strong>Type</strong>, and add an optional <strong>Description</strong>.</li>
        <li>Choose <strong>Add work item</strong> to save. Open the task to set its assignee, due date, and priority.</li>
      </Steps>
      <p>To create a task in a specific status, choose <strong>New work item</strong> at the bottom of that Board column, enter a title, and press <kbd>Enter</kbd>.</p>
    </>,
  },
  {
    id: "edit",
    title: "Edit details and attach images",
    searchTerms: ["reporter", "requester", "reported by"],
    content: <>
      <p>Select a work item to open its details. Choose <strong>Open full page</strong> in the dialog when you want more room. Edit the title or description, or use the properties panel to change the <strong>Status</strong>, <strong>Assignee</strong>, <strong>Reporter</strong>, <strong>Due date</strong>, <strong>Type</strong>, or <strong>Priority</strong>.</p>
      <p>The <strong>Reporter</strong> is the person who asked for the work. It starts as the person who created the task, and you can change it to any organization member. <strong>Created by</strong> always shows who created the task.</p>
      <Screenshot name="task-detail" alt="A work item with a description, task properties including the reporter, and comments" caption="Edit task details in the properties panel and keep discussion in Comments." />
      <p>Use the description toolbar for headings, bold text, lists, checklists, or inline code. Choose <strong>Checklist</strong> to turn lines into to-do items; ticking an item requires edit access. Descriptions are stored as Markdown. To add a screenshot or other image, paste it into the editor or choose <strong>Add image</strong> in the toolbar. Images can be up to 5 MB and require project access to view.</p>
      <Note>When a project restricts task editing, the creator, reporter, current assignee, and admins of the project or organization can edit. Other members can still view the task and comment. See <DocLink topic="project-settings" section="task-editing">Project settings</DocLink> for the toggle.</Note>
    </>,
  },
  {
    id: "sub-tasks",
    title: "Break work into sub-tasks",
    searchTerms: ["subtask", "sub task", "child task", "parent task", "checklist", "to-do list"],
    content: <>
      <Steps>
        <li>Open the task you want to break down and choose <strong>Add sub-task</strong> under <strong>Sub-tasks</strong>. In a project that restricts task editing, you need edit access to the parent.</li>
        <li>Enter a title and press <kbd>Enter</kbd>. The sub-task is a full work item in the same project, with its own status, assignee, and comments.</li>
      </Steps>
      <p>A sub-task shows its <strong>Parent</strong> in the properties panel. Choose <strong>Remove parent</strong> to make it a top-level task again. Sub-tasks are one level deep: a sub-task cannot have its own sub-tasks. To give an existing task a parent, use an <DocLink topic="mcp" section="task-tools">MCP client</DocLink>.</p>
      <p>On the Board, a sub-task card shows <strong>↳</strong> and its parent’s key, and a parent card shows how many sub-tasks it has. The Table shows the parent key next to the title. Choose <strong>Hide sub-tasks</strong> in <strong>Filters</strong> to show only top-level tasks.</p>
      <Note>Archiving a parent leaves its sub-tasks active. Permanently deleting a parent makes its sub-tasks top-level. A task with a parent or sub-tasks cannot be moved to another project; remove the link first.</Note>
      <p>For a quick list of steps that don’t need their own status or assignee, use a <strong>Checklist</strong> in the description instead.</p>
    </>,
  },
  {
    id: "comments",
    title: "Comment and mention teammates",
    content: <>
      <Steps>
        <li>Open a work item and scroll to <strong>Comments</strong>.</li>
        <li>Write your message. To mention someone, type <kbd>@</kbd> and select their name from the suggestions. You can mention more than one person.</li>
        <li>Choose <strong>Comment</strong>. If email delivery is configured, other teammates you mention can receive a notification at their verified email address.</li>
      </Steps>
      <p>Check <strong>Activity</strong> to see who changed the task and whether the change came from the web app or an MCP client.</p>
    </>,
  },
  {
    id: "share",
    title: "Share a task link",
    content: <>
      <p>Choose <strong>Share</strong> in the task dialog or on its full page to copy the task URL. Anyone opening the full task needs access to the project.</p>
      <Note>Sharing from an account that can edit the task can publish a card preview for the link. People outside the project may see that preview, which can include the task title and assignee avatar.</Note>
    </>,
  },
  {
    id: "move-and-archive",
    title: "Move, archive, or restore a task",
    content: <>
      <p><strong>Move.</strong> Open the task, choose <strong>Move</strong> in the properties panel, select a destination project in the same organization, and choose <strong>Move work item</strong>. The task gets a key in the destination project. TasksHQ matches the old status and type by name when possible. Otherwise, it uses the destination’s first status and default type.</p>
      <p>The <strong>Move</strong> button appears when you can edit the task and another project in the organization has at least one status.</p>
      <p><strong>Archive.</strong> Choose <strong>Archive</strong> in the properties panel to take the task off the active Board and Table. To restore it, open <strong>Archive</strong> under the project in the sidebar and choose <strong>Unarchive</strong>.</p>
      <p><strong>Delete permanently.</strong> Organization owners and admins can permanently delete an archived task from the Archive view. This removes the task and its comments and activity history.</p>
    </>,
  },
];
