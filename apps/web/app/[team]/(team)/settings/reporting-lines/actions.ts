"use server";

import { revalidatePath } from "next/cache";
import { setReportingLead } from "@tasks/core/domain";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getTeamContext } from "@/lib/team-context";

export async function setReportingLeadAction(
  teamSlug: string,
  expectedLeadUserId: string | null,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { team, user } = await getTeamContext(teamSlug);
  const userId = String(formData.get("userId") ?? "");
  const leadUserId = String(formData.get("leadUserId") ?? "");
  if (!userId || (!leadUserId && expectedLeadUserId === null)) {
    return { error: "Choose a direct lead and a direct report." };
  }

  try {
    await setReportingLead(
      { db, actorUserId: user.id, source: "web" },
      { teamId: team.id, userId, leadUserId: leadUserId || null, expectedLeadUserId },
    );
  } catch (error) {
    return toActionState(error, { leadUserId });
  }

  revalidatePath(`/${team.slug}`, "layout");
  return NO_ERROR;
}
