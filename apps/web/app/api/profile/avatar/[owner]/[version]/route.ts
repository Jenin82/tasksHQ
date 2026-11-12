import { env } from "cloudflare:workers";
import { readableProfileAvatarKey } from "@tasks/core/domain";
import { db } from "@/lib/db";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function missingAvatar() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; version: string }> },
) {
  const viewer = await getUser();
  if (!viewer) return missingAvatar();

  const { owner, version } = await params;
  const key = await readableProfileAvatarKey(db, viewer.id, owner, version);
  if (!key) return missingAvatar();

  const headers = {
    "Content-Type": "image/webp",
    "Cache-Control": "private, no-cache",
    ETag: `"${version}"`,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (request.headers.get("If-None-Match") === headers.ETag) {
    return new Response(null, { status: 304, headers });
  }

  const object = await env.TASK_IMAGES.get(key);
  if (!object) return missingAvatar();
  if (object.httpMetadata?.contentType !== "image/webp") {
    await object.body.cancel();
    return missingAvatar();
  }
  return new Response(object.body, { headers });
}
