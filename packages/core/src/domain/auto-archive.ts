import { sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { type DomainContext, writeActivitySelect } from "../activity";
import { project } from "../schema/project";
import { task } from "../schema/task";
import { timeEntry } from "../schema/time";
import { stopTimeEntryValues } from "./time";

/** The actor automatic archives are attributed to; seeded in migration 0017. */
export const SYSTEM_USER_ID = "system-automation";

const DAY_MS = 86_400_000;

/**
 * The tasks a single sweep archives: not already archived, sitting in their
 * project's configured auto-archive status, and having been in it for at least
 * the project's day count. `status_changed_at` is null only for rows written by
 * an older Worker mid-rollout — treated as not yet eligible. Ordered and capped
 * so a large backlog drains over successive runs, and so the activity insert and
 * the archive update below select the exact same rows.
 */
function eligibleTaskIds(now: number, limit: number) {
  return sql`
    select ${task.id} from ${task}
    inner join ${project} on ${project.id} = ${task.projectId}
    where ${task.archivedAt} is null
      and ${task.statusChangedAt} is not null
      and ${project.autoArchiveStatusId} is not null
      and ${task.statusId} = ${project.autoArchiveStatusId}
      and ${task.statusChangedAt} <= ${now} - ${project.autoArchiveDays} * ${DAY_MS}
    order by ${task.statusChangedAt}, ${task.id}
    limit ${limit}`;
}

/**
 * Cron sweep: archive Done tasks that have outlived their project's window. The
 * one domain mutation without a per-user actor — it runs on behalf of no one, so
 * it uses the seeded system user. The activity insert runs *before* the archive
 * update, both bound by the identical eligible set, so the batch (one D1
 * transaction) records exactly the rows it archives. No Slack/mail, matching the
 * manual `archiveTask`.
 */
export async function autoArchiveDoneTasks(
  db: DrizzleD1Database,
  { now = Date.now(), limit = 100 }: { now?: number; limit?: number } = {},
): Promise<number> {
  const ctx: DomainContext = { db, actorUserId: SYSTEM_USER_ID, source: "web" };
  const archivedAt = new Date(now);
  const results = await db.batch([
    // Before the archive, while the eligible set still selects these tasks.
    db
      .update(timeEntry)
      .set(stopTimeEntryValues(now))
      .where(sql`${timeEntry.endedAt} is null and ${timeEntry.taskId} in (${eligibleTaskIds(now, limit)})`),
    writeActivitySelect(
      ctx,
      {
        projectId: sql`${task.projectId}`,
        taskId: sql`${task.id}`,
        type: "task.auto_archived",
        data: sql`json_object()`,
      },
      sql`from ${task} where ${task.id} in (${eligibleTaskIds(now, limit)})`,
    ),
    db
      .update(task)
      .set({ archivedAt, updatedAt: archivedAt })
      .where(sql`${task.id} in (${eligibleTaskIds(now, limit)})`)
      .returning({ id: task.id }),
  ]);
  return results[2].length;
}
