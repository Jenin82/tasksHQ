import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { uploadedProfileAvatarKey } from "@tasks/core/domain";

const googleAvatarHosts = new Set([
  "lh3.googleusercontent.com",
  "lh4.googleusercontent.com",
  "lh5.googleusercontent.com",
  "lh6.googleusercontent.com",
]);
const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxInputBytes = 128 * 1024;
const maxPngBytes = 64 * 1024;

async function avatarBody(userId: string, image: string) {
  const key = uploadedProfileAvatarKey(userId, image);
  if (key) {
    const object = await env.TASK_IMAGES.get(key);
    if (!object) return null;
    if (object.httpMetadata?.contentType === "image/webp" && object.size <= maxInputBytes) {
      return object.body;
    }
    await object.body.cancel();
    return null;
  }

  const url = URL.parse(image);
  if (!url || url.protocol !== "https:" || !googleAvatarHosts.has(url.hostname) ||
    url.port || url.username || url.password || url.hash) return null;

  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(2_000) });
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (response.ok && supportedMimeTypes.has(mime) &&
    Number(response.headers.get("content-length")) <= maxInputBytes) {
    return response.body;
  }
  await response.body?.cancel();
  return null;
}

/** Embed a profile photo only after the caller has resolved the task preview. */
export async function taskPreviewAvatar(assignee: { id: string; image?: string | null }) {
  if (!assignee.image) return null;

  try {
    const body = await avatarBody(assignee.id, assignee.image);
    if (!body) return null;

    let size = 0;
    const bounded = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maxInputBytes) throw new Error("Profile photo is too large.");
        controller.enqueue(chunk);
      },
    }));

    // The PNG renderer accepts PNG data URIs for embedded photos, including
    // uploaded WebP avatars after a local resize and conversion.
    const transformed = await env.IMAGES.input(bounded)
      .transform({ width: 96, height: 96, fit: "cover" })
      .output({ format: "image/png", anim: false });
    const png = transformed.response();
    if (!png.ok || png.headers.get("content-type") !== "image/png") {
      await png.body?.cancel();
      return null;
    }

    const bytes = await png.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > maxPngBytes) return null;
    return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}
