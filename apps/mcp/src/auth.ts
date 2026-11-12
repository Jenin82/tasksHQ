import type { OAuthResourceTokenValidator } from "@cloudflare/workers-oauth-provider";
import { INTROSPECT_SECRET_HEADER, INTROSPECT_URL } from "./config";

/** PLAN §5.5: what apps/web records on the grant at consent time. */
export type Props = { userId: string; clientId: string; clientName: string; emailNotifications?: boolean };

/**
 * PLAN §1/§5.6: only the authorization server can validate a token, so ask
 * it. apps/web's `/internal/introspect` answers with the result of
 * `authorizationServer.validateToken(resource, token, env)` verbatim — the
 * object, or `null` for a token that is not valid. The web Worker adds its
 * current email enablement to valid grants for the lifetime of this request.
 *
 * `null` passes straight through (the host answers 401). Anything else that is
 * not a well-formed answer throws, which the host turns into a 503: a refused
 * secret or a malformed grant is a deployment fault, not a bad token, and must
 * not look like one to the client.
 */
export const introspect =
  (env: Env): OAuthResourceTokenValidator<Props> =>
  async (resource, token) => {
    const response = await env.AUTH_SERVER.fetch(INTROSPECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTROSPECT_SECRET_HEADER]: env.INTROSPECT_SECRET,
      },
      body: JSON.stringify({ resource, token }),
    });
    if (!response.ok) {
      throw new Error(`Introspection failed with HTTP ${response.status}.`);
    }

    const result = (await response.json()) as {
      props?: Partial<Props>;
    } | null;
    if (result === null) return null;

    const props = result.props;
    if (
      typeof props?.userId !== "string" ||
      typeof props.clientId !== "string" ||
      typeof props.clientName !== "string"
    ) {
      throw new Error("Introspection returned a grant without §5.5's props.");
    }
    return result as Awaited<ReturnType<OAuthResourceTokenValidator<Props>>>;
  };
