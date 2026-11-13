import { DocLink, Note, Screenshot, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "open-settings",
    title: "Open project settings",
    content: (
      <>
        <p>
          Open the project, then choose <strong>Settings</strong> beneath its name in the sidebar.
          Organization owners and admins can manage any project’s settings. A project admin can manage
          settings for that project.
        </p>
        <p>To post project activity in a Slack channel, follow the <DocLink topic="integrations" section="slack">Slack setup steps</DocLink>.</p>
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
          <li>Under <strong>Statuses</strong>, enter a name such as <strong>In Review</strong>.</li>
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
          <li>Under <strong>Task types</strong>, choose a color and icon, enter a name, then select <strong>Add type</strong>.</li>
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
        Under <strong>Task editing</strong>, turn on <strong>Restrict task editing</strong> to limit edits to the
        creator, reporter, current assignee, project admins, and organization owners and admins.
        Other organization members can still view tasks, create new ones, and comment.
        Anyone who can edit a task can change its reporter, which also gives the new reporter edit access.
        The rule applies in TasksHQ and through <DocLink topic="mcp">MCP</DocLink>.
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
          Organization owners and admins can choose an existing organization member under <strong>Project admins</strong>,
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
        An organization owner can select <strong>Delete project</strong> and type the project slug shown in
        the confirmation. This permanently deletes its tasks, comments, and project history.
      </p>
    ),
  },
];
