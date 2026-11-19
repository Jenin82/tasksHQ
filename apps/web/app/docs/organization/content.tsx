import { DocLink, Note, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "overview",
    title: "How the organization works",
    searchTerms: ["organization", "org", "company", "deployment"],
    content: (
      <>
        <p>
          Each TasksHQ deployment has one organization, which holds every team. Everyone who belongs to a team is also a member of the organization.
          Organization owners and admins manage it from the links under the organization name at the top of the sidebar:
          {" "}<strong>Members</strong>, <strong>Teams</strong>, and <strong>General</strong>.
        </p>
        <p>
          Organization owners and admins can open and manage every team, even ones they haven’t joined. To be assigned tasks,
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
          <li>In the sidebar, under the organization name, open <strong>Members</strong> and select <strong>Invite</strong>.</li>
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
    searchTerms: ["organization roles", "org roles", "organization permissions", "organization owner", "organization admin"],
    content: (
      <>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Member:</strong> Works in the teams they belong to.</li>
          <li><strong>Admin:</strong> Invites and removes members, creates teams, renames the organization, and manages every team as a team admin would. Admins can’t change, remove, or invite owners.</li>
          <li><strong>Owner:</strong> Everything an admin can do, plus managing owners and deleting any team. The organization must keep at least one owner.</li>
        </ul>
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
          Only organization owners and admins can create teams. Open <strong>Teams</strong> under the organization name to see every team and its member count,
          then select <strong>New team</strong>. You can also choose <strong>+</strong> next to Teams in the sidebar.
        </p>
        <p>
          Rename or delete a team from that team’s own settings. See <DocLink topic="team-settings" section="general">Rename or delete a team</DocLink>.
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
        Open <strong>General</strong> under the organization name, edit <strong>Organization name</strong>, and select <strong>Save name</strong>.
      </p>
    ),
  },
  {
    id: "signup",
    title: "Who can create an account",
    searchTerms: ["signup", "sign up", "allowlist", "invite only", "first owner", "TASKSHQ_OWNER_EMAIL", "SIGNUP_EMAIL_ALLOWLIST"],
    content: (
      <>
        <p>
          New accounts need an invitation to a team or to the organization. If your deployment sets <code>SIGNUP_EMAIL_ALLOWLIST</code>,
          addresses it lists can also sign up; they join the organization as members with no teams until someone adds them to one.
          Anyone without a team sees a page asking them to contact an admin.
        </p>
        <Note>
          The address in the deployment’s <code>TASKSHQ_OWNER_EMAIL</code> setting becomes the organization owner when it signs in, as long as the organization has no owner yet.
        </Note>
      </>
    ),
  },
];
