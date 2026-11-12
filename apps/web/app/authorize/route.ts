import {
  AuthorizationError,
  authorizationErrorRedirect,
  CimdFetchError,
  type AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import { authorizationFailure, consentPage, signInPage } from "@/lib/mcp-consent";
import { emailEnabled } from "@/lib/smtp";
import {
  AUTH_ISSUER,
  MCP_RESOURCE,
  OAUTH_SCOPES,
  authorizationServer,
  oauthEnv,
} from "@/lib/mcp-oauth";
import {
  authorizationForm,
  authorizationKey,
  authorizationRedirect,
  authorizationTtl,
  beginSignIn,
  getAuthorizationSession,
} from "./flow";

const consentHandle = /^[A-Za-z0-9_-]{43}$/;

type ConsentSession = { sessionId: string; userId: string; clientName: string };

function rememberConsent(userId: string) {
  return { secret: oauthEnv.CONSENT_SECRET, subject: userId };
}

async function completeAuthorization(
  authRequest: AuthRequest,
  userId: string,
  clientName: string,
  headers?: Headers,
) {
  const oauth = authorizationServer.getOAuthApi(oauthEnv);
  const { redirectTo } = await oauth.completeAuthorization({
    request: authRequest,
    userId,
    scope: authRequest.scope,
    metadata: { clientName },
    props: { userId, clientId: authRequest.clientId, clientName },
  });
  return authorizationRedirect(redirectTo, headers);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== AUTH_ISSUER) return authorizationFailure("Use the TasksHQ authorization address.");
  const oauth = authorizationServer.getOAuthApi(oauthEnv);
  try {
    const authRequest = await oauth.parseAuthRequest(request);
    if (authRequest.resource !== MCP_RESOURCE) {
      return authorizationFailure("This connection is for a different service.");
    }
    if (authRequest.scope.some((scope) => !OAUTH_SCOPES.includes(scope))) {
      return authorizationRedirect(authorizationErrorRedirect(authRequest, "invalid_scope"));
    }

    const session = await getAuthorizationSession(request);
    if (!session) {
      const { nonce, headers } = await beginSignIn(url);
      return signInPage(nonce, headers, emailEnabled);
    }

    const details = await oauth.describeConsent(authRequest);
    if (await oauth.isConsentRemembered(request, authRequest, rememberConsent(session.user.id))) {
      return await completeAuthorization(authRequest, session.user.id, details.clientName);
    }

    const consent = await oauth.beginConsent(authRequest);
    // The provider binds its transaction to the browser. Also bind it to
    // this login so a sign-out or account switch invalidates the open form.
    const binding: ConsentSession = {
      sessionId: session.session.id,
      userId: session.user.id,
      clientName: details.clientName,
    };
    await oauthEnv.OAUTH_KV.put(
      await authorizationKey("consent-session", consent.handle),
      JSON.stringify(binding),
      { expirationTtl: authorizationTtl },
    );
    return consentPage(details, session.user.email, consent.handle, consent.headers);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.redirectTo
        ? authorizationRedirect(error.redirectTo)
        : authorizationFailure(error.description);
    }
    if (error instanceof CimdFetchError) {
      return authorizationFailure("The client’s metadata could not be verified.");
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const form = await authorizationForm(request);
  const handle = form?.get("handle");
  const decision = form?.get("decision");
  if (!handle || !consentHandle.test(handle) || (decision !== "approve" && decision !== "deny")) {
    return authorizationFailure("This authorization form is invalid.");
  }

  const session = await getAuthorizationSession(request);
  const key = await authorizationKey("consent-session", handle);
  const binding = await oauthEnv.OAUTH_KV.get<ConsentSession>(key, "json");
  if (!session || binding?.sessionId !== session.session.id || binding.userId !== session.user.id) {
    return authorizationFailure("This authorization has expired or belongs to another sign-in.");
  }

  const oauth = authorizationServer.getOAuthApi(oauthEnv);
  try {
    if (decision === "deny") {
      const denied = await oauth.denyConsent(request, handle);
      await oauthEnv.OAUTH_KV.delete(key);
      return authorizationRedirect(denied.redirectTo, denied.headers);
    }

    const approved = await oauth.approveConsent(request, handle, {
      scope: [...OAUTH_SCOPES],
      remember: form?.get("remember") === "yes" ? rememberConsent(session.user.id) : undefined,
    });
    await oauthEnv.OAUTH_KV.delete(key);
    return await completeAuthorization(
      approved.request,
      session.user.id,
      binding.clientName,
      approved.headers,
    );
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationFailure(error.description);
    if (error instanceof CimdFetchError) {
      return authorizationFailure("The client’s metadata could not be verified.");
    }
    throw error;
  }
}
