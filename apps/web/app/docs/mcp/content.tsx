import { MCP_URL } from "@/lib/public-urls";
import { CodeBlock, Steps, type GuideSection } from "../guide";

const desktopConfig = JSON.stringify({
  mcpServers: {
    taskshq: {
      command: "/opt/homebrew/bin/npx",
      args: ["-y", "mcp-remote", MCP_URL, "45263", "--host", "localhost"],
    },
  },
}, null, 2);

export const intro = (
  <>
    <p>Sign in with the account you use for TasksHQ, using Google or email when available, then approve access. Your organization and project permissions apply to each tool call.</p>
    <p className="stutter">Server URL · Streamable HTTP</p>
    <CodeBlock>{MCP_URL}</CodeBlock>
  </>
);

export const sections: GuideSection[] = [
  { id: "codex-desktop", title: "Codex desktop", content: <>
    <Steps>
      <li>Open Settings, then MCP servers, and choose Add server.</li>
      <li>Name the server <code>taskshq</code>, select Streamable HTTP, and paste the server URL above.</li>
      <li>Save, then restart when prompted. Choose Authenticate to sign in to TasksHQ and approve access.</li>
    </Steps>
    <Source href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli#connect-codex-to-an-mcp-server">Codex MCP documentation</Source>
  </> },
  { id: "codex-cli", title: "Codex CLI", content: <>
    <p>Add the server from your terminal.</p>
    <CodeBlock>{`codex mcp add taskshq --url ${MCP_URL}`}</CodeBlock>
    <p>If sign-in has not opened, start it with this command, then approve access in your browser.</p>
    <CodeBlock>codex mcp login taskshq</CodeBlock>
    <p>Use <code>/mcp</code> inside Codex to check the connection.</p>
    <Source href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli#connect-codex-to-an-mcp-server">Codex CLI documentation</Source>
  </> },
  { id: "claude", title: "Claude web and desktop", content: <>
    <Steps>
      <li>Open Customize, then Connectors. Choose Add, then Add custom connector.</li>
      <li>Enter <code>TasksHQ</code> as the name and paste the server URL above. Continue to authentication settings.</li>
      <li>Choose Sign in now. For the OAuth client, choose Register automatically, then finish adding the connector.</li>
      <li>Sign in to TasksHQ and approve access. Enable TasksHQ from the Connectors menu in your conversation.</li>
    </Steps>
    <p>On Team and Enterprise plans, an owner or administrator may need to add the connector first. Members can then choose Connect to sign in.</p>
    <Source href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp">Claude custom connector documentation</Source>
  </> },
  { id: "claude-code", title: "Claude Code", content: <>
    <p>Add TasksHQ to your user configuration.</p>
    <CodeBlock>{`claude mcp add --transport http --scope user taskshq ${MCP_URL}`}</CodeBlock>
    <p>Open Claude Code and run <code>/mcp</code>. Select TasksHQ and authenticate, then sign in to TasksHQ and approve access in your browser.</p>
    <Source href="https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers">Claude Code MCP documentation</Source>
  </> },
  { id: "claude-local", title: "Claude Desktop local config", content: <>
    <p>For a local configuration on macOS, install Node.js and locate <code>npx</code> with <code>which npx</code>. The example uses the Apple Silicon Homebrew path. Replace it with your own path if needed.</p>
    <p>Open this file through Claude Desktop Settings, Developer, Edit Config.</p>
    <CodeBlock>{"~/Library/Application Support/Claude/claude_desktop_config.json"}</CodeBlock>
    <p>Add the <code>taskshq</code> entry inside <code>mcpServers</code>, keeping your other server entries. This is a complete example for a new configuration file.</p>
    <CodeBlock>{desktopConfig}</CodeBlock>
    <p>Save the file and fully quit and reopen Claude Desktop. The bridge opens a browser to sign in to TasksHQ. Approve access to TasksHQ to finish connecting.</p>
    <p>The example uses local callback port <code>45263</code>. If that port is already in use, choose another free port. TasksHQ supports automatic OAuth client registration.</p>
    <Source href="https://github.com/punkpeye/mcp-remote#claude-desktop">mcp-remote setup documentation</Source>
  </> },
  { id: "verify", title: "Verify your connection", content: <>
    <p>Start a conversation with TasksHQ enabled and ask your assistant to run this prompt.</p>
    <CodeBlock>Use TasksHQ to list my projects.</CodeBlock>
    <p>The assistant should call <code>list_projects</code> and show the projects your account can access.</p>
    <p>If your list is empty, check the account used during sign-in and your organization membership. If authentication expires, reconnect TasksHQ from your client’s MCP or connector settings.</p>
  </> },
  { id: "task-tools", title: "Task fields and images", content: <>
    <p><code>list_tasks</code> and <code>get_task</code> return the due date and priority. Set them with <code>create_task</code> or <code>update_task</code> using <code>dueDate</code> in <code>YYYY-MM-DD</code> format and <code>priority</code> set to <code>low</code>, <code>medium</code>, or <code>high</code>. On update, a null due date clears it and a null priority resets it to Medium.</p>
    <p><code>list_tasks</code> and <code>get_task</code> also return the <code>reporter</code>, the person who asked for the work. Pass an organization member’s email as <code>reporter</code> to <code>create_task</code> or <code>update_task</code>. It defaults to you on create and cannot be cleared.</p>
    <p><code>list_projects</code> returns the types available for each project with their colors and icons and marks the default. Pass a type name as <code>type</code> when calling <code>create_task</code> or <code>update_task</code>. Omit it when creating to use the project’s default, or when updating to keep the current type. <code>list_tasks</code> and <code>get_task</code> return the current type name.</p>
    <p>Task descriptions support Markdown. To embed an image, call <code>upload_project_image</code> with the project and the file as raw <code>base64</code>, then include the returned Markdown in the task description. The tool accepts PNG, JPEG, WebP, GIF, and AVIF files up to 5 MB and stores a still WebP image. Use <code>get_project_image</code> with the project and image ID to read it back.</p>
  </> },
];

function Source({ href, children }: { href: string; children: React.ReactNode }) {
  return <p><a href={href} className="rounded-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{children}</a></p>;
}
