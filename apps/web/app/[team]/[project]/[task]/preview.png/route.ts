import { readPrivateTaskPreview, type TaskPreviewParams } from "@/lib/task-preview";
import { taskPreviewImage } from "@/lib/task-preview-image";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<TaskPreviewParams> },
) {
  const task = await readPrivateTaskPreview(await params);
  return task ? taskPreviewImage(task, headers) : new Response(null, { status: 404, headers });
}
