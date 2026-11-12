"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { deleteOrg, renameOrg } from "@tasks/core/domain";
import { toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";

export async function renameOrgAction(
  orgSlug: string,
  orgId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { org, user } = await getOrgContext(orgSlug);
  if (org.id !== orgId) notFound();
  const name = String(formData.get("name") ?? "");

  let savedName: string;
  try {
    savedName = await renameOrg(
      { db, actorUserId: user.id, source: "web" },
      { orgId, name },
    );
  } catch (error) {
    return toActionState(error, { name });
  }

  revalidatePath("/", "page");
  revalidatePath(`/${org.slug}`, "layout");
  return { values: { name: savedName } };
}

export async function deleteOrgAction(
  orgSlug: string,
  orgId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { org, user } = await getOrgContext(orgSlug);
  if (org.id !== orgId) notFound();

  try {
    await deleteOrg(
      { db, actorUserId: user.id, source: "web" },
      { orgId, confirmation: String(formData.get("confirmation") ?? "") },
    );
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/", "page");
  revalidatePath(`/${org.slug}`, "layout");
  redirect("/");
}
