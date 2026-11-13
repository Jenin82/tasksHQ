import { DocLink, Note, Steps, type GuideSection } from "../guide";

export const sections: GuideSection[] = [
  {
    id: "slack",
    title: "Connect a project to Slack",
    content: (
      <>
        <p>Use a Slack incoming webhook to post updates from one project to a channel.</p>
        <Steps>
          <li>Open the project’s <strong>Settings</strong>, then find <strong>Integrations → Slack</strong>.</li>
          <li>Select <strong>?</strong> beside <strong>Webhook URL</strong> for Slack’s setup instructions. Create a webhook for the channel where updates should appear.</li>
          <li>Paste the webhook URL and select <strong>Connect Slack</strong>.</li>
          <li>Select <strong>Send test message</strong> to queue a test. Check the Slack channel for the message.</li>
        </Steps>
        <p>
          TasksHQ posts when a work item is created or changes status, including changes from MCP.
          Messages include the work item title, the person who made the change, the status, and a link back to TasksHQ.
          Use a channel whose members can see those details.
        </p>
        <p>
          To switch channels, paste the new webhook URL and choose <strong>Replace webhook</strong>.
          Choose <strong>Disconnect</strong> to stop posting. Both actions clear pending messages for the old webhook.
        </p>
      </>
    ),
  },
  {
    id: "email-notifications",
    title: "Understand email notifications",
    content: (
      <>
        <p>When email is configured for your TasksHQ deployment, notifications include:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Invitations:</strong> The invitee receives an email with a link to TasksHQ.</li>
          <li><strong>Assignments:</strong> The new assignee receives an email when someone else assigns them work.</li>
          <li><strong>Mentions:</strong> Mention someone else with <strong>@</strong> in a comment to email them the comment and a link to the work item.</li>
          <li>
            <strong>Work item updates:</strong> Title, description, or status changes can notify the reporter
            when they are different from the assignee, and the assignee’s direct lead.
            TasksHQ skips the person who made the change and groups edits for each work item and recipient into five-minute batches.
          </li>
        </ul>
        <Note>
          Email delivery and sign-in by email code depend on <DocLink topic="integrations" section="email-setup">SMTP configuration</DocLink>.
        </Note>
      </>
    ),
  },
  {
    id: "email-setup",
    title: "Configure email for a deployment",
    content: (
      <>
        <p>Deployment operators set these values on the web Worker. Use an SMTP provider that supports <code>AUTH PLAIN</code> or <code>AUTH LOGIN</code> over TLS.</p>
        <dl className="space-y-3">
          <div><dt className="font-medium"><code>SMTP_HOST</code></dt><dd>The provider’s SMTP hostname.</dd></div>
          <div><dt className="font-medium"><code>SMTP_TLS</code> and <code>SMTP_PORT</code></dt><dd>Use <code>tls</code> for implicit TLS or <code>starttls</code> for a required upgrade. The respective default ports are 465 and 587.</dd></div>
          <div><dt className="font-medium"><code>SMTP_USERNAME</code> and <code>SMTP_PASSWORD</code></dt><dd>The provider’s SMTP credentials. Store them as Worker secrets.</dd></div>
          <div><dt className="font-medium"><code>SMTP_FROM</code></dt><dd>A sender address authorized by the provider.</dd></div>
        </dl>
        <p>To restrict new signups, set <code>SIGNUP_EMAIL_ALLOWLIST</code> to comma-separated email addresses and exact-domain patterns such as <code>*@example.com</code>. Existing accounts can sign in, and valid pending invitations still work for their invited addresses.</p>
      </>
    ),
  },
  {
    id: "mcp",
    title: "Connect an AI assistant",
    content: (
      <p>
        An MCP client can use TasksHQ to find projects, read and update work items, and add comments.
        It acts with the permissions of the account you sign in with. Follow <DocLink topic="mcp">MCP setup</DocLink>
        {" "}to connect your client and verify access.
      </p>
    ),
  },
];
