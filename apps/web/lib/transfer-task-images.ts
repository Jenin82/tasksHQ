import { env } from "cloudflare:workers";
import { DomainError } from "@tasks/core/errors";
import type { Project } from "@tasks/core/schema";
import { TASK_IMAGE_ID, taskImageKey, taskImagePath } from "@tasks/core/task-images";
import { createDescriptionMarked } from "./description-markdown";

export async function transferTaskImages(description: string, org: string, source: Project, target: Project) {
  const prefix = taskImagePath(org, source.slug, "");
  if (!description.includes("images")) return description;

  const ids = new Map<string, { id: string; offset: number }>();
  const pathPattern = /\\?\/(?:[a-z0-9]|\\?-)+\\?\/(?:[a-z0-9]|\\?-)+\\?\/images\\?\/[0-9a-f]{8}(?:\\?-[0-9a-f]{4}){3}\\?-[0-9a-f]{12}/g;
  // Probe each occurrence independently so matching text in code, or an unused
  // reference definition, stays intact. The editor's lexer decides which URLs
  // are actual Markdown destinations.
  const probed = description.replace(pathPattern, (path: string, offset: number) => {
    const normalized = path.replace(/\\([/-])/g, "$1");
    const id = normalized.slice(prefix.length);
    if (!normalized.startsWith(prefix) || !TASK_IMAGE_ID.test(id)) return path;
    const probe = taskImagePath(org, source.slug, crypto.randomUUID());
    ids.set(probe, { id, offset });
    return probe;
  });
  if (!ids.size) return description;

  const marked = createDescriptionMarked();
  const references = new Map<number, string>();
  marked.walkTokens(marked.lexer(probed), (token) => {
    if (token.type !== "image" && token.type !== "link") return;
    const match = ids.get(token.href);
    if (match) references.set(match.offset, match.id);
  });
  if (!references.size) return description;

  const copied = new Map<string, string | null>();
  const replacements = new Map<number, string>();
  try {
    for (const [offset, id] of references) {
      if (!copied.has(id)) {
        const object = await env.TASK_IMAGES.get(taskImageKey(source.id, id));
        if (!object || object.httpMetadata?.contentType !== "image/webp") {
          await object?.body.cancel();
          copied.set(id, null);
          continue;
        }
        const destinationId = crypto.randomUUID();
        await env.TASK_IMAGES.put(taskImageKey(target.id, destinationId), object.body, {
          httpMetadata: { contentType: "image/webp" },
        });
        copied.set(id, taskImagePath(org, target.slug, destinationId));
      }
      const path = copied.get(id);
      if (path) replacements.set(offset, path);
    }
  } catch (error) {
    console.error("Could not copy work item attachments.", error);
    throw new DomainError("Couldn’t move this work item’s attachments. Try again.");
  }
  return description.replace(pathPattern, (path: string, offset: number) => replacements.get(offset) ?? path);
}
