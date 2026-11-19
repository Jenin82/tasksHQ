"use server";

import { revalidatePath } from "next/cache";
import { deleteArchivedTask } from "@tasks/core/domain";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";

export async function deleteArchivedTaskAction(
  teamSlug: string,
  projectSlug: string,
  taskId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { team, project, user } = await getProjectContext(teamSlug, projectSlug);
  try {
    await deleteArchivedTask(
      { db, actorUserId: user.id, source: "web" },
      { projectId: project.id, taskId, confirmation: String(formData.get("confirmation") ?? "") },
    );
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(`/${team.slug}/${project.slug}`, "layout");
  return NO_ERROR;
}
