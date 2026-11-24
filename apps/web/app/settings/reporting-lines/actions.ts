"use server";

import { revalidatePath } from "next/cache";
import { AccessError } from "@tasks/core/access";
import { setReportingLead } from "@tasks/core/domain";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";

export async function setReportingLeadAction(
  expectedLeadUserId: string | null,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await getOrgContext();
  const userId = String(formData.get("userId") ?? "");
  const leadUserId = String(formData.get("leadUserId") ?? "");
  if (!userId || (!leadUserId && expectedLeadUserId === null)) {
    return { error: "Choose a direct lead and a direct report." };
  }

  try {
    await setReportingLead(
      { db, actorUserId: user.id, source: "web" },
      { userId, leadUserId: leadUserId || null, expectedLeadUserId },
    );
  } catch (error) {
    // A role lost after the page loaded shows in the form rather than as a 403 page.
    if (error instanceof AccessError && error.reason === "forbidden") return { error: error.message, values: { leadUserId } };
    return toActionState(error, { leadUserId });
  }

  // Lines drive the Time page.
  revalidatePath("/settings", "layout");
  return NO_ERROR;
}
