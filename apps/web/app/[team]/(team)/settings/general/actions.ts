"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { deleteTeam, renameTeam } from "@tasks/core/domain";
import { toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getTeamContext } from "@/lib/team-context";

export async function renameTeamAction(
  teamSlug: string,
  teamId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { team, user } = await getTeamContext(teamSlug);
  if (team.id !== teamId) notFound();
  const name = String(formData.get("name") ?? "");

  let savedName: string;
  try {
    savedName = await renameTeam(
      { db, actorUserId: user.id, source: "web" },
      { teamId, name },
    );
  } catch (error) {
    return toActionState(error, { name });
  }

  revalidatePath("/", "page");
  revalidatePath(`/${team.slug}`, "layout");
  return { values: { name: savedName } };
}

export async function deleteTeamAction(
  teamSlug: string,
  teamId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { team, user } = await getTeamContext(teamSlug);
  if (team.id !== teamId) notFound();

  try {
    await deleteTeam(
      { db, actorUserId: user.id, source: "web" },
      { teamId, confirmation: String(formData.get("confirmation") ?? "") },
    );
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/", "page");
  revalidatePath(`/${team.slug}`, "layout");
  redirect("/");
}
