import { createHash, timingSafeEqual } from "node:crypto";
import { authorizationServer, MCP_RESOURCE, oauthEnv } from "@/lib/mcp-oauth";
import { emailEnabled } from "@/lib/smtp";

const headers = { "Cache-Control": "no-store" };

function matchesSecret(provided: string, expected: string) {
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export async function POST(request: Request) {
  const expected = oauthEnv.INTROSPECT_SECRET;
  const provided = request.headers.get("X-Introspect-Secret");
  if (!expected) return new Response(null, { status: 503, headers });
  if (!provided || !matchesSecret(provided, expected)) {
    return new Response(null, { status: 403, headers });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 400, headers });
  }
  if (
    typeof payload !== "object" || payload === null ||
    !("resource" in payload) || payload.resource !== MCP_RESOURCE ||
    !("token" in payload) || typeof payload.token !== "string"
  ) {
    return new Response(null, { status: 400, headers });
  }
  if (!payload.token || payload.token.length > 4096) return Response.json(null, { headers });

  const grant = await authorizationServer.validateToken(MCP_RESOURCE, payload.token, oauthEnv);
  if (grant && emailEnabled) {
    return Response.json({ ...grant, props: { ...grant.props as object, emailNotifications: true } }, { headers });
  }
  return Response.json(grant, { headers });
}
