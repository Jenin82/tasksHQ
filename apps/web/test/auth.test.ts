import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { GET, POST } from "@/app/api/auth/[...all]/route";

async function columns(table: string) {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{
    name: string;
  }>();
  return results.map((c) => c.name).sort();
}

it("created the four Better Auth tables with the generated columns", async () => {
  expect(await columns("user")).toEqual([
    "created_at",
    "email",
    "email_verified",
    "id",
    "image",
    "name",
    "updated_at",
  ]);
  expect(await columns("session")).toEqual([
    "created_at",
    "expires_at",
    "id",
    "ip_address",
    "token",
    "updated_at",
    "user_agent",
    "user_id",
  ]);
  expect(await columns("account")).toEqual([
    "access_token",
    "access_token_expires_at",
    "account_id",
    "created_at",
    "id",
    "id_token",
    "password",
    "provider_id",
    "refresh_token",
    "refresh_token_expires_at",
    "scope",
    "updated_at",
    "user_id",
  ]);
  expect(await columns("verification")).toEqual([
    "created_at",
    "expires_at",
    "id",
    "identifier",
    "updated_at",
    "value",
  ]);
});

it("mounts the handler: a real endpoint answers and an unknown one 404s", async () => {
  const ok = await GET(new Request("http://localhost:5173/api/auth/ok"));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: true });

  const missing = await GET(
    new Request("http://localhost:5173/api/auth/does-not-exist"),
  );
  expect(missing.status).toBe(404);
});

it("starts a Google sign-in against baseURL and persists its state to D1", async () => {
  const res = await POST(
    new Request("http://localhost:5173/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    }),
  );
  expect(res.status).toBe(200);

  const { url } = await res.json<{ url: string }>();
  const authorize = new URL(url);
  expect(authorize.origin + authorize.pathname).toBe(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  // Proves baseURL is what the callback is built from, rather than a default.
  expect(authorize.searchParams.get("redirect_uri")).toBe(
    "http://localhost:5173/api/auth/callback/google",
  );

  const state = authorize.searchParams.get("state");
  const row = await env.DB.prepare(
    "SELECT id FROM verification WHERE identifier = ?",
  )
    .bind(`auth-state:${state}`)
    .first();
  expect(row).not.toBeNull();
});
