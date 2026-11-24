"use server";

import { redirect } from "next/navigation";
import { createTeam } from "@tasks/core/domain";
import type { Team } from "@tasks/core/schema";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export async function createTeamAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const input = {
    slug: String(formData.get("slug") ?? "").trim().toLowerCase(),
    name: String(formData.get("name") ?? ""),
  };

  let created: Team;
  try {
    created = await createTeam({ db, actorUserId: user.id, source: "web" }, input);
  } catch (error) {
    return toActionState(error, input);
  }

  // Outside the try: redirect() signals by throwing, and toActionState would
  // have to let it past anyway.
  redirect(`/${created.slug}`);
  return NO_ERROR;
}
