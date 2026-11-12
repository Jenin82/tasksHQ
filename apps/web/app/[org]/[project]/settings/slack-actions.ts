"use server";

import { env } from "cloudflare:workers";
import { revalidatePath } from "next/cache";
import { forbidden } from "next/navigation";
import { canProject } from "@tasks/core/access";
import { disconnectProjectSlack, queueSlackTest, saveProjectSlack } from "@tasks/core/domain";
import { DomainError } from "@tasks/core/errors";
import { toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { encryptSlackWebhook } from "@/lib/slack";

export type SlackActionState = ActionState & { notice?: string };

export async function updateSlackIntegrationAction(
  orgSlug: string,
  projectSlug: string,
  _previous: SlackActionState,
  formData: FormData,
): Promise<SlackActionState> {
  const { org, project, user, member, projectRole } = await getProjectContext(orgSlug, projectSlug);
  if (!canProject(member.role, projectRole, "project:manage_members")) forbidden();

  const ctx = { db, actorUserId: user.id, source: "web" as const };
  const target = { projectId: project.id };
  let notice: string;

  try {
    switch (formData.get("operation")) {
      case "save": {
        const webhook = formData.get("webhook");
        if (typeof webhook !== "string" || webhook.length > 512) {
          throw new DomainError("Enter a Slack incoming webhook URL.");
        }
        const encryptedWebhook = await encryptSlackWebhook(env.BETTER_AUTH_SECRET, project.id, webhook);
        await saveProjectSlack(ctx, { ...target, encryptedWebhook });
        notice = "Slack webhook saved.";
        break;
      }
      case "test":
        await queueSlackTest(ctx, target);
        notice = "Test message queued. Check the Slack channel shortly.";
        break;
      case "disconnect":
        await disconnectProjectSlack(ctx, target);
        notice = "Slack webhook disconnected.";
        break;
      default:
        throw new DomainError("Choose a Slack integration action.");
    }
  } catch (error) {
    // The webhook is a credential. Never return submitted values to the form.
    return toActionState(error);
  }

  revalidatePath(`/${org.slug}/${project.slug}/settings`);
  return { notice };
}
