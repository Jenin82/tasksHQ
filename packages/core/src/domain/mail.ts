import { sql, type SQL } from "drizzle-orm";
import type { DomainContext } from "../activity";
import { mailOutbox, type MailJob } from "../schema/mail";
import { orgMember, orgReportingLine } from "../schema/org";
import { comment, task } from "../schema/task";

const EDIT_WINDOW = 5 * 60_000;

export function queueOrgInviteMail(
  ctx: DomainContext,
  orgId: string,
  email: string,
  createdAt: Date,
) {
  return ctx.db.insert(mailOutbox).select(sql`
    select ${crypto.randomUUID()}, 'org_invite', ${orgId}, ${email},
      ${createdAt.getTime()}, ${Date.now()}, 0, null
    where changes() > 0
  `);
}

function noPendingMail(kind: MailJob["kind"], targetId: string, recipient: string) {
  return sql`not exists (
    select 1 from ${mailOutbox} where ${mailOutbox.kind} = ${kind}
      and ${mailOutbox.targetId} = ${targetId} and ${mailOutbox.recipient} = ${recipient}
  )`;
}

/** Call after task creation or before reassignment, in the task write batch. */
export function queueAssignmentMail(ctx: DomainContext, taskId: string, assignee: string, where: SQL) {
  return ctx.db.insert(mailOutbox).select(sql`
    select ${crypto.randomUUID()}, 'assignment', ${taskId}, ${assignee}, null, ${Date.now()}, 0, null
    from ${task}
    where ${task.id} = ${taskId} and ${where}
      and ${noPendingMail("assignment", taskId, assignee)}
  `);
}

export function queueCommentMentionMail(ctx: DomainContext, orgId: string, commentId: string, recipients: string[]) {
  return ctx.db.insert(mailOutbox).select(sql`
    select 'mention:' || ${commentId} || ':' || ${orgMember.userId},
      'comment_mention', ${commentId}, ${orgMember.userId}, null, ${Date.now()}, 0, null
    from ${orgMember}
    where ${orgMember.orgId} = ${orgId}
      and ${orgMember.userId} <> ${ctx.actorUserId}
      and ${orgMember.userId} in (select value from json_each(${JSON.stringify(recipients)}))
      and exists (select 1 from ${comment} where ${comment.id} = ${commentId})
  `).onConflictDoNothing();
}

/** Evaluate both recipients and the actual edit against the row inside the batch. */
export function queueTaskEditMail(
  ctx: DomainContext,
  taskId: string,
  orgId: string,
  assignee: SQL | string | null,
  reporter: SQL | string,
  changed: SQL,
  now: Date,
) {
  const windowEnd = (Math.floor(now.getTime() / EDIT_WINDOW) + 1) * EDIT_WINDOW;
  return ctx.db.insert(mailOutbox).select(sql`
    select 'edit:' || ${taskId} || ':' || recipient || ':' || ${windowEnd},
      'task_update', ${taskId}, recipient, null, ${windowEnd}, 0, null
    from (
      select ${reporter} as recipient
      from ${task}
      where ${task.id} = ${taskId} and ${changed} and ${reporter} is not ${assignee}
      union
      select ${orgReportingLine.leadUserId} as recipient
      from ${task}
      inner join ${orgReportingLine}
        on ${orgReportingLine.orgId} = ${orgId} and ${orgReportingLine.userId} = ${assignee}
      where ${task.id} = ${taskId} and ${changed}
    )
    where recipient != ${ctx.actorUserId}
  `).onConflictDoNothing();
}
