import { env } from "cloudflare:workers";
import { getSessionCookie } from "better-auth/cookies";
import { AccessError, requireProjectMember } from "@tasks/core/access";
import { db } from "@/lib/db";
import { getUser } from "@/lib/session";
import { taskPreviewPath, taskPreviewSize } from "@/lib/task-preview";
import {
  findCanonicalTaskShareCode, hasSharedTaskImage, sharedPreviewHeaders, shortTaskSharePath, type SharedTaskLocation,
} from "@/lib/task-share";
import { parseCanonicalTaskPath, taskSignInUrl } from "@/lib/task-sign-in";

export async function renderCanonicalTaskShare(request: Request): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const route = parseCanonicalTaskPath(url.pathname);
  if (!route || request.headers.has("rsc") || request.headers.get("accept")?.includes("text/x-component")) return null;

  // Let the app validate potential sessions and enforce task access as usual.
  if (getSessionCookie(request)) return null;

  const code = await findCanonicalTaskShareCode(route);
  if (!code) return null;
  const path = taskPreviewPath(route);
  return renderSharedPreview(path, shortTaskSharePath(code, true), path, request.method === "HEAD");
}

export async function renderTaskShare(
  location: SharedTaskLocation,
  sharePath: string,
  imagePath: string,
  signInDestination = sharePath,
) {
  const taskPath = taskPreviewPath(location.route);
  const viewer = await getUser();
  if (viewer) {
    try {
      await requireProjectMember(db, location.projectId, viewer.id);
    } catch (error) {
      if (error instanceof AccessError && error.reason === "not_a_member") {
        return new Response("This work item is unavailable.", { status: 404, headers: sharedPreviewHeaders });
      }
      throw error;
    }
    return new Response(null, { status: 303, headers: { ...sharedPreviewHeaders, Location: taskPath } });
  }

  return renderSharedPreview(sharePath, await hasSharedTaskImage(location) ? imagePath : null, signInDestination);
}

function renderSharedPreview(sharePath: string, imagePath: string | null, signInDestination: string, head = false) {
  const taskUrl = taskSignInUrl(signInDestination);
  const shareUrl = new URL(sharePath, env.BETTER_AUTH_URL).href.replaceAll("&", "&amp;");
  const imageUrl = imagePath && new URL(imagePath, env.BETTER_AUTH_URL).href.replaceAll("&", "&amp;");

  return new Response(head ? null : `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shared work item | TasksHQ</title>
  ${imageUrl ? `<meta property="og:type" content="website">
  <meta property="og:site_name" content="TasksHQ">
  <meta property="og:title" content="Shared work item">
  <meta property="og:url" content="${shareUrl}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${taskPreviewSize.width}">
  <meta property="og:image:height" content="${taskPreviewSize.height}">
  <meta property="og:image:alt" content="Work item card">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Shared work item">
  <meta name="twitter:image" content="${imageUrl}">` : ""}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #000; color: #fff; }
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
    main { width: min(100%, 480px); box-sizing: border-box; background: #0d0d0d; border: 1px solid #292929; border-radius: 16px; padding: 32px; }
    h1 { margin: 12px 0; font-size: clamp(24px, 5vw, 32px); line-height: 1.15; font-weight: 400; }
    h1, p { overflow-wrap: anywhere; }
    p { margin: 0; color: #a3a3a3; line-height: 1.5; }
    a { display: inline-block; margin-top: 24px; border-radius: 999px; background: #0063e1; color: #fff; padding: 9px 16px; text-decoration: none; }
    a:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  </style>
</head>
<body>
  <main>
    <h1>Shared work item</h1>
    <p>Sign in to open this work item.</p>
    <a href="${taskUrl}">Open in TasksHQ</a>
  </main>
</body>
</html>`, {
    headers: {
      ...sharedPreviewHeaders,
      Vary: "Cookie",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    },
  });
}
