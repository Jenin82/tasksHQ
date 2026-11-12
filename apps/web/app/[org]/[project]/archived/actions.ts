"use server";

import { revalidatePath } from "next/cache";
import { deleteArchivedTask } from "@tasks/core/domain";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";

export async function deleteArchivedTaskAction(
  orgSlug: string,
  projectSlug: string,
  taskId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { org, project, user } = await getProjectContext(orgSlug, projectSlug);
  try {
    await deleteArchivedTask(
      { db, actorUserId: user.id, source: "web" },
      { projectId: project.id, taskId, confirmation: String(formData.get("confirmation") ?? "") },
    );
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(`/${org.slug}/${project.slug}`, "layout");
  return NO_ERROR;
}
