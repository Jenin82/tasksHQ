import { type TaskPreviewParams } from "@/lib/task-preview";
import { taskPreviewImage } from "@/lib/task-preview-image";
import { readSharedTaskImage, resolveLegacyTaskShare, sharedPreviewHeaders } from "@/lib/task-share";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<TaskPreviewParams> },
) {
  const token = new URL(request.url).searchParams.get("preview");
  const location = await resolveLegacyTaskShare(await params, token);
  const task = location && await readSharedTaskImage(location);
  return task
    ? taskPreviewImage(task, sharedPreviewHeaders)
    : new Response(null, { status: 404, headers: sharedPreviewHeaders });
}
