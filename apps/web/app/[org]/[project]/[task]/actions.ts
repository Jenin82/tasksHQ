"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { AccessError, canProject } from "@tasks/core/access";
import {
  addComment,
  archiveTask,
  transferTask,
  unarchiveTask,
  updateTask,
} from "@tasks/core/domain";
import { DomainError } from "@tasks/core/errors";
import { project, projectMember, task } from "@tasks/core/schema";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { emailEnabled } from "@/lib/smtp";
import { getOrgContext } from "@/lib/org-context";
import { getProjectContext } from "@/lib/project-context";
import { transferTaskImages } from "@/lib/transfer-task-images";

function revalidateTaskLists(orgSlug: string) {
  revalidatePath(`/${orgSlug}/settings/your-tasks`);
  revalidatePath(`/${orgSlug}/settings/your-team`);
  revalidatePath("/[org]/settings/all-tasks", "page");
}

/**
 * §2: no mutation SQL and no domain logic here. Every action below resolves
 * the caller, hands an existing domain function the ids the form carried, and
 * maps the refusal. In particular a status change goes through `updateTask`'s move
 * path, which logs `task.moved` — never `task.updated` (§3).
 */
async function detail(formData: FormData) {
  const orgSlug = String(formData.get("org") ?? "");
  const projectSlug = String(formData.get("project") ?? "");
  // Re-proved per action: a layout is not a security boundary (§4.6). The
  // task's own reach is re-proved again inside every domain function.
  const { user, project } = await getProjectContext(orgSlug, projectSlug);

  // The domain proves the caller reaches the *task's* project, not the one in
  // the URL. Without this read a form posted under one project could act on a
  // task in another the caller also reaches, and revalidate the wrong page.
  const taskId = String(formData.get("taskId") ?? "");
  const [row] = await db
    .select({ projectId: task.projectId, number: task.number })
    .from(task)
    .where(eq(task.id, taskId));
  if (row?.projectId !== project.id) notFound();

  return {
    ctx: { db, actorUserId: user.id, source: "web" as const, emailNotifications: emailEnabled },
    target: { taskId, projectId: project.id, number: row.number },
    orgSlug,
    /**
     * The whole project subtree: a title, status or assignee change is on the
     * board and in the table too, and archiving removes the task from both.
     */
    revalidate: () => {
      revalidatePath(`/${orgSlug}/${projectSlug}`, "layout");
      revalidateTaskLists(orgSlug);
    },
  };
}

/**
 * A field absent from the form is `undefined` to `updateTask`, which leaves
 * it alone. An empty due date clears the current date.
 */
export async function editTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, target, revalidate } = await detail(formData);
  const title = formData.get("title");
  const description = formData.get("description");
  const dueDate = formData.has("clearDueDate") ? "" : formData.get("dueDate");
  const priority = formData.get("priority");
  const typeId = formData.get("typeId");

  try {
    await updateTask(ctx, {
      ...target,
      title: title === null ? undefined : String(title),
      description: description === null ? undefined : String(description),
      dueDate: dueDate === null ? undefined : String(dueDate) || null,
      priority: priority === null ? undefined : String(priority),
      typeId: typeId === null ? undefined : String(typeId),
    });
  } catch (error) {
    return toActionState(error, {
      ...(title === null ? {} : { title: String(title) }),
      ...(description === null ? {} : { description: String(description) }),
      ...(dueDate === null ? {} : { dueDate: String(dueDate) }),
    });
  }

  revalidate();
  return NO_ERROR;
}

/**
 * §3's precedence rule reaching the UI: this is an update call carrying a
 * status, which `updateTask` routes through `planMove`/`logMove`, so the log
 * says `task.moved` exactly as a board drag does.
 */
export async function setStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, target, revalidate } = await detail(formData);
  const statusId = String(formData.get("statusId") ?? "");

  try {
    await updateTask(ctx, { ...target, statusId });
  } catch (error) {
    return toActionState(error, { statusId });
  }

  revalidate();
  return NO_ERROR;
}

/** An empty string is how a `<select>` spells "nobody" — never a user id. */
export async function assignTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, target, revalidate } = await detail(formData);
  const assigneeUserId = String(formData.get("assigneeUserId") ?? "");

  try {
    await updateTask(ctx, {
      ...target,
      assigneeUserId: assigneeUserId === "" ? null : assigneeUserId,
    });
  } catch (error) {
    return toActionState(error, { assigneeUserId });
  }

  revalidate();
  return NO_ERROR;
}

/**
 * Both directions, because they are one control whose label flips.
 * `unarchiveTask` is web-only by design — §5.7 gives MCP no unarchive tool.
 */
export async function archiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, target, revalidate } = await detail(formData);
  const unarchive = formData.get("intent") === "unarchive";

  try {
    await (unarchive ? unarchiveTask : archiveTask)(ctx, target);
  } catch (error) {
    return toActionState(error);
  }

  revalidate();
  return NO_ERROR;
}

