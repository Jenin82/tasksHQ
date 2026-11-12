import { and, eq } from "drizzle-orm";
import { marked } from "marked";
import { AccessError } from "@tasks/core/access";
import { getTaskSummaryByKey, parseTaskKey, type TaskTypeRef } from "@tasks/core/domain";
import { org, project, type Status, type TaskPriority } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getUser } from "@/lib/session";

export type TaskPreviewParams = { org: string; project: string; task: string };

export type TaskPreview = {
  key: string;
  title: string;
  description: string | null;
  status: Pick<Status, "name" | "color">;
  type: Pick<TaskTypeRef, "name" | "color" | "icon">;
  priority: TaskPriority;
  assignee: { id: string; image?: string | null } | null;
};

export const taskPreviewSize = { width: 1200, height: 630 };

export function taskPreviewPath(params: TaskPreviewParams, key = params.task) {
  return "/" + [params.org, params.project, key].map(encodeURIComponent).join("/");
}

export function compactPreviewText(text: string, limit: number) {
  const compact = text.replace(/[\u0000-\u0020\u007f-\u009f\s]+/gu, " ").trim();
  const characters = Array.from(compact);
  if (characters.length <= limit) return compact;
  return characters.slice(0, limit - 1).join("").trimEnd() + "…";
}

export function taskPreviewDescription(task: TaskPreview) {
  const parts: string[] = [];
  if (task.description) {
    marked.walkTokens(marked.lexer(task.description), (token) => {
      switch (token.type) {
        case "paragraph":
        case "heading":
        case "list_item":
        case "blockquote":
        case "space":
        case "br":
          parts.push(" ");
          break;
        case "text":
          if (!token.tokens?.length) parts.push(token.text);
          break;
        case "escape":
        case "codespan":
          parts.push(token.text);
          break;
      }
    });
  }
  return compactPreviewText(parts.join(""), 160) || "Open this work item in TasksHQ.";
}

/** Task data on the ordinary task page and its image always needs project access. */
export async function readPrivateTaskPreview(params: TaskPreviewParams) {
  const viewer = await getUser();
  if (!viewer || !parseTaskKey(params.task)) return null;

  const [scope] = await db
    .select({ id: project.id })
    .from(project)
    .innerJoin(org, eq(org.id, project.orgId))
    .where(and(eq(org.slug, params.org), eq(project.slug, params.project)))
    .limit(1);
  if (!scope) return null;

  try {
    return await getTaskSummaryByKey(
      { db, actorUserId: viewer.id, source: "web" },
      { projectId: scope.id, key: params.task },
    );
  } catch (error) {
    if (error instanceof AccessError && error.reason === "not_a_member") return null;
    throw error;
  }
}
