import { DocLink, Note, Screenshot, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "open-settings",
    title: "Open project settings",
    searchTerms: ["workflow", "integrations", "slack settings", "project admins page"],
    content: (
      <>
        <p>
          Open the project, then choose <strong>Settings</strong> beneath its name in the sidebar.
          Organization owners and admins can manage any project’s settings. A project admin can manage
          settings for that project.
        </p>
        <p>Once Settings is open, its four pages are listed beneath it in the sidebar:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>General</strong>: project details, task editing, auto-archive, and deleting the project.</li>
          <li><strong>Workflow</strong>: statuses and task types.</li>
          <li><strong>Admins</strong>: project admins.</li>
          <li><strong>Integrations</strong>: Slack.</li>
        </ul>
        <p>To post project activity in a Slack channel, follow the <DocLink topic="integrations" section="slack">Slack setup steps</DocLink>.</p>
      </>
    ),
  },
  {
    id: "rename-project",
    title: "Rename a project",
    searchTerms: ["rename project", "change slug", "project URL"],
    content: (
      <>
        <p>
          Organization owners and admins can change a project’s name and slug under <strong>Settings → General → Project details</strong>,
          then select <strong>Save</strong>. The slug is the part of the project’s address after the organization,
          so changing it changes the project’s URLs.
        </p>
        <p>
          Old links, including links to work items and images, keep redirecting organization members to the new
          address. Work item keys such as <strong>ENG-42</strong> never change. If another project later takes an
          old slug, links using that slug open that project instead.
        </p>
      </>
    ),
  },
  {
    id: "statuses",
    title: "Set up statuses",
    searchTerms: ["status setup", "kanban columns"],
    content: (
      <>
        <p>Each status is a column on the board. Put your usual starting status first.</p>
        <Steps>
          <li>Under <strong>Settings → Workflow → Statuses</strong>, enter a name such as <strong>In Review</strong>.</li>
          <li>Open the color dot beside the name, choose a color, then select <strong>Add status</strong>.</li>
          <li>Use the up and down arrows on a row to set its position on the board. Work items created without a status start in the first column.</li>
        </Steps>
        <Screenshot
          name="project-statuses"
          alt="The Statuses section with a color dot, a name, a task count, and reorder and delete controls on each row."
          caption="The order in Settings is the order of the columns on the board."
        />
        <p>
          To rename a status, edit its name on the row and press Enter or leave the field.
          Select its color dot to recolor it.
        </p>
        <p>
          To remove a status, select <strong>Delete</strong>. If the status has work items, choose a
          destination under <strong>Move to</strong>, then select <strong>Move and delete</strong>.
          Add another status first if there is nowhere to move those items. The count includes archived work.
        </p>
      </>
    ),
  },
  {
    id: "task-types",
    title: "Configure task types",
    content: (
      <>
        <p>Types describe the kind of work, such as a bug or a feature. Statuses show its progress.</p>
        <Steps>
          <li>Under <strong>Settings → Workflow → Task types</strong>, choose a color and icon, enter a name, then select <strong>Add type</strong>.</li>
          <li>To update a type, change its name, color, or icon and select <strong>Save</strong>.</li>
          <li>Select <strong>Set as default</strong> on the type to use for future work items created without an explicit type.</li>
        </Steps>
        <p>
          Changing the default leaves existing work items on their current types. Before deleting a type in use,
          change those work items to another type. If it is the default, set a different default first.
        </p>
      </>
    ),
  },
  {
    id: "task-editing",
    title: "Choose who can edit tasks",
    searchTerms: ["permissions", "task permissions", "restrict task editing", "read-only"],
    content: (
      <p>
        Under <strong>Settings → General → Task editing</strong>, turn on <strong>Restrict task editing</strong> to limit edits to the
        creator, reporter, current assignee, project admins, and organization owners and admins.
        Other organization members can still view tasks, create new ones, and comment.
        Anyone who can edit a task can change its reporter, which also gives the new reporter edit access.
        The rule applies in TasksHQ and through <DocLink topic="mcp">MCP</DocLink>.
      </p>
    ),
  },
  {
    id: "auto-archive",
    title: "Archive finished work automatically",
    searchTerms: ["auto-archive", "auto archive", "archive done tasks"],
    content: (
      <p>
        Under <strong>Settings → General → Auto-archive</strong>, choose a status and a number of days, then
        select <strong>Save</strong>. Tasks that sit in that status for that many days are archived automatically.
        New projects archive tasks from <strong>Done</strong> after 14 days. To turn it off, set the status
        to <strong>Don’t auto-archive</strong>.
      </p>
    ),
  },
  {
    id: "project-admins",
    title: "Grant or revoke project admin access",
    searchTerms: ["project permissions", "project roles"],
    content: (
      <>
        <p>
          Organization owners and admins can choose an existing organization member under <strong>Settings → Admins</strong>,
          then select <strong>Grant admin access</strong>. Use <strong>Revoke admin access</strong> on the person’s row to
          return them to ordinary member permissions for this project.
        </p>
        <Note>
          Organization membership grants access to every project in the organization. For invitations and
          organization-wide roles, see <DocLink topic="organization-settings">Organization settings</DocLink>.
        </Note>
      </>
    ),
  },
  {
    id: "delete-project",
    title: "Delete a project",
    content: (
      <p>
        On <strong>Settings → General</strong>, an organization owner can select <strong>Delete project</strong> and type the project slug shown in
        the confirmation. This permanently deletes its tasks, comments, and project history.
      </p>
    ),
  },
];
