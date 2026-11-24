import { teamTimeRedirect } from "../team-time-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ team: string }> }) {
  const path = await teamTimeRedirect((await params).team, new URL(request.url).searchParams, "/settings/time/export");
  return Response.redirect(new URL(path, request.url), 307);
}
