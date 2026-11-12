import { env } from "cloudflare:workers";
import { updateProfileAvatar } from "@tasks/core/domain";
import { DomainError } from "@tasks/core/errors";
import { readTaskImageBytes } from "@tasks/core/task-images";
import { db } from "@/lib/db";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

async function changeAvatar(request: Request, remove: boolean) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return new Response(null, { status: 403, headers });
  }
  const user = await getUser();
  if (!user) return Response.json({ error: "Sign in to change your profile photo." }, { status: 401, headers });
  const upload = remove ? null : request.body;
  if (!remove && !upload) {
    return Response.json({ error: "Choose a profile photo to upload." }, { status: 400, headers });
  }

  try {
    const bytes = upload ? await readTaskImageBytes(upload) : null;
    const updated = await updateProfileAvatar(db, env, user.id, bytes);
    if (!updated) {
      return Response.json({ error: "Your profile changed. Try again." }, { status: 409, headers });
    }
    return Response.json(updated, { status: remove ? 200 : 201, headers });
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: 400, headers });
    throw error;
  }
}

export async function POST(request: Request) {
  return changeAvatar(request, false);
}

export async function DELETE(request: Request) {
  return changeAvatar(request, true);
}
