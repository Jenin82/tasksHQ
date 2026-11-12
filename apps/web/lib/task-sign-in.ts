import { isTaskShareCode, parseTaskKey, taskKey } from "@tasks/core/domain";
import { DomainError } from "@tasks/core/errors";
import { assertValidSlug } from "@tasks/core/slug";
import type { TaskPreviewParams } from "@/lib/task-preview";

export function parseCanonicalTaskPath(value: string): TaskPreviewParams | null {
  // Accept the canonical path literally, without URL normalization.
  if (/[^/A-Za-z0-9-]/.test(value)) return null;
  const segments = value.split("/");
  if (segments.length !== 4 || segments[0] !== "") return null;
  const [, org, project, key] = segments;
  const parsed = parseTaskKey(key);
  if (!parsed || !Number.isSafeInteger(parsed.number) || taskKey(parsed.projectKey.toUpperCase(), parsed.number) !== key) {
    return null;
  }
  try {
    assertValidSlug("Organization slug", org);
    assertValidSlug("Project slug", project);
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
  return { org, project, task: key };
}

export function taskSignInDestination(value: unknown) {
  if (typeof value !== "string") return null;
  if (value.startsWith("/s/") && isTaskShareCode(value.slice(3))) return value;
  return parseCanonicalTaskPath(value) ? value : null;
}

export function taskSignInUrl(taskPath: string | null) {
  return taskPath ? `/?next=${encodeURIComponent(taskPath)}` : "/";
}
