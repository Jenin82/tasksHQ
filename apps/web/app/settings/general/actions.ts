"use server";

import { revalidatePath } from "next/cache";
import { renameOrg } from "@tasks/core/domain";
import { toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export async function renameOrgAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "");
  let savedName: string;
  try {
    savedName = await renameOrg({ db, actorUserId: user.id, source: "web" }, { name });
  } catch (error) {
    return toActionState(error, { name });
  }
  // The name shows in every sidebar.
  revalidatePath("/", "layout");
  return { values: { name: savedName } };
}
