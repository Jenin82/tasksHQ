import { createHash, createHmac } from "node:crypto";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { session, user, verification } from "@tasks/core/schema";
import { GET as discover } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as authorize, POST as decide } from "@/app/authorize/route";
import { GET as resume } from "@/app/authorize/resume/route";
import { POST as startSignIn } from "@/app/authorize/sign-in/route";
import { POST as introspect } from "@/app/internal/introspect/route";
import { POST as register } from "@/app/oauth/register/route";
import { POST as token } from "@/app/oauth/token/route";
import { auth } from "@/lib/auth";
import { AUTH_ISSUER, MCP_RESOURCE } from "@/lib/mcp-oauth";

const callback = "http://127.0.0.1:32123/callback";
const verifier = "test-verifier-for-tasks-mcp-abcdefghijklmnopqrstuvwxyz";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const db = drizzle(env.DB);

async function seedUser() {
  const id = `oauth-${crypto.randomUUID()}`;
  const email = `${id}@example.test`;
  const now = new Date();
  await db.insert(user).values({ id, email, name: "OAuth test user", createdAt: now, updatedAt: now });
  return { id, email };
}

async function signIn(userId: string) {
  const context = await auth.$context;
  const value = crypto.randomUUID();
  const now = new Date();
  await db.insert(session).values({
    id: crypto.randomUUID(),
    token: value,
    userId,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  // Sign a real Better Auth session for the fixture, skipping only Google's callback.
  const signature = createHmac("sha256", context.secret).update(value).digest("base64");
  return `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${value}.${signature}`)}`;
}

function jsonPost(path: string, body: unknown, headers?: HeadersInit) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Content-Type", "application/json");
  return new Request(new URL(path, AUTH_ISSUER), {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

function formPost(path: string, fields: Record<string, string>, cookie = "", origin = AUTH_ISSUER) {
  return new Request(new URL(path, AUTH_ISSUER), {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie },
    body: new URLSearchParams(fields),
  });
}

async function createClient(clientName = "TasksHQ OAuth test client") {
  const response = await register(jsonPost("/oauth/register", {
    client_name: clientName,
    redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }));
  expect(response.status).toBe(201);
  const info = await response.json<{ client_id: string }>();
  expect(info).toMatchObject({
    client_id: expect.any(String),
    redirect_uris: [callback],
    token_endpoint_auth_method: "none",
  });
  expect(info).not.toHaveProperty("client_secret");
  return info.client_id;
}

function authUrl(clientId: string, state = "fixture-state", resource = MCP_RESOURCE) {
  const url = new URL("/authorize", AUTH_ISSUER);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callback,
    resource,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}

function cookies(response: Response) {
  return response.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
}

function hiddenField(html: string, name: "nonce" | "handle") {
  const value = html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
  if (!value) throw new Error(`Missing ${name} in authorization form`);
  return value;
}

function location(response: Response) {
  expect(response.status).toBe(303);
  const target = response.headers.get("Location");
  if (!target) throw new Error("Missing authorization redirect location");
  return new URL(target, AUTH_ISSUER);
}

async function consent(url: URL, sessionCookie: string) {
  const response = await authorize(new Request(url, { headers: { Cookie: sessionCookie } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("Set-Cookie")).toMatch(/Secure;.*HttpOnly|HttpOnly;.*Secure/i);
  const html = await response.text();
  return { handle: hiddenField(html, "handle"), cookie: cookies(response), html };
}

it("discovers authorization endpoints and requires S256 PKCE for a registered public client", async () => {
  expect(AUTH_ISSUER).toBe("http://localhost:5173");
  const metadata = await discover(new Request(`${AUTH_ISSUER}/.well-known/oauth-authorization-server`));
  expect(metadata.status).toBe(200);
  expect(await metadata.json()).toMatchObject({
    issuer: AUTH_ISSUER,
    authorization_endpoint: `${AUTH_ISSUER}/authorize`,
    token_endpoint: `${AUTH_ISSUER}/oauth/token`,
    registration_endpoint: `${AUTH_ISSUER}/oauth/register`,
    code_challenge_methods_supported: ["S256"],
  });

  const clientId = await createClient();
  const url = authUrl(clientId);
  url.searchParams.delete("code_challenge");
  url.searchParams.delete("code_challenge_method");
  const invalid = location(await authorize(new Request(url)));
  expect(invalid.origin + invalid.pathname).toBe(callback);
  expect(invalid.searchParams.get("error")).toBe("invalid_request");
  expect(invalid.searchParams.get("state")).toBe("fixture-state");

  // No client error may redirect to an unregistered callback.
  url.searchParams.set("redirect_uri", "https://unregistered.example.test/callback");
  const unregistered = await authorize(new Request(url));
  expect(unregistered.status).toBe(400);
  expect(unregistered.headers.get("Location")).toBeNull();

  const wrongAudience = location(await authorize(new Request(authUrl(
    clientId, "wrong-audience", "https://unregistered.example.test/mcp",
  ))));
  expect(wrongAudience.searchParams.get("error")).toBe("invalid_target");
});

it("resumes the signed-out authorization only in the initiating browser after sign-in", async () => {
  const clientId = await createClient();
  const url = authUrl(clientId, "private-client-state");
  const initial = await authorize(new Request(url));
  expect(initial.status).toBe(200);
  const html = await initial.text();
  expect(html).toContain("Continue with Google");
  expect(html).not.toContain("Continue with email");
  expect(html).not.toContain("private-client-state");
  expect(html).not.toContain(clientId);
  const nonce = hiddenField(html, "nonce");
  const browserCookie = cookies(initial);
  expect(browserCookie).toContain(`__Host-tasks-mcp-resume-${nonce}=`);

  expect((await startSignIn(formPost("/authorize/sign-in", { nonce }))).status).toBe(400);
  const google = location(await startSignIn(formPost("/authorize/sign-in", { nonce }, browserCookie)));
  expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(google.searchParams.get("redirect_uri")).toBe(`${AUTH_ISSUER}/api/auth/callback/google`);
  expect(google.search).not.toContain("private-client-state");
  const [googleState] = await db.select({ value: verification.value }).from(verification)
    .where(eq(verification.identifier, `auth-state:${google.searchParams.get("state")}`));
  expect(JSON.parse(googleState.value).callbackURL).toBe(`${AUTH_ISSUER}/authorize/resume?nonce=${nonce}`);

  const actor = await seedUser();
  const sessionCookie = await signIn(actor.id);
  const resumeUrl = new URL(`/authorize/resume?nonce=${nonce}`, AUTH_ISSUER);
  const request = (cookie: string) => new Request(resumeUrl, { headers: { Cookie: cookie } });
  expect((await resume(request(browserCookie))).status).toBe(400);
  expect((await resume(request(sessionCookie))).status).toBe(400);

  const resumed = await resume(request(`${browserCookie}; ${sessionCookie}`));
  expect(location(resumed).href).toBe(url.href);
  expect(resumed.headers.get("Set-Cookie")).toContain("Max-Age=0");
  expect((await resume(request(`${browserCookie}; ${sessionCookie}`))).status).toBe(400);
  expect((await consent(url, sessionCookie)).html).toContain(actor.email);
});

it("binds consent to the browser and exact session, then exchanges one code for an audience-bound token", async () => {
  const clientName = "<b>Test client</b>";
  const clientId = await createClient(clientName);
  const actor = await seedUser();
  const sessionCookie = await signIn(actor.id);
  const otherSession = await signIn(actor.id);
  const url = authUrl(clientId);
  const form = await consent(url, sessionCookie);
  expect(form.html).toContain(actor.email);
  expect(form.html).not.toContain(clientName);
  expect(form.html).toContain("Test client");

  const approve = { handle: form.handle, decision: "approve" };
  const boundCookies = `${form.cookie}; ${sessionCookie}`;
  expect((await decide(formPost("/authorize", approve, sessionCookie))).status).toBe(400);
  expect((await decide(formPost("/authorize", approve, form.cookie))).status).toBe(400);
  expect((await decide(formPost("/authorize", approve, `${form.cookie}; ${otherSession}`))).status).toBe(400);
  expect((await decide(formPost("/authorize", approve, boundCookies, "https://foreign.example.test"))).status).toBe(400);

  const redirected = location(await decide(formPost("/authorize", approve, boundCookies)));
  expect(redirected.origin + redirected.pathname).toBe(callback);
  expect(redirected.searchParams.get("state")).toBe("fixture-state");
  expect(redirected.searchParams.get("iss")).toBe(AUTH_ISSUER);
  const code = redirected.searchParams.get("code");
  expect(code).toBeTruthy();
  expect((await decide(formPost("/authorize", approve, boundCookies))).status).toBe(400);

  const exchange = (overrides = {}) => token(formPost("/oauth/token", {
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: callback,
    code: code!,
    code_verifier: verifier,
    resource: MCP_RESOURCE,
    ...overrides,
  }));
  const wrongVerifier = await exchange({ code_verifier: "wrong-verifier" });
  expect(wrongVerifier.status).toBe(400);
  expect(await wrongVerifier.json()).toMatchObject({ error: "invalid_grant" });
  const wrongResource = await exchange({ resource: "https://unregistered.example.test/mcp" });
  expect(wrongResource.status).toBe(400);
  expect(await wrongResource.json()).toMatchObject({ error: "invalid_target" });

  const issued = await exchange();
  expect(issued.status).toBe(200);
  const grant = await issued.json<{ access_token: string; refresh_token: string }>();
  expect(grant).toMatchObject({ access_token: expect.any(String), token_type: "bearer" });

  const check = (secret = env.INTROSPECT_SECRET, resource = MCP_RESOURCE, accessToken = grant.access_token) =>
    introspect(jsonPost("/internal/introspect", { resource, token: accessToken }, { "X-Introspect-Secret": secret }));
  expect((await check("wrong secret")).status).toBe(403);
  expect((await check(env.INTROSPECT_SECRET, "https://unregistered.example.test/mcp")).status).toBe(400);
  expect(await (await check(env.INTROSPECT_SECRET, MCP_RESOURCE, "a".repeat(4097))).json()).toBeNull();
  const inactive = await check(env.INTROSPECT_SECRET, MCP_RESOURCE, `${grant.access_token}tampered`);
  expect(inactive.status).toBe(200);
  expect(await inactive.json()).toBeNull();
  const active = await check();
  expect(active.status).toBe(200);
  expect(active.headers.get("Cache-Control")).toBe("no-store");
  expect(await active.json()).toMatchObject({
    userId: actor.id,
    clientId,
    props: { userId: actor.id, clientId, clientName },
    audience: MCP_RESOURCE,
    expiresAt: expect.any(Number),
    scope: [],
  });

  // The provider invalidates tokens from a grant when its code is replayed.
  const replay = await exchange();
  expect(replay.status).toBe(400);
  expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
  const revoked = await check();
  expect(revoked.status).toBe(200);
  expect(await revoked.json()).toBeNull();
});

it("denies a consent form once and returns the client's state without a code", async () => {
  const clientId = await createClient();
  const actor = await seedUser();
  const sessionCookie = await signIn(actor.id);
  const form = await consent(authUrl(clientId, "denied-state"), sessionCookie);
  const request = (decision: string) => formPost("/authorize", {
    handle: form.handle,
    decision,
  }, `${form.cookie}; ${sessionCookie}`);

  const denied = location(await decide(request("deny")));
  expect(denied.origin + denied.pathname).toBe(callback);
  expect(denied.searchParams.get("error")).toBe("access_denied");
  expect(denied.searchParams.get("state")).toBe("denied-state");
  expect(denied.searchParams.get("iss")).toBe(AUTH_ISSUER);
  expect(denied.searchParams.get("code")).toBeNull();
  expect((await decide(request("approve"))).status).toBe(400);
});

it("remembers consent only for the approving user", async () => {
  const clientId = await createClient();
  const actor = await seedUser();
  const secondActor = await seedUser();
  const sessionCookie = await signIn(actor.id);
  const secondSession = await signIn(secondActor.id);
  const form = await consent(authUrl(clientId), sessionCookie);
  const approval = await decide(formPost("/authorize", {
    handle: form.handle,
    decision: "approve",
    remember: "yes",
  }, `${form.cookie}; ${sessionCookie}`));
  expect(location(approval).searchParams.has("code")).toBe(true);
  const remembered = cookies(approval);
  expect(remembered).toContain("approvals=");

  const url = authUrl(clientId, "remembered-state");
  const sameUser = await authorize(new Request(url, {
    headers: { Cookie: `${remembered}; ${sessionCookie}` },
  }));
  const redirected = location(sameUser);
  expect(redirected.searchParams.has("code")).toBe(true);
  expect(redirected.searchParams.get("state")).toBe("remembered-state");
  expect((await consent(url, `${remembered}; ${secondSession}`)).html).toContain(secondActor.email);
});
