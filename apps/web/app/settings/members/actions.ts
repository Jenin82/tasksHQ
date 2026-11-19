"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeOrgMemberRole,
  inviteToOrg,
  removeOrgMember,
  revokeOrgInvite,
} from "@tasks/core/domain";
import { DomainError } from "@tasks/core/errors";
import type { OrgRole } from "@tasks/core/schema";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { emailEnabled } from "@/lib/smtp";

const PAGE = "/settings/members";

function parseRole(value: FormDataEntryValue | null): OrgRole {
  const role = String(value ?? "");
  if (role === "owner" || role === "admin" || role === "member") return role;
  throw new DomainError("Pick a role.");
}

export async function inviteOrgMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const email = String(formData.get("email") ?? "");
  const role = formData.get("role");
  try {
    await inviteToOrg(
      { db, actorUserId: user.id, source: "web", emailNotifications: emailEnabled },
      { email, role: parseRole(role) },
    );
  } catch (error) {
    return toActionState(error, { email, role: String(role ?? "member") });
  }
  revalidatePath(PAGE);
  return NO_ERROR;
}

export async function changeOrgMemberRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await changeOrgMemberRole(
      { db, actorUserId: user.id, source: "web" },
      { userId: String(formData.get("userId") ?? ""), role: parseRole(formData.get("role")) },
    );
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(PAGE);
  return NO_ERROR;
}

export async function revokeOrgInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await revokeOrgInvite({ db, actorUserId: user.id, source: "web" }, { email: String(formData.get("email") ?? "") });
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(PAGE);
  return NO_ERROR;
}

export async function removeOrgMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  try {
    await removeOrgMember({ db, actorUserId: user.id, source: "web" }, { userId });
  } catch (error) {
    return toActionState(error);
  }
  // Leaving the org ends your reach into these pages; `/` explains what is left.
  if (userId === user.id) redirect("/");
  revalidatePath(PAGE);
  return NO_ERROR;
}
