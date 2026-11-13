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
      <Screenshot name="task-detail" alt="A work item with a description, task properties, and comments" caption="Edit task details in the properties panel and keep discussion in Comments." />
      <p>Use the description toolbar for headings, bold text, lists, or inline code. Descriptions are stored as Markdown. To add a screenshot or other image, paste it into the editor or choose <strong>Add image</strong> in the toolbar. Images can be up to 5 MB and require project access to view.</p>
      <Note>When a project restricts task editing, the creator, reporter, current assignee, and admins of the project or organization can edit. Other members can still view the task and comment. See <DocLink topic="project-settings" section="task-editing">Project settings</DocLink> for the toggle.</Note>
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
