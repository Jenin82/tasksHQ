"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProject } from "@tasks/core/domain";
import type { Project } from "@tasks/core/schema";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getTeamContext } from "@/lib/team-context";

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // getTeamContext re-checks membership; createProject re-checks the capability
  // independently, because MCP never runs a layout (§4.6).
  const { team, user } = await getTeamContext(String(formData.get("team") ?? ""));
  const input = {
    slug: String(formData.get("slug") ?? "").trim().toLowerCase(),
    name: String(formData.get("name") ?? ""),
    key: String(formData.get("key") ?? "").trim().toUpperCase(),
  };

  let created: Project;
  try {
    created = await createProject(
      { db, actorUserId: user.id, source: "web" },
      { teamId: team.id, ...input },
    );
  } catch (error) {
    return toActionState(error, input);
  }

  // The client router still holds the trees it rendered before the action;
  // without this the projects list and the top bar's project switcher,
  // rendered by `[team]/layout`, would not show the new project. "layout" so
  // every route under the team is invalidated, not just one page.
  revalidatePath(`/${team.slug}`, "layout");
  // Outside the try: redirect() signals by throwing, and toActionState would
  // have to let it past anyway. A new project is made to be worked in.
  redirect(`/${team.slug}/${created.slug}`);
  return NO_ERROR;
}
