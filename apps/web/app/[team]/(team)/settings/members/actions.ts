"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeTeamMemberRole,
  inviteToTeam,
  removeTeamMember,
  revokeTeamInvite,
} from "@tasks/core/domain";
import { DomainError } from "@tasks/core/errors";
import type { TeamMember } from "@tasks/core/schema";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { emailEnabled } from "@/lib/smtp";
import { getTeamContext } from "@/lib/team-context";

function parseRole(value: FormDataEntryValue | null): TeamMember["role"] {
  const role = String(value ?? "");
  if (role === "owner" || role === "admin" || role === "member") return role;
  throw new DomainError("Pick a role.");
}

export async function inviteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { team, user } = await getTeamContext(String(formData.get("team") ?? ""));
  const email = String(formData.get("email") ?? "");
  const role = formData.get("role");

  try {
    await inviteToTeam(
      { db, actorUserId: user.id, source: "web", emailNotifications: emailEnabled },
      { teamId: team.id, email, role: parseRole(role) },
    );
  } catch (error) {
    return toActionState(error, { email, role: String(role ?? "member") });
  }

  revalidatePath(`/${team.slug}/settings/members`);
  return NO_ERROR;
}

export async function changeMemberRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { team, user } = await getTeamContext(String(formData.get("team") ?? ""));

  try {
    await changeTeamMemberRole(
      { db, actorUserId: user.id, source: "web" },
      {
        teamId: team.id,
        userId: String(formData.get("userId") ?? ""),
        role: parseRole(formData.get("role")),
      },
    );
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(`/${team.slug}/settings/members`);
  return NO_ERROR;
}

export async function revokeMemberInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { team, user } = await getTeamContext(String(formData.get("team") ?? ""));
  try {
    await revokeTeamInvite({ db, actorUserId: user.id, source: "web" }, {
      teamId: team.id, email: String(formData.get("email") ?? ""),
    });
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath(`/${team.slug}/settings/members`);
  return NO_ERROR;
}

export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { team, user } = await getTeamContext(String(formData.get("team") ?? ""));
  const userId = String(formData.get("userId") ?? "");

  try {
    await removeTeamMember(
      { db, actorUserId: user.id, source: "web" },
      { teamId: team.id, userId },
    );
  } catch (error) {
    return toActionState(error);
  }

  // Removing yourself ends your reach into this team, so revalidating would
  // re-render the page you can no longer see as a 404. `/` routes to whatever
  // teams remain. Outside the try: redirect() signals by throwing.
  if (userId === user.id) redirect("/");

  revalidatePath(`/${team.slug}/settings/members`);
  return NO_ERROR;
}
