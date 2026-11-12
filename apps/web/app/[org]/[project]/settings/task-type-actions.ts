"use server";

import { revalidatePath } from "next/cache";
import {
  createProjectTaskType,
  deleteProjectTaskType,
  renameProjectTaskType,
  setDefaultProjectTaskType,
} from "@tasks/core/domain";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";

export async function saveTaskTypeAction(
  orgSlug: string,
  projectSlug: string,
  typeId: string | null,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { org, project, user } = await getProjectContext(orgSlug, projectSlug);
  const ctx = { db, actorUserId: user.id, source: "web" as const };
  const projectId = project.id;
  const values = {
    name: String(form.get("name") ?? ""),
    color: String(form.get("color") ?? ""),
    icon: String(form.get("icon") ?? ""),
  };

  try {
    if (typeId === null) {
      await createProjectTaskType(ctx, { projectId, ...values });
    } else {
      const target = { projectId, typeId };
      switch (form.get("operation")) {
        case "default":
          await setDefaultProjectTaskType(ctx, target);
          break;
        case "delete":
          await deleteProjectTaskType(ctx, target);
          break;
        default:
          await renameProjectTaskType(ctx, { ...target, ...values });
      }
    }
  } catch (error) {
    return toActionState(error, values);
  }

  revalidatePath(`/${org.slug}`, "layout");
  return NO_ERROR;
}