export async function transferTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx, target, orgSlug, revalidate } = await detail(formData);
  const destinationProjectId = String(formData.get("destinationProjectId") ?? "");
  if (!destinationProjectId) return { error: "Choose a destination project." };

  let moved: Awaited<ReturnType<typeof transferTask>>;
  try {
    moved = await transferTask(ctx, {
      taskId: target.taskId, sourceProjectId: target.projectId, number: target.number, destinationProjectId,
    }, (description, source, destination) => transferTaskImages(description, orgSlug, source, destination));
  } catch (error) {
    return toActionState(error, { destinationProjectId });
  }

  revalidate();
  revalidatePath(`/${orgSlug}/${moved.projectSlug}`, "layout");
  redirect(`/${orgSlug}/${moved.projectSlug}/${moved.key}`);
}

type BulkField = "statusId" | "priority" | "typeId" | "assigneeUserId" | "archive";
type BulkTaskChange = { taskId: string; projectSlug: string; value: string };
type BulkTaskResult = {
  updatedIds: string[];
  failures: { taskId: string; error: string }[];
  error?: string;
};

export async function bulkUpdateTasksAction(input: {
  orgSlug: string;
  field: BulkField;
  changes: BulkTaskChange[];
}): Promise<BulkTaskResult> {
  const updatedIds: string[] = [];
  const failures: BulkTaskResult["failures"] = [];
  if (
    typeof input?.orgSlug !== "string" ||
    !["statusId", "priority", "typeId", "assigneeUserId", "archive"].includes(input.field) ||
    !Array.isArray(input.changes) ||
    input.changes.length < 1 ||
    input.changes.length > 50 ||
    input.changes.some((change) =>
      typeof change?.taskId !== "string" || typeof change.projectSlug !== "string" || typeof change.value !== "string",
    )
  ) {
    return { updatedIds, failures, error: "Select between 1 and 50 tasks and choose a valid action." };
  }

  const { orgSlug, field, changes } = input;
  const taskIds = new Set(changes.map(({ taskId }) => taskId));
  if (taskIds.size !== changes.length) {
    return { updatedIds, failures, error: "Select each task once." };
  }

  const { org, member, user } = await getOrgContext(orgSlug);
  const rows = await db
    .select({
      taskId: task.id,
      projectId: project.id,
      number: task.number,
      projectSlug: project.slug,
      archivedAt: task.archivedAt,
      projectRole: projectMember.role,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .leftJoin(projectMember, and(
      eq(projectMember.projectId, project.id),
      eq(projectMember.orgId, project.orgId),
      eq(projectMember.userId, user.id),
    ))
    .where(and(
      inArray(task.id, [...taskIds]),
      eq(project.orgId, org.id),
    ));
  const accessible = new Map(rows.map((row) => [row.taskId, row]));
  const changedProjects = new Set<string>();
  const ctx = { db, actorUserId: user.id, source: "web" as const, emailNotifications: emailEnabled };

  // Run moves in order so each task appends after the previous move.
  for (const { taskId, projectSlug, value } of changes) {
    const row = accessible.get(taskId);
    if (!row || row.projectSlug !== projectSlug) {
      failures.push({ taskId, error: "This task is no longer available in that project." });
      continue;
    }
    if (!canProject(member.role, row.projectRole, "project:manage_members")) {
      failures.push({ taskId, error: "Only administrators can bulk edit tasks in this project." });
      continue;
    }
    if (row.archivedAt && field !== "archive") {
      failures.push({ taskId, error: "This task is archived." });
      continue;
    }

    try {
      const target = { taskId, projectId: row.projectId, number: row.number };
      if (field === "archive") {
        await archiveTask(ctx, target);
      } else if (field === "assigneeUserId") {
        await updateTask(ctx, { ...target, assigneeUserId: value || null });
      } else {
        await updateTask(ctx, { ...target, [field]: value });
      }
      updatedIds.push(taskId);
      changedProjects.add(projectSlug);
    } catch (error) {
      if (error instanceof AccessError) {
        failures.push({ taskId, error: error.reason === "forbidden" ? error.message : "This task is no longer available in that project." });
      } else if (error instanceof DomainError) {
        failures.push({ taskId, error: error.message });
      } else {
        console.error("Could not complete a bulk task action.", error);
        failures.push({ taskId, error: "The change could not be confirmed. Refresh and try again." });
        changedProjects.add(projectSlug);
      }
    }
  }

  for (const projectSlug of changedProjects) revalidatePath(`/${orgSlug}/${projectSlug}`, "layout");
  if (changedProjects.size) revalidateTaskLists(orgSlug);
  return { updatedIds, failures };
}

export async function addCommentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, target, revalidate } = await detail(formData);
  // Multipart form data can normalize newlines to CRLF. The mention ranges
  // were measured against the textarea's LF representation.
  const body = String(formData.get("body") ?? "").replace(/\r\n?/g, "\n");
  const encodedMentions = formData.get("mentions");

  try {
    let mentions: unknown;
    if (encodedMentions !== null) {
      try {
        if (typeof encodedMentions !== "string") throw new Error("Invalid mention data.");
        mentions = JSON.parse(encodedMentions);
      } catch {
        throw new DomainError("Choose people from the mention list again.");
      }
    }
    await addComment(ctx, { ...target, body, mentions });
  } catch (error) {
    return toActionState(error, { body });
  }

  revalidate();
  return NO_ERROR;
}
