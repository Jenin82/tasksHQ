import { env } from "cloudflare:workers";
import { DomainError } from "@tasks/core/errors";
import { readTaskImageBytes, storeTaskImage, taskImagePath } from "@tasks/core/task-images";
import { getProjectContext } from "@/lib/project-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string; project: string }> },
) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return new Response(null, { status: 403 });
  }

  const { org, project } = await params;
  const context = await getProjectContext(org, project);
  if (!request.body) return Response.json({ error: "Choose an image to upload." }, { status: 400 });

  try {
    const bytes = await readTaskImageBytes(request.body);
    const id = await storeTaskImage(env, context.project.id, bytes);
    return Response.json({ path: taskImagePath(org, project, id) }, { status: 201 });
  } catch (error) {
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
