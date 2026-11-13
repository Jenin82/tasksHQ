"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { createTask, moveTask } from "@tasks/core/domain";
import { task } from "@tasks/core/schema";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { shortDate } from "@/lib/format";
import type { TaskPreview } from "./task-dialog";
import { db } from "@/lib/db";
import { emailEnabled } from "@/lib/smtp";
import { getProjectContext } from "@/lib/project-context";

export type MoveInput = {
  orgSlug: string;
  projectSlug: string;
  taskId: string;
  statusId: string;
  /** The task the card now sits directly after, or null for first. */
  afterTaskId: string | null;
};

/**
 * Persists a board drag. §2: no SQL and no domain logic here — `moveTask`
 * computes the fractional position server-side from the neighbour, which is
 * why the client sends an id rather than a key.
 *
 * `revalidatePath` runs only on success, and only here. The client applies the
 * move with `useOptimistic` inside the same transition that awaits this call,
 * so the revalidated tree is what resolves that transition: the optimistic
 * card is replaced by an identical server-rendered one and never flickers. On
 * failure nothing is revalidated, the transition ends against the unchanged
 * tree, and the optimistic move is discarded — which is the revert.
 */
export async function moveTaskAction(input: MoveInput): Promise<ActionState> {
  // A Server Action is a public endpoint, and its argument arrives as whatever
  // the request body decoded to — `MoveInput` is a compile-time promise only.
  const isString = (value: unknown) => typeof value === "string";
  if (
    !isString(input?.orgSlug) ||
    !isString(input.projectSlug) ||
    !isString(input.taskId) ||
    !isString(input.statusId) ||
    !(input.afterTaskId === null || isString(input.afterTaskId))
  ) {
    return { error: "That move could not be read." };
  }

  const { user, project } = await getProjectContext(
    input.orgSlug,
    input.projectSlug,
  );

  // `[task]/actions.ts`'s `detail()` reason: the domain proves the caller
  // reaches the task's project, not the URL's, and the revalidate below
  // would otherwise refresh the wrong board.
  const [row] = await db
    .select({ projectId: task.projectId, number: task.number })
    .from(task)
    .where(eq(task.id, input.taskId));
  if (row?.projectId !== project.id) notFound();

  try {
    await moveTask(
      { db, actorUserId: user.id, source: "web", emailNotifications: emailEnabled },
      {
        taskId: input.taskId,
        projectId: project.id,
        number: row.number,
        statusId: input.statusId,
        afterTaskId: input.afterTaskId,
      },
    );
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(`/${input.orgSlug}/${input.projectSlug}`);
  revalidatePath("/[org]/settings/all-tasks", "page");
  return NO_ERROR;
}

export type CreateTaskState = ActionState & { task?: TaskPreview };

/** Create from the toolbar or append to a specific board column. */
export async function createTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<CreateTaskState> {
  const orgSlug = String(formData.get("org") ?? "");
  const projectSlug = String(formData.get("project") ?? "");
  const title = String(formData.get("title") ?? "");
  const description = String(formData.get("description") ?? "") || undefined;
  // Absent means "the default todo status" (§18), never the string "null".
  const typeId = formData.get("typeId");
  const statusId = String(formData.get("statusId") ?? "") || undefined;
  const parentTaskId = String(formData.get("parentTaskId") ?? "") || undefined;
  const { user, org, project } = await getProjectContext(orgSlug, projectSlug);

  let created;
  try {
    created = await createTask(
      { db, actorUserId: user.id, source: "web", emailNotifications: emailEnabled },
      {
        projectId: project.id,
        title,
        description,
        assigneeUserId: formData.get("assignSelf") === "on" ? user.id : undefined,
        statusId,
        typeId: typeId === null ? undefined : String(typeId),
        parentTaskId,
      },
    );
  } catch (error) {
    return toActionState(error, { title });
  }

  revalidatePath(`/${orgSlug}/${projectSlug}`, "layout");
  if (created.assignee) {
    revalidatePath(`/${org.slug}/settings/your-tasks`);
    revalidatePath("/[org]/settings/all-tasks", "page");
  }
  return {
    task: {
      href: `/${org.slug}/${project.slug}/${created.key}`,
      key: created.key,
      title: created.title,
      status: { name: created.status.name, color: created.status.color },
      assignee: created.assignee?.displayName ?? null,
      updated: shortDate(created.updatedAt),
      dueDate: created.dueDate,
      priority: created.priority,
      type: created.type,
    },
  };
}
