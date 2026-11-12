import { env } from "cloudflare:workers";
import { TASK_IMAGE_ID, taskImageKey } from "@tasks/core/task-images";
import { getProjectContext } from "@/lib/project-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org: string; project: string; image: string }> },
) {
  const { org, project, image } = await params;
  if (!TASK_IMAGE_ID.test(image)) return new Response(null, { status: 404 });

  const context = await getProjectContext(org, project);
  const object = await env.TASK_IMAGES.get(taskImageKey(context.project.id, image));
  if (!object) return new Response(null, { status: 404 });
  if (object.httpMetadata?.contentType !== "image/webp") {
    await object.body.cancel();
    return new Response(null, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
