import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

const styles = `
  :root { color-scheme: light dark; --canvas: #fff; --card: #fafafa;
    --ink: #0a0a0a; --muted: #626262; --line: #0002; --blue: #0063e1; }
  @media (prefers-color-scheme: dark) {
    :root { --canvas: #000; --card: #0d0d0d; --ink: #fff; --muted: #9c9c9c; --line: #fff2; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: clamp(20px, 7vw, 72px); background: var(--canvas);
    color: var(--ink); font: 16px/1.55 system-ui, sans-serif; }
  main { max-width: 520px; margin: 4vh auto; padding: clamp(20px, 5vw, 36px);
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    overflow-wrap: anywhere; }
  h1 { font-size: 24px; line-height: 1.2; letter-spacing: -.025em; font-weight: 500; }
  .eyebrow, dt { color: var(--muted); font: 12px ui-monospace, monospace;
    letter-spacing: .035em; text-transform: uppercase; }
  .muted { color: var(--muted); }
  dl { border-block: 1px solid var(--line); padding: 12px 0; }
  dd { margin: 0 0 10px; } dd:last-child { margin: 0; }
  form { margin-top: 24px; }
  .buttons { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
  button { padding: 8px 18px; border: 1px solid var(--line); border-radius: 999px;
    background: transparent; color: var(--ink); cursor: pointer; font: inherit; }
  button.primary { background: var(--blue); color: white; border-color: var(--blue); }
  a { color: var(--ink); }
  :focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
`;

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function authorizationPage(
  title: string,
  content: string,
  headers = new Headers(),
  status = 200,
): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  // Same-origin form submissions need their Origin header for CSRF checks.
  // Cross-origin navigations still receive no referrer.
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  );
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · TasksHQ</title><style>${styles}</style></head>
<body><main><p class="eyebrow">TasksHQ · MCP connection</p><h1>${escape(title)}</h1>
${content}</main></body></html>`,
    { status, headers },
  );
}

export function authorizationFailure(message: string, status = 400): Response {
  return authorizationPage(
    "Couldn’t connect to TasksHQ",
    `<p>${escape(message)}</p><p class="muted">Start the connection again from your MCP client.</p>`,
    new Headers(),
    status,
  );
}

export function signInPage(nonce: string, headers: Headers, emailEnabled = false): Response {
  return authorizationPage(
    "Sign in to TasksHQ",
    `<p class="muted">Sign in to review this connection.</p>
<form action="/authorize/sign-in" method="post">
<input type="hidden" name="nonce" value="${escape(nonce)}">
<button type="submit" class="primary">Continue with Google</button></form>
${emailEnabled ? `<p><a href="/login?nonce=${encodeURIComponent(nonce)}">Continue with email</a></p>` : ""}`,
    headers,
  );
}

export function consentPage(
  details: ConsentDescription,
  accountEmail: string,
  handle: string,
  headers: Headers,
): Response {
  const attribution = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "This client registered itself. Its name is self-reported.";
  const warning = details.redirectIsLoopback
    ? "<p><strong>The redirect goes to an app on this device.</strong> Continue only if you started this connection.</p>"
    : "";
  return authorizationPage(
    `Connect ${details.clientName} to TasksHQ?`,
    `<p class="muted">${attribution}</p>
<dl><dt>Signed in as</dt><dd>${escape(accountEmail)}</dd>
<dt>Redirect destination</dt><dd>${escape(details.redirectHost)}</dd></dl>
${warning}
<p>This client can list projects, read tasks and their history, create or edit tasks, post comments, and archive tasks within your account’s access.</p>
<form action="/authorize" method="post">
<input type="hidden" name="handle" value="${escape(handle)}">
<label><input type="checkbox" name="remember" value="yes"> Remember this approval for 30 days</label>
<div class="buttons">
<button type="submit" name="decision" value="approve" class="primary">Allow</button>
<button type="submit" name="decision" value="deny">Deny</button>
</div></form>`,
    headers,
  );
}
