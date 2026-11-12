export const guideGroups = ["Using TasksHQ", "Administration", "Integrations"] as const;

export const guideTopics = [
  { id: "getting-started", group: "Using TasksHQ", title: "Getting started", description: "Sign in, join a workspace, and set up your first project." },
  { id: "work-items", group: "Using TasksHQ", title: "Work items", description: "Create, assign, edit, comment on, share, move, and archive tasks." },
  { id: "views", group: "Using TasksHQ", title: "Views and filters", description: "Find work on the board, in the table, and across your projects." },
  { id: "project-settings", group: "Administration", title: "Project settings", description: "Set up statuses and task types, manage admins, and choose who can edit." },
  { id: "organization-settings", group: "Administration", title: "Organization settings", description: "Invite people, manage roles, and set up reporting lines." },
  { id: "integrations", group: "Integrations", title: "Slack and email", description: "Connect a Slack channel and learn when TasksHQ sends notifications." },
  { id: "mcp", group: "Integrations", title: "Connect to TasksHQ with MCP", description: "Connect TasksHQ to Codex, Claude, and Claude Code using your TasksHQ account." },
] as const;

export type GuideTopic = (typeof guideTopics)[number]["id"];

export function guideHref(topic: GuideTopic, section?: string) {
  return `/docs/${topic}${section ? `#${section}` : ""}`;
}

export const legacyMcpSections = ["codex-desktop", "codex-cli", "claude", "claude-code", "claude-local", "verify", "task-tools"];
