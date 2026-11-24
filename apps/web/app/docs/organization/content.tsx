import { DocLink, Note, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "overview",
    title: "How the organization works",
    searchTerms: ["organization", "org", "company", "deployment", "settings", "organization settings"],
    content: (
      <>
        <p>
          Each TasksHQ deployment has one organization, which holds every team. Everyone who belongs to a team is also a member of the organization.
          Organization Super admins and admins manage it from the <strong>Settings</strong> section near the top of the sidebar:
          {" "}<strong>Teams</strong>, <strong>Members</strong>, <strong>Reporting lines</strong>, and <strong>General</strong>.
          Other members don’t see this section. Select the <strong>Settings</strong> heading to collapse or expand it.
        </p>
        <p>
          Organization Super admins and admins can open and manage every team as a team admin, even ones they haven’t joined. To be assigned tasks,
          be mentioned, or track time in a team, they still need to join it. See <DocLink topic="team-settings" section="invitations">Team settings</DocLink>.
        </p>
      </>
    ),
  },
  {
    id: "members",
    title: "Invite people to the organization",
    searchTerms: ["invite organization", "organization invitations", "org members", "add people"],
    content: (
      <>
        <Steps>
          <li>In the sidebar, under <strong>Settings</strong>, open <strong>Members</strong> and select <strong>Invite</strong>.</li>
          <li>Enter the person’s email address, choose a role, and select <strong>Invite</strong> again.</li>
          <li>They join the organization when they sign in with that address. Look under <strong>Pending invites</strong> to see who has yet to join, and select <strong>Revoke</strong> to cancel an invitation.</li>
        </Steps>
        <p>
          An organization invitation doesn’t add anyone to a team. Add them from each team’s Members page, or invite them to a team directly,
          which also makes them an organization member.
        </p>
      </>
    ),
  },
  {
    id: "roles",
    title: "Choose an organization role",
    searchTerms: ["organization roles", "org roles", "organization permissions", "super admin", "owner", "organization owner", "organization admin"],
    content: (
      <>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Member:</strong> Works in the teams they belong to.</li>
          <li><strong>Admin:</strong> Invites and removes members, creates teams, manages reporting lines, renames the organization, and manages every team as a team admin would. Admins can’t change, remove, or invite Super admins.</li>
          <li><strong>Super admin:</strong> Everything an admin can do, plus managing Super admins and deleting any team. The organization must keep at least one Super admin.</li>
        </ul>
        <p>Super admin was previously called organization owner, and teams no longer have owners: former team owners are now team admins.</p>
        <p>To change a role, use the role menu on the person’s row under <strong>Members</strong>.</p>
      </>
    ),
  },
  {
    id: "remove-members",
    title: "Remove someone from the organization",
    searchTerms: ["remove member", "offboarding", "leave organization", "deactivate"],
    content: (
      <>
        <p>
          Under <strong>Members</strong>, choose <strong>Remove</strong> on the person’s row, then <strong>Confirm removal</strong>.
          They lose access to every team at once: their tasks are unassigned and any running timer stops. Their past comments, history, and time entries stay.
        </p>
      </>
    ),
  },
  {
    id: "teams",
    title: "Create teams",
    searchTerms: ["new team", "create team", "list teams", "all teams"],
    content: (
      <>
        <p>
          Only organization Super admins and admins can create teams. Open <strong>Teams</strong> under <strong>Settings</strong> to see every team and its member count,
          then select <strong>New team</strong>. You can also choose <strong>+</strong> next to Teams in the sidebar.
        </p>
        <p>
          Rename a team from its own team settings; only a Super admin can delete one there. See <DocLink topic="team-settings" section="general">Rename or delete a team</DocLink>.
        </p>
      </>
    ),
  },
  {
    id: "time",
    title: "See your time and your team’s time",
    searchTerms: ["time", "your time", "my time", "team time", "timesheet", "payroll", "hours", "hours report", "reports time", "time report", "edit time entry", "add time", "time zone", "export csv", "people filter"],
    content: (
      <>
        <p>
          Open <strong>Time</strong> at the top of the sidebar to see hours logged by person and day for a week, or each person&rsquo;s total for a month, across every team you can open.
          It starts with only your own time, shown as a chip with your name. Choose <strong>Add people</strong> to search for others and add them,
          and select <strong>×</strong> on a chip to remove someone. Removing the last chip shows <strong>Everyone</strong> you can see.
          If you can see more than one team, choose a team to show only its time. This browser remembers your last filter.
        </p>
        <p>
          With one person selected, their time is broken down by project and task. Each person&rsquo;s days follow their own time zone,
          and people without a saved one are marked <strong>zone unknown</strong>. TasksHQ saves your time zone from your browser, and the page tells you when the two differ.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Organization Super admins and admins see everyone in every team, including former members.</li>
          <li>Team admins see everyone in the teams they run, including former members.</li>
          <li>Leads see their direct reports&rsquo; time only in teams they both belong to, including time a former member logged there.</li>
          <li>Everyone sees their own time in teams they belong to.</li>
        </ul>
        <p>
          When you’re one of the chosen people, the week view also lists <strong>Your entries</strong>. Choose <strong>Add time</strong>, pick one of your teams and a task,
          and enter the time to log something you forgot to track. You can edit or delete your own entries in teams you belong to; entries from a team you can open without being a member are read-only.
          To track time on a task, see <DocLink topic="work-items" section="time-tracking">Track time on a task</DocLink>.
        </p>
        <p>
          Running timers count up to now, capped at 12 hours, and people without time in the period aren&rsquo;t listed.
          Choose <strong>Download CSV</strong> to export every entry for the chosen people and team in the period, one row for each day it covers, for example for payroll. The last column names the entry&rsquo;s team.
        </p>
      </>
    ),
  },
  {
    id: "your-time",
    title: "Your Time",
    content: (
      <p>
        Your Time is now part of the <strong>Time</strong> page, which shows your own time by default. See <DocLink topic="organization" section="time">See your time and your team’s time</DocLink>.
      </p>
    ),
  },
  {
    id: "team-time",
    title: "Team Time",
    content: (
      <p>
        Team Time is now part of the <strong>Time</strong> page. Choose <strong>Add people</strong> there to see others&rsquo; time. See <DocLink topic="organization" section="time">See your time and your team’s time</DocLink>.
      </p>
    ),
  },
  {
    id: "reporting-lines",
    title: "Set up reporting lines",
    searchTerms: ["direct reports", "leads", "managers", "reporting lines", "lead"],
    content: (
      <>
        <Steps>
          <li>Under <strong>Settings</strong> in the sidebar, open <strong>Reporting lines</strong>, then select <strong>Add reporting line</strong>.</li>
          <li>Choose a <strong>Direct lead</strong> and a <strong>Direct report</strong>, then select <strong>Save reporting line</strong>.</li>
          <li>Use the edit button on an existing line to change the lead. To clear it, choose <strong>Remove line</strong>, then <strong>Remove reporting line</strong>.</li>
        </Steps>
        <p>
          Only organization Super admins and admins manage reporting lines; team admins don&rsquo;t.
          Each person has one direct lead across the whole organization, and the line applies in every team the two people share.
        </p>
        <p>
          Leads see their reports&rsquo; time in <DocLink topic="organization" section="time">Time</DocLink>,
          and reporting lines determine who receives <DocLink topic="integrations" section="email-notifications">email updates</DocLink> about those assignments.
          Removing someone from the organization clears their reporting lines.
        </p>
      </>
    ),
  },
  {
    id: "general",
    title: "Rename the organization",
    searchTerms: ["rename organization", "organization name"],
    content: (
      <p>
        Under <strong>Settings</strong> in the sidebar, open <strong>General</strong>, edit <strong>Organization name</strong>, and select <strong>Save name</strong>.
      </p>
    ),
  },
  {
    id: "signup",
    title: "Who can create an account",
    searchTerms: ["signup", "sign up", "allowlist", "invite only", "first owner", "first super admin", "TASKSHQ_OWNER_EMAIL", "SIGNUP_EMAIL_ALLOWLIST"],
    content: (
      <>
        <p>
          New accounts need an invitation to a team or to the organization. If your deployment sets <code>SIGNUP_EMAIL_ALLOWLIST</code>,
          addresses it lists can also sign up; they join the organization as members with no teams until someone adds them to one.
          Anyone without a team sees a page asking them to contact an admin.
        </p>
        <Note>
          The address in the deployment’s <code>TASKSHQ_OWNER_EMAIL</code> setting becomes the organization’s Super admin when it signs in, as long as the organization has no Super admin yet.
        </Note>
      </>
    ),
  },
];
