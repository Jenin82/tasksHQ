import { taskPreviewImage } from "@/lib/task-preview-image";
import { readSharedTaskImage, resolveShortTaskShare, sharedPreviewHeaders } from "@/lib/task-share";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const location = await resolveShortTaskShare((await params).code);
  const task = location && await readSharedTaskImage(location);
  return task
    ? taskPreviewImage(task, sharedPreviewHeaders)
    : new Response(null, { status: 404, headers: sharedPreviewHeaders });
}
