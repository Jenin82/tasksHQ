import Link from "next/link";
import { DocLink, Note, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "sign-in",
    title: "Sign in to TasksHQ",
    content: <>
      <Steps>
        <li>Open <Link href="/" className="underline underline-offset-4">TasksHQ</Link> and choose <strong>Continue with Google</strong>.</li>
        <li>If <strong>Continue with email</strong> is available, you can enter your address and choose <strong>Send sign-in code</strong> instead. Enter the six-digit code and add your name if prompted.</li>
        <li>From the Organizations page, choose the workspace you want to open.</li>
      </Steps>
      <Note>If you were invited, sign in with the email address on the invitation. TasksHQ picks up the invitation after you verify that address. If you’re already signed in with that address, open TasksHQ from the invite to pick it up.</Note>
    </>,
  },
  {
    id: "create-an-organization",
    title: "Create an organization",
    content: <>
      <p>An organization is the workspace that holds your people and projects. Members of an organization can open its projects.</p>
      <Steps>
        <li>From the Organizations page, choose <strong>New organization</strong>.</li>
        <li>Enter the name your team will recognize and check the suggested slug. The slug is the part of the URL that identifies your workspace.</li>
        <li>Choose <strong>Create organization</strong>.</li>
      </Steps>
      <p>If your team already has an organization, ask one of its admins to invite you.</p>
    </>,
  },
  {
    id: "create-a-project",
    title: "Create your first project",
    content: <>
      <p>Organization owners and admins can create projects. Each project has its own work items, statuses, and task types.</p>
      <Steps>
        <li>Open the organization and choose <strong>New project</strong> on its Projects page.</li>
        <li>Enter the project name. Check the suggested slug and key. For example, a key of <code>WEB</code> gives tasks identifiers such as <code>WEB-42</code>.</li>
        <li>Choose <strong>Create project</strong> to open the new board.</li>
      </Steps>
      <Note>The project key is permanent. Choose one your team will recognize in links and conversations.</Note>
      <p>New projects start with <strong>Todo</strong>, <strong>In Progress</strong>, <strong>Done</strong>, and <strong>Blocked</strong>. Use <DocLink topic="project-settings" section="statuses">Project settings</DocLink> to tailor the board to your team’s workflow.</p>
    </>,
  },
  {
    id: "invite-teammates",
    title: "Invite teammates",
    content: <>
      <Steps>
        <li>As an organization owner or admin, open <strong>Settings</strong> under Workspace in the sidebar.</li>
        <li>On <strong>Members</strong>, choose <strong>Invite</strong>. Enter a teammate’s email address and choose their organization role.</li>
        <li>Ask them to open TasksHQ and sign in using the invited address. If email delivery is configured, TasksHQ sends them an invitation email.</li>
      </Steps>
      <p>Once they join, they can open the organization’s projects and be assigned work. See <DocLink topic="organization-settings">Organization settings</DocLink> for roles and pending invitations.</p>
    </>,
  },
  {
    id: "add-your-first-task",
    title: "Add your first work item",
    content: <>
      <p>Open your project and choose <strong>Add work item</strong>. Enter a title, choose a type, and add a short description if the task needs context. After saving, open the task to assign it and set a due date or priority.</p>
      <p>Continue with <DocLink topic="work-items">Work items</DocLink> for editing and collaboration, or <DocLink topic="views">Views and filters</DocLink> to find the best view for your team.</p>
    </>,
  },
  {
    id: "profile-photo",
    title: "Set your profile photo",
    content: <p>Open the account menu in the top right and choose <strong>Account settings</strong>. Select an image and choose <strong>Save photo</strong>. Your photo appears where TasksHQ shows your avatar. Choose <strong>Remove photo</strong> to use your initials again.</p>,
  },
];
