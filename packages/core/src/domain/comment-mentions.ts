import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { DomainError } from "../errors";
import { user } from "../schema/auth";
import { teamMember } from "../schema/team";
import type { CommentMention } from "../schema/task";

export async function resolveCommentMentions(
  db: DrizzleD1Database,
  teamId: string,
  rawBody: string,
  body: string,
  input: unknown,
): Promise<CommentMention[]> {
  if (input === undefined) return [];
  const invalid = new DomainError("Choose people from the mention list again.");
  if (!Array.isArray(input) || input.length > body.length / 2) throw invalid;
  if (input.length === 0) return [];

  const leading = rawBody.length - rawBody.trimStart().length;
  const mentions = input.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !("userId" in entry) ||
        typeof entry.userId !== "string" || !entry.userId ||
        !("start" in entry) || typeof entry.start !== "number" || !Number.isSafeInteger(entry.start) ||
        !("end" in entry) || typeof entry.end !== "number" || !Number.isSafeInteger(entry.end)) throw invalid;
    const start = entry.start - leading;
    const end = entry.end - leading;
    if (start < 0 || end > body.length || end <= start + 1 || body[start] !== "@") throw invalid;
    return { userId: entry.userId, start, end };
  }).sort((a, b) => a.start - b.start);

  const ids = [...new Set(mentions.map(({ userId }) => userId))];
  const members = await db.select({ id: user.id, name: user.name })
    .from(teamMember).innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(
      eq(teamMember.teamId, teamId),
      sql`${user.id} in (select value from json_each(${JSON.stringify(ids)}))`,
    ));
  const names = new Map(members.map(({ id, name }) => [id, name.trim()]));
  let previousEnd = 0;
  for (const { userId, start, end } of mentions) {
    const name = names.get(userId);
    if (start < previousEnd || !name || body.slice(start, end) !== `@${name}`) throw invalid;
    previousEnd = end;
  }
  return mentions;
}
