"use server";

import { revalidatePath } from "next/cache";
import { setReportingLead } from "@tasks/core/domain";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";

export async function setReportingLeadAction(
  orgSlug: string,
  expectedLeadUserId: string | null,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { org, user } = await getOrgContext(orgSlug);
  const userId = String(formData.get("userId") ?? "");
  const leadUserId = String(formData.get("leadUserId") ?? "");
  if (!userId || (!leadUserId && expectedLeadUserId === null)) {
    return { error: "Choose a direct lead and a team member." };
  }

  try {
    await setReportingLead(
      { db, actorUserId: user.id, source: "web" },
      { orgId: org.id, userId, leadUserId: leadUserId || null, expectedLeadUserId },
    );
  } catch (error) {
    return toActionState(error, { leadUserId });
  }

  revalidatePath(`/${org.slug}`, "layout");
  return NO_ERROR;
}
