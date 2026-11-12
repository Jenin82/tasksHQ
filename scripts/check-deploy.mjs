// Pre-deploy check for deploy.env and secrets.env at the repo root. Run by the
// root deploy:web, deploy:mcp and db:migrate:remote scripts before they touch
// the Cloudflare account.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const root = resolve(import.meta.dirname, "..");
const errors = [];

function load(file, hint) {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    errors.push(`${file} is missing. ${hint}`);
    return undefined;
  }
  const text = readFileSync(path, "utf8");
  // db:migrate:remote sources deploy.env in the shell, where CR ends up in values.
  if (file === "deploy.env" && text.includes("\r")) {
    errors.push("deploy.env has Windows (CRLF) line endings. Save it with LF line endings.");
  }
  return parseEnv(text);
}

function httpsOrigin(key, value, example) {
  if (!value) {
    errors.push(`deploy.env: ${key} is not set.`);
    return undefined;
  }
  let url;
  try {
    url = new URL(value);
  } catch {}
  if (url?.protocol !== "https:") {
    errors.push(`deploy.env: ${key} must be an https:// URL (got "${value}").`);
    return undefined;
  }
  // Canonical origin only: lowercase host, no default port, path, query or credentials.
  if (value.replace(/\/+$/, "") !== url.origin) {
    errors.push(`deploy.env: ${key} must be an origin only, e.g. ${example} (got "${value}").`);
    return undefined;
  }
  return url;
}

function matchingDomain(key, domain, url) {
  if (domain && url && domain.toLowerCase() !== url.hostname) {
    errors.push(`deploy.env: ${key} (${domain}) must be the hostname of its URL (${url.hostname}).`);
  }
}

const deploy = load("deploy.env", "Copy deploy.env.example to deploy.env and fill it in.");
let webOrigin;
if (deploy) {
  const webUrl = httpsOrigin("TASKSHQ_WEB_URL", deploy.TASKSHQ_WEB_URL, "https://taskshq.example.com");
  const mcpUrl = httpsOrigin("TASKSHQ_MCP_URL", deploy.TASKSHQ_MCP_URL, "https://mcp.example.com");
  webOrigin = webUrl?.origin;
  if (webOrigin && webOrigin === mcpUrl?.origin) {
    errors.push("deploy.env: TASKSHQ_WEB_URL and TASKSHQ_MCP_URL must be different origins.");
  }
  matchingDomain("TASKSHQ_WEB_DOMAIN", deploy.TASKSHQ_WEB_DOMAIN, webUrl);
  matchingDomain("TASKSHQ_MCP_DOMAIN", deploy.TASKSHQ_MCP_DOMAIN, mcpUrl);
  if (!deploy.TASKSHQ_D1_ID) errors.push("deploy.env: TASKSHQ_D1_ID is not set.");
}

const secrets = load("secrets.env", "Copy secrets.env.example to secrets.env and fill it in.");
if (secrets) {
  for (const [key, value] of Object.entries(secrets)) {
    // cf uploads `KEY=` as an empty secret, overwriting the live value.
    if (!value.trim()) {
      errors.push(`secrets.env: ${key} is empty. Set a value or delete the line to keep the deployed value.`);
      continue;
    }
    // cf expands unescaped `$NAME` / `${NAME}` anywhere in a value from other
    // keys and the environment; an unset name silently becomes empty.
    for (const [, bare, braced] of value.matchAll(/(?<!\\)\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/g)) {
      const name = bare ?? braced;
      if (!(name !== key && secrets[name]) && !process.env[name]) {
        errors.push(`secrets.env: ${key} contains $${name}, which is not set and would upload as empty. Write a literal $ as \\$.`);
      }
    }
  }
  const authUrl = secrets.BETTER_AUTH_URL?.trim().replace(/\/+$/, "");
  if (authUrl && webOrigin && authUrl !== webOrigin) {
    errors.push(`secrets.env: BETTER_AUTH_URL must equal TASKSHQ_WEB_URL (${webOrigin}).`);
  }
}

if (errors.length) {
  console.error(`Deploy check failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  process.exit(1);
}
