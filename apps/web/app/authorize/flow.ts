import { auth } from "@/lib/auth";
import { AUTH_ISSUER, oauthEnv } from "@/lib/mcp-oauth";

export const authorizationTtl = 10 * 60;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const formLimit = 1024;

export function getAuthorizationSession(request: Request) {
  return auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
}

// Only our two native forms post to these routes. Bound the body before
// decoding so a forged form cannot buffer an arbitrary request in the Worker.
export async function authorizationForm(request: Request) {
  if (
    new URL(request.url).origin !== AUTH_ISSUER ||
    request.headers.get("Origin") !== AUTH_ISSUER ||
    request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded" ||
    !request.body
  ) {
    return null;
  }
  const body = new Uint8Array(formLimit);
  let length = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > formLimit) {
        await reader.cancel();
        return null;
      }
      body.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return new URLSearchParams(new TextDecoder().decode(body.subarray(0, length)));
}

export async function authorizationKey(namespace: "login" | "consent-session", value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `tasks:${namespace}:${hash}`;
}

function resumeCookieName(nonce: string) {
  return `__Host-tasks-mcp-resume-${nonce}`;
}

function resumeCookie(nonce: string, browser: string, maxAge: number) {
  return `${resumeCookieName(nonce)}=${browser}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export async function beginSignIn(url: URL) {
  const nonce = crypto.randomUUID();
  const browser = crypto.randomUUID();
  await oauthEnv.OAUTH_KV.put(
    await authorizationKey("login", `${nonce}:${browser}`),
    url.pathname + url.search,
    { expirationTtl: authorizationTtl },
  );
  return {
    nonce,
    headers: new Headers({ "Set-Cookie": resumeCookie(nonce, browser, authorizationTtl) }),
  };
}

export async function findSignIn(request: Request, nonce: string | null) {
  if (!nonce || !uuid.test(nonce)) return null;
  const prefix = `${resumeCookieName(nonce)}=`;
  const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  const browser = cookie?.slice(prefix.length);
  if (!browser || !uuid.test(browser)) return null;

  const key = await authorizationKey("login", `${nonce}:${browser}`);
  const path = await oauthEnv.OAUTH_KV.get(key);
  if (!path) return null;
  const url = new URL(path, AUTH_ISSUER);
  if (url.origin !== AUTH_ISSUER || url.pathname !== "/authorize") return null;

  return { nonce, key, url, clearCookie: resumeCookie(nonce, "", 0) };
}

export function authorizationRedirect(location: string, headers = new Headers()) {
  headers.set("Location", location);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(null, { status: 303, headers });
}
