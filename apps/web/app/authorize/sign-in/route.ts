import { auth } from "@/lib/auth";
import { authorizationFailure } from "@/lib/mcp-consent";
import { AUTH_ISSUER } from "@/lib/mcp-oauth";
import { authorizationForm, authorizationRedirect, findSignIn } from "../flow";

export async function POST(request: Request): Promise<Response> {
  const form = await authorizationForm(request);
  const transaction = await findSignIn(request, form?.get("nonce") ?? null);
  if (!transaction) return authorizationFailure("This sign-in request has expired or is invalid.");

  const callback = new URL("/authorize/resume", AUTH_ISSUER);
  callback.searchParams.set("nonce", transaction.nonce);
  const headers = new Headers({ "Content-Type": "application/json", Origin: AUTH_ISSUER });
  const cookies = request.headers.get("Cookie");
  if (cookies) headers.set("Cookie", cookies);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("CF-Connecting-IP", clientIp);
  const response = await auth.handler(
    new Request(new URL("/api/auth/sign-in/social", AUTH_ISSUER), {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: "google", callbackURL: callback.href }),
    }),
  );
  const location = response.headers.get("Location");
  if (!response.ok || !location || new URL(location).origin !== "https://accounts.google.com") {
    return authorizationFailure("Google sign-in could not start.", 502);
  }
  const redirectHeaders = new Headers();
  for (const cookie of response.headers.getSetCookie()) {
    redirectHeaders.append("Set-Cookie", cookie);
  }
  return authorizationRedirect(location, redirectHeaders);
}
