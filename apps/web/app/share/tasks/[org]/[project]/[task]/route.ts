import { taskPreviewPath, type TaskPreviewParams } from "@/lib/task-preview";
import { resolveLegacyTaskShare, sharedPreviewHeaders, sharedTaskPreviewPath } from "@/lib/task-share";
import { renderTaskShare } from "@/lib/task-share-page";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<TaskPreviewParams> }) {
  const route = await params;
  const token = new URL(request.url).searchParams.get("preview");
  const location = await resolveLegacyTaskShare(route, token);
  if (!location || !token) return new Response(null, { status: 404, headers: sharedPreviewHeaders });
  return renderTaskShare(location, sharedTaskPreviewPath(route, token), sharedTaskPreviewPath(route, token, true), taskPreviewPath(route));
}
