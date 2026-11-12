import { and, eq, sql } from "drizzle-orm";
import { AccessError, hasTaskEditPermission } from "../access";
import type { DomainContext } from "../activity";
import { orgMember } from "../schema/org";
import { project } from "../schema/project";
import { task, taskShare } from "../schema/task";
import { parseTaskKey } from "./task";

export function isTaskShareCode(code: string) {
  return code.length === 22 && !/[^A-Za-z0-9_-]/.test(code);
}

export async function createTaskShare(ctx: DomainContext, input: { projectId: string; key: string }) {
  const parsed = parseTaskKey(input.key);
  if (!parsed || !Number.isSafeInteger(parsed.number)) {
    throw new AccessError("not_a_member", "No such task.");
  }
  const { db, actorUserId } = ctx;
  const location = and(
    eq(project.id, input.projectId),
    eq(project.key, parsed.projectKey.toUpperCase()),
    eq(task.number, parsed.number),
  );
  const memberJoin = and(eq(orgMember.orgId, project.orgId), eq(orgMember.userId, actorUserId));
  const code = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

  // Use the current task location and live permissions in the write itself.
  // Enable the original URL and preserve any existing short link for this task number.
  const insert = db.insert(taskShare).select(sql`
    select ${code}, ${task.id}, ${task.projectId}, ${task.number}, 1
    from ${task}
    inner join ${project} on ${project.id} = ${task.projectId}
    where ${location} and ${hasTaskEditPermission(db, input.projectId, actorUserId)}
  `).onConflictDoUpdate({
    target: [taskShare.taskId, taskShare.projectId, taskShare.number],
    set: { canonicalPreview: true },
  });
  const lookup = db.select({ code: taskShare.code }).from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .innerJoin(orgMember, memberJoin)
    .leftJoin(taskShare, and(eq(task.id, taskShare.taskId), eq(task.projectId, taskShare.projectId), eq(task.number, taskShare.number)))
    .where(location);
  const [, [share]] = await db.batch([insert, lookup]);
  if (!share) throw new AccessError("not_a_member", "No such task.");
  return share.code;
}
