"use server";

import { AccessError } from "@tasks/core/access";
import { createTaskShare, parseTaskKey, taskKey } from "@tasks/core/domain";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { taskPreviewPath } from "@/lib/task-preview";

type ShareTaskResult = { ok: true; path: string } | { ok: false; error: string };

export async function createTaskShareLink(input: {
  orgSlug: string;
  projectSlug: string;
  taskKey: string;
}): Promise<ShareTaskResult> {
  const failure = { ok: false, error: "This task could not be shared." } as const;
  if (
    typeof input?.orgSlug !== "string" ||
    typeof input.projectSlug !== "string" ||
    typeof input.taskKey !== "string"
  ) return failure;
  const parsed = parseTaskKey(input.taskKey);
  if (!parsed) return failure;

  try {
    const { org, project, user } = await getProjectContext(input.orgSlug, input.projectSlug);
    await createTaskShare(
      { db, actorUserId: user.id, source: "web" },
      { projectId: project.id, key: input.taskKey },
    );
    return { ok: true, path: taskPreviewPath({ org: org.slug, project: project.slug, task: taskKey(project.key, parsed.number) }) };
  } catch (error) {
    if (error instanceof AccessError && error.reason === "not_a_member") return failure;
    throw error;
  }
}
