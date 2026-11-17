import { DocLink, Note, Screenshot, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "invitations",
    title: "Invite people",
    searchTerms: ["invitations", "invite members"],
    content: (
      <>
        <p>
          Organization owners and admins manage membership from <strong>Workspace → Settings → Members</strong>
          {" "}in the sidebar. People join with the email address you invite.
        </p>
        <Steps>
          <li>Select <strong>Invite</strong>, enter the person’s email address, choose a role, and select <strong>Invite</strong> again.</li>
          <li>If your deployment sends email, TasksHQ queues an invitation. Otherwise, share the TasksHQ sign-in page with the invitee so they can sign in with that Google address.</li>
          <li>Look under <strong>Pending invites</strong> to see who has yet to join. Select <strong>Revoke</strong> on a pending invitation to cancel it.</li>
        </Steps>
        <Screenshot
          name="organization-members"
          alt="The organization Members page with the Invite button, member roles, and the Pending invites section."
          caption="Manage current members and pending invitations from the same page."
        />
        <Note>A valid pending invitation lets the recipient join with that address even if signup is restricted to other addresses.</Note>
      </>
    ),
  },
  {
    id: "roles",
    title: "Choose a role",
    searchTerms: ["permissions", "organization permissions", "member roles"],
    content: (
      <>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Member:</strong> Access the organization’s projects and work on tasks. The project’s editing policy determines which existing tasks the member can edit.</li>
          <li><strong>Admin:</strong> Manage people other than owners, create projects, and manage project settings across the organization.</li>
          <li><strong>Owner:</strong> Manage all roles and permanently delete projects or the organization. The organization must keep at least one owner.</li>
        </ul>
        <p>
          To change a role, use the role menu on the person’s row under <strong>Members</strong>.
          To remove their access to the organization and its projects, choose <strong>Remove</strong>,
          then <strong>Confirm removal</strong>.
          To delegate settings for just one project, <DocLink topic="project-settings" section="project-admins">grant project admin access</DocLink>.
        </p>
      </>
    ),
  },
  {
    id: "reporting-lines",
    title: "Set up reporting lines",
    content: (
      <>
        <Steps>
          <li>Open <strong>Workspace → Settings → Reporting lines</strong>, then select <strong>Add reporting line</strong>.</li>
          <li>Choose a <strong>Direct lead</strong> and a <strong>Team member</strong>, then select <strong>Save reporting line</strong>.</li>
          <li>Use the edit button on an existing line to change the lead. To clear it, choose <strong>Remove line</strong>, then <strong>Remove reporting line</strong>.</li>
        </Steps>
        <p>
          Each person can have one direct lead. Leads can track active assignments for their direct reports in
          {" "}<DocLink topic="views">Your Team</DocLink>. Reporting lines also determine who receives
          {" "}<DocLink topic="integrations" section="email-notifications">email updates</DocLink> about those assignments.
        </p>
      </>
    ),
  },
  {
    id: "general",
    title: "Rename or delete an organization",
    content: (
      <>
        <p>
          In <strong>Workspace → Settings → General</strong>, edit <strong>Organization name</strong> and select
          {" "}<strong>Save name</strong>. The name updates while the organization’s address stays the same.
        </p>
        <p>
          An owner can also select <strong>Delete organization</strong> and type the slug shown in the confirmation.
          This permanently deletes the organization’s projects, tasks, comments, and history.
        </p>
      </>
    ),
  },
  {
    id: "team-time",
    title: "See your team's time",
    searchTerms: ["timesheet", "payroll", "hours report", "team time", "time report", "export csv"],
    content: (
      <>
        <p>
          Open <strong>Team Time</strong> in the sidebar to see hours logged by person and day for a week, or each person&rsquo;s total for a month.
          Select a person to break their time down by project and task. Each person&rsquo;s days follow their own time zone.
        </p>
        <p>
          The link shows for owners, admins and leads. Running timers count up to now, capped at 12 hours, and people without time in the period aren&rsquo;t listed.
          Owners and admins see everyone in the organization, including former members. Leads see themselves and their direct reports.
          Choose <strong>Download CSV</strong> to export every entry in the period, one row for each day it covers, for example for payroll.
        </p>
      </>
    ),
  },
];
