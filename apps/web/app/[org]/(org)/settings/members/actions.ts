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
import type { OrgMember } from "@tasks/core/schema";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { emailEnabled } from "@/lib/smtp";
import { getOrgContext } from "@/lib/org-context";

function parseRole(value: FormDataEntryValue | null): OrgMember["role"] {
  const role = String(value ?? "");
  if (role === "owner" || role === "admin" || role === "member") return role;
  throw new DomainError("Pick a role.");
}

export async function inviteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { org, user } = await getOrgContext(String(formData.get("org") ?? ""));
  const email = String(formData.get("email") ?? "");
  const role = formData.get("role");

  try {
    await inviteToOrg(
      { db, actorUserId: user.id, source: "web", emailNotifications: emailEnabled },
      { orgId: org.id, email, role: parseRole(role) },
    );
  } catch (error) {
    return toActionState(error, { email, role: String(role ?? "member") });
  }

  revalidatePath(`/${org.slug}/settings/members`);
  return NO_ERROR;
}

export async function changeMemberRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { org, user } = await getOrgContext(String(formData.get("org") ?? ""));

  try {
    await changeOrgMemberRole(
      { db, actorUserId: user.id, source: "web" },
      {
        orgId: org.id,
        userId: String(formData.get("userId") ?? ""),
        role: parseRole(formData.get("role")),
      },
    );
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(`/${org.slug}/settings/members`);
  return NO_ERROR;
}

export async function revokeMemberInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org, user } = await getOrgContext(String(formData.get("org") ?? ""));
  try {
    await revokeOrgInvite({ db, actorUserId: user.id, source: "web" }, {
      orgId: org.id, email: String(formData.get("email") ?? ""),
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/${org.slug}/settings/members`);
  return NO_ERROR;
}

export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { org, user } = await getOrgContext(String(formData.get("org") ?? ""));
  const userId = String(formData.get("userId") ?? "");

  try {
    await removeOrgMember(
      { db, actorUserId: user.id, source: "web" },
      { orgId: org.id, userId },
    );
  } catch (error) {
    return toActionState(error);
  }

  // Removing yourself ends your reach into this org, so revalidating would
  // re-render the page you can no longer see as a 404. `/` routes to whatever
  // orgs remain. Outside the try: redirect() signals by throwing.
  if (userId === user.id) redirect("/");

  revalidatePath(`/${org.slug}/settings/members`);
  return NO_ERROR;
}
