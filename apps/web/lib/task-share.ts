import { Buffer } from "node:buffer";
import { env } from "cloudflare:workers";
import { and, eq, isNull, or } from "drizzle-orm";
import { isTaskShareCode, parseTaskKey, taskKey } from "@tasks/core/domain";
import { org, project, projectTaskType, status, task, taskShare, user } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { taskPreviewPath, type TaskPreviewParams } from "@/lib/task-preview";

const encoder = new TextEncoder();
const tokenPattern = /^([A-Za-z0-9_-]{1,384})\.([A-Za-z0-9_-]{43})$/;

export type SharedTaskLocation = { route: TaskPreviewParams; taskId: string; projectId: string; number: number };

export const sharedPreviewHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

async function signingKey() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

function signedMessage(params: TaskPreviewParams, payload: string) {
  return encoder.encode(`tasks:share-preview:v1:${taskPreviewPath(params)}:${payload}`);
}

export function sharedTaskPreviewPath(params: TaskPreviewParams, token: string, image = false) {
  return `/share/tasks${taskPreviewPath(params)}${image ? "/preview.png" : ""}?preview=${encodeURIComponent(token)}`;
}

export function shortTaskSharePath(code: string, image = false) {
  return `/s/${code}${image ? "/preview.png" : ""}`;
}

export async function findCanonicalTaskShareCode(route: TaskPreviewParams) {
  const key = parseTaskKey(route.task);
  if (!key) return null;
  const [row] = await db.select({ code: taskShare.code }).from(org)
    .innerJoin(project, eq(project.orgId, org.id))
    .innerJoin(task, eq(task.projectId, project.id))
    .innerJoin(taskShare, and(
      eq(taskShare.taskId, task.id),
      eq(taskShare.projectId, task.projectId),
      eq(taskShare.number, task.number),
    ))
    .where(and(
      eq(org.slug, route.org),
      eq(project.slug, route.project),
      eq(project.key, key.projectKey),
      eq(task.number, key.number),
      eq(taskShare.canonicalPreview, true),
    ));
  return row?.code ?? null;
}

export async function resolveShortTaskShare(code: string): Promise<SharedTaskLocation | null> {
  if (!isTaskShareCode(code)) return null;
  const [row] = await db.select({
    taskId: taskShare.taskId, projectId: taskShare.projectId, number: taskShare.number,
    orgSlug: org.slug, projectSlug: project.slug, keyPrefix: project.key,
  }).from(taskShare)
    .innerJoin(project, eq(project.id, taskShare.projectId))
    .innerJoin(org, eq(org.id, project.orgId))
    .where(eq(taskShare.code, code));
  if (!row) return null;
  const { taskId, projectId, number, orgSlug, projectSlug, keyPrefix } = row;
  return { taskId, projectId, number, route: { org: orgSlug, project: projectSlug, task: taskKey(keyPrefix, number) } };
}

/** Previously copied links still grant access to the same image. */
export async function resolveLegacyTaskShare(params: TaskPreviewParams, token: string | null): Promise<SharedTaskLocation | null> {
  const parsed = parseTaskKey(params.task);
  const match = token && tokenPattern.exec(token);
  if (!parsed || !Number.isSafeInteger(parsed.number) || !match) return null;
  const [, payload, signature] = match;
  const signatureBytes = Buffer.from(signature, "base64url");
  if (signatureBytes.toString("base64url") !== signature) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(),
    Uint8Array.from(signatureBytes),
    signedMessage(params, payload),
  );
  if (!valid) return null;

  const ids: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!Array.isArray(ids) || ids.length !== 2 || ids.some((id) => typeof id !== "string")) return null;
  const [taskId, projectId] = ids;
  return { taskId, projectId, number: parsed.number, route: params };
}

function sharedTaskScope(location: SharedTaskLocation) {
  return and(
    eq(task.id, location.taskId),
    eq(task.projectId, location.projectId),
    eq(task.number, location.number),
    eq(project.slug, location.route.project),
    eq(org.slug, location.route.org),
  );
}

export async function hasSharedTaskImage(location: SharedTaskLocation) {
  const [current] = await db.select({ id: task.id }).from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .innerJoin(org, eq(org.id, project.orgId))
    .where(sharedTaskScope(location));
  return !!current;
}

export async function readSharedTaskImage(location: SharedTaskLocation) {
  const [result] = await db.select({
    title: task.title,
    priority: task.priority,
    status: { name: status.name, color: status.color },
    type: { name: projectTaskType.name, color: projectTaskType.color, icon: projectTaskType.icon },
    assignee: { id: user.id, image: user.image },
  })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .innerJoin(org, eq(org.id, project.orgId))
    .innerJoin(status, and(eq(status.id, task.statusId), eq(status.projectId, project.id)))
    .innerJoin(projectTaskType, and(
      eq(projectTaskType.projectId, task.projectId),
      or(eq(projectTaskType.id, task.typeId), and(isNull(task.typeId), eq(projectTaskType.isDefault, true))),
    ))
    .leftJoin(user, eq(user.id, task.assigneeUserId))
    .where(sharedTaskScope(location));
  return result ? { key: location.route.task, ...result, description: null } : null;
}
