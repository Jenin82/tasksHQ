"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  createStatus,
  deleteProject,
  deleteStatus,
  recolorStatus,
  renameStatus,
  reorderStatus,
  setProjectMemberRole,
  setProjectTaskEditRestriction,
} from "@tasks/core/domain";
import { DomainError } from "@tasks/core/errors";
import { status } from "@tasks/core/schema";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { emailEnabled } from "@/lib/smtp";
import { getProjectContext } from "@/lib/project-context";

export async function deleteProjectAction(
  orgSlug: string,
  projectSlug: string,
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { org, project, user } = await getProjectContext(orgSlug, projectSlug);
  if (project.id !== projectId) notFound();

  try {
    await deleteProject(
      { db, actorUserId: user.id, source: "web" },
      { projectId, confirmation: String(formData.get("confirmation") ?? "") },
    );
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/", "page");
  revalidatePath(`/${org.slug}`, "layout");
  redirect(`/${org.slug}`);
}

/**
 * §2: no mutation SQL and no domain logic here. Every action below resolves the caller,
 * hands a domain function the ids the form carried, and maps the refusal.
 *
 * The capability check is the domain layer's — `requireProjectCapability`
 * inside each function — so this file has no second role matrix, and a hand-made
 * request from a plain member is refused even though the UI renders no control.
 */
async function settings(formData: FormData) {
  const orgSlug = String(formData.get("org") ?? "");
  const projectSlug = String(formData.get("project") ?? "");
  // Re-proved per action: a layout is not a security boundary (§4.6).
  const { project, user } = await getProjectContext(orgSlug, projectSlug);

  // The domain proves the caller manages the *status's* project, not the one
  // in the URL; this read ties the two together for the actions that carry a
  // status id, so a form cannot reach across projects or revalidate the wrong
  // page.
  const statusId = formData.get("statusId");
  if (statusId !== null) {
    const [row] = await db
      .select({ projectId: status.projectId })
      .from(status)
      .where(eq(status.id, String(statusId)));
    if (row?.projectId !== project.id) notFound();
  }

  return {
    ctx: { db, actorUserId: user.id, source: "web" as const, emailNotifications: emailEnabled },
    projectId: project.id,
    /**
     * The whole project subtree, not just this page: a status rename,
     * recolor, reorder or delete changes what the board and the table
     * render too. `"layout"` is the one call that covers all three.
     */
    revalidate: () => revalidatePath(`/${orgSlug}/${projectSlug}`, "layout"),
  };
}

function parseColor(value: FormDataEntryValue | null) {
  const color = status.color.enumValues.find((option) => option === value);
  if (color === undefined) throw new DomainError("Pick a status color.");
  return color;
}

/** An empty string is how a `<select>` spells "none" — never a status id. */
function optionalId(value: FormDataEntryValue | null): string | null {
  const id = String(value ?? "");
  return id === "" ? null : id;
}

export async function createStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, projectId, revalidate } = await settings(formData);
  const name = String(formData.get("name") ?? "");

  try {
    await createStatus(ctx, {
      projectId,
      name,
      color: parseColor(formData.get("color") ?? "gray"),
    });
  } catch (error) {
    return toActionState(error, { name });
  }

  revalidate();
  return NO_ERROR;
}

export async function renameStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, revalidate } = await settings(formData);
  const name = String(formData.get("name") ?? "");

  try {
    await renameStatus(ctx, {
      statusId: String(formData.get("statusId") ?? ""),
      name,
    });
  } catch (error) {
    return toActionState(error, { name });
  }

  revalidate();
  return NO_ERROR;
}

export async function recolorStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, revalidate } = await settings(formData);
  try {
    await recolorStatus(ctx, {
      statusId: String(formData.get("statusId") ?? ""),
      color: parseColor(formData.get("color")),
    });
  } catch (error) {
    const state = toActionState(error);
    revalidate();
    return state;
  }

  revalidate();
  return NO_ERROR;
}

/**
 * `after` is the status this one should sit directly behind, or empty for
 * first (§16). The list is rendered in order, so the client already knows which
 * neighbour a move lands on and sends it — the fractional key is computed in
 * the domain layer, and the move writes one row.
 */
export async function reorderStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, revalidate } = await settings(formData);

  try {
    await reorderStatus(ctx, {
      statusId: String(formData.get("statusId") ?? ""),
      afterStatusId: optionalId(formData.get("after")),
    });
  } catch (error) {
    return toActionState(error);
  }

  revalidate();
  return NO_ERROR;
}

/**
 * §3: blocked while tasks reference it, and the target is required up front —
 * the form only offers a delete for a non-empty status with a destination
 * chosen, so the refusal is a backstop rather than the normal path.
 */
export async function deleteStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, revalidate } = await settings(formData);

  try {
    await deleteStatus(ctx, {
      statusId: String(formData.get("statusId") ?? ""),
      moveTasksToStatusId: optionalId(formData.get("moveTasksTo")),
    });
  } catch (error) {
    const state = toActionState(error);
    // The refusal is almost always a count that moved under the form — a task
    // created elsewhere since the page loaded. Revalidating makes the row
    // re-render with the destination picker the retry needs.
    revalidate();
    return state;
  }

  revalidate();
  return NO_ERROR;
}

export async function setProjectMemberRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ctx, projectId, revalidate } = await settings(formData);
  const role = formData.get("role");
  const userId = String(formData.get("userId") ?? "");
  try {
    if (role !== "member" && role !== "admin") {
      throw new DomainError("Choose a valid project role.");
    }
    await setProjectMemberRole(ctx, {
      projectId,
      userId,
      role,
    });
  } catch (error) {
    return toActionState(error, { userId });
  }
  revalidate();
  return NO_ERROR;
}

export async function setProjectTaskEditRestrictionAction(
  orgSlug: string,
  projectSlug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { org, project, user } = await getProjectContext(orgSlug, projectSlug);
  const restricted = formData.get("restricted");
  if (restricted !== "true" && restricted !== "false") return { error: "Choose a valid task editing setting." };

  try {
    await setProjectTaskEditRestriction(
      { db, actorUserId: user.id, source: "web" },
      { projectId: project.id, restricted: restricted === "true" },
    );
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(`/${org.slug}/${project.slug}`, "layout");
  revalidatePath(`/${org.slug}/settings/your-tasks`);
  revalidatePath(`/${org.slug}/settings/your-team`);
  revalidatePath("/[org]/settings/all-tasks", "page");
  return NO_ERROR;
}
