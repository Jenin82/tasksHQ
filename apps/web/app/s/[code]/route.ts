import { resolveShortTaskShare, sharedPreviewHeaders, shortTaskSharePath } from "@/lib/task-share";
import { renderTaskShare } from "@/lib/task-share-page";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const location = await resolveShortTaskShare(code);
  if (!location) return new Response(null, { status: 404, headers: sharedPreviewHeaders });
  return renderTaskShare(location, shortTaskSharePath(code), shortTaskSharePath(code, true));
}
