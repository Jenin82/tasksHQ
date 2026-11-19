import { env, SELF } from "cloudflare:test";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { team, teamMember, type Team } from "@tasks/core/schema";

export const db = drizzle(env.DB);
export const MCP_URL = "https://mcp.example.test/mcp";

/** A token the stubbed AUTH_SERVER (vitest.config.ts) accepts for `userId`. */
export const tokenFor = (userId: string, clientName = "Claude Code") =>
  `ok:${userId}:client-${userId}:${encodeURIComponent(clientName)}`;

export function rpc(token: string | null, body: unknown) {
  return SELF.fetch(MCP_URL, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

/** The JSON-RPC message, whether it came back as JSON or a one-event SSE stream. */
async function message(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return JSON.parse(text);
  }
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  return JSON.parse(data[data.length - 1]);
}

/** Calls a tool as `userId`; `data` is the parsed JSON payload or the error text. */
export async function call(
  userId: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; data: any }> {
  const result = await callResult(userId, name, args);
  const [content] = result.content;
  if (content?.type !== "text") throw new Error("Expected a text tool result");
  const isError = result.isError === true;
  return { isError, data: isError ? content.text : JSON.parse(content.text) };
}

export async function callResult(
  userId: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const response = await rpc(tokenFor(userId), {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const msg = await message(response);
  if (msg.error) throw new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`);
  return msg.result;
}

/** A team owned by `actorUserId`, without the domain's org owner/admin check. */
export async function createTeam(
  ctx: { db: DrizzleD1Database; actorUserId: string; source?: "web" | "mcp" },
  input: { slug: string; name: string },
): Promise<Team> {
  const row: Team = { id: crypto.randomUUID(), slug: input.slug, name: input.name.trim(), createdAt: new Date() };
  await ctx.db.batch([
    ctx.db.insert(team).values(row),
    ctx.db.insert(teamMember).values({ teamId: row.id, userId: ctx.actorUserId, role: "owner", createdAt: row.createdAt }),
  ]);
  return row;
}
