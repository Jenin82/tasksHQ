import { DocLink, Note, Screenshot, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "invitations",
    title: "Invite people",
    searchTerms: ["invitations", "invite members", "team members", "workspace members"],
    content: (
      <>
        <p>
          Team admins manage membership from <strong>Workspace → Team settings → Members</strong>
          {" "}in the sidebar. People join with the email address you invite.
        </p>
        <Steps>
          <li>Select <strong>Invite</strong>, enter the person’s email address, choose a role, and select <strong>Invite</strong> again.</li>
          <li>If your deployment sends email, TasksHQ queues an invitation. Otherwise, share the TasksHQ sign-in page with the invitee so they can sign in with that Google address.</li>
          <li>Look under <strong>Pending invites</strong> to see who has yet to join. Select <strong>Revoke</strong> on a pending invitation to cancel it.</li>
        </Steps>
        <Screenshot
          name="organization-members"
          alt="The team Members page with the Invite button, member roles, and the Pending invites section."
          caption="Manage current members and pending invitations from the same page."
        />
        <p>
          Joining a team also makes the person a member of the organization. People who already belong to the organization can be invited the same way.
        </p>
        <Note>A valid pending invitation lets the recipient create an account with that address, even though signup otherwise needs an invitation or an allowlisted address.</Note>
      </>
    ),
  },
  {
    id: "roles",
    title: "Choose a role",
    searchTerms: ["permissions", "team permissions", "team roles", "member roles", "team admin", "team owner", "owner"],
    content: (
      <>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Member:</strong> Access the team’s projects and work on tasks. The project’s editing policy determines which existing tasks the member can edit.</li>
          <li><strong>Admin:</strong> Manage members and invitations, create projects, manage project settings across the team, rename the team, and permanently delete projects and archived tasks.</li>
        </ul>
        <p>
          Teams no longer have an owner role; former team owners are now admins. Only an organization Super admin can delete a team.
        </p>
        <p>
          <DocLink topic="organization" section="roles">Organization Super admins and admins</DocLink> can open and manage every team as its admins can,
          without joining it, so a team doesn’t need an admin of its own. They aren’t listed as members, and can’t be assigned, mentioned, or track time in the team until they join it.
        </p>
        <p>
          To change a role, use the role menu on the person’s row under <strong>Members</strong>.
          To remove their access to the team and its projects, choose <strong>Remove</strong>,
          then <strong>Confirm removal</strong>. They stay in the organization and in their other teams;
          to remove them everywhere, <DocLink topic="organization" section="remove-members">remove them from the organization</DocLink>.
          To delegate settings for just one project, <DocLink topic="project-settings" section="project-admins">grant project admin access</DocLink>.
        </p>
      </>
    ),
  },
  {
    id: "reporting-lines",
    title: "Reporting lines",
    content: (
      <p>
        Reporting lines now belong to the organization, so each person has one lead across every team, and only organization Super admins and admins manage them. See
        {" "}<DocLink topic="organization" section="reporting-lines">Set up reporting lines</DocLink>.
      </p>
    ),
  },
  {
    id: "general",
    title: "Rename or delete a team",
    searchTerms: ["rename team", "delete team", "rename workspace", "delete workspace", "super admin"],
    content: (
      <>
        <p>
          Team admins can open <strong>Workspace → Team settings → General</strong>, edit <strong>Team name</strong> and select
          {" "}<strong>Save name</strong>. The name updates while the team’s address stays the same.
        </p>
        <p>
          An organization Super admin can also select <strong>Delete team</strong> there and type the slug shown in the confirmation.
          This permanently deletes the team’s projects, tasks, comments, and history.
        </p>
      </>
    ),
  },
  {
    id: "team-time",
    title: "Team Time",
    content: (
      <p>
        Team Time is now part of the organization&rsquo;s <strong>Time</strong> page, which covers every team you can see, with a filter for one team. See
        {" "}<DocLink topic="organization" section="time">See your time and your team’s time</DocLink>.
      </p>
    ),
  },
];
