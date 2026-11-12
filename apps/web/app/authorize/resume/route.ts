import { authorizationFailure } from "@/lib/mcp-consent";
import { AUTH_ISSUER, oauthEnv } from "@/lib/mcp-oauth";
import { authorizationRedirect, findSignIn, getAuthorizationSession } from "../flow";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== AUTH_ISSUER) return authorizationFailure("Use the TasksHQ authorization address.");
  const transaction = await findSignIn(request, url.searchParams.get("nonce"));
  if (!transaction || !(await getAuthorizationSession(request))) {
    return authorizationFailure("This sign-in request has expired or is invalid.");
  }
  await oauthEnv.OAUTH_KV.delete(transaction.key);
  return authorizationRedirect(transaction.url.href, new Headers({
    "Set-Cookie": transaction.clearCookie,
  }));
}
