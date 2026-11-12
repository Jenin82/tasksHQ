// Writes deploy.env and secrets.env at the repo root from environment
// variables, for the GitHub Actions deploy workflow. Prints key names only.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SETTINGS = ["TASKSHQ_WEB_URL", "TASKSHQ_MCP_URL", "TASKSHQ_WEB_DOMAIN", "TASKSHQ_MCP_DOMAIN", "TASKSHQ_D1_ID", "TASKSHQ_KV_ID", "TASKSHQ_WEB_WORKER", "TASKSHQ_MCP_WORKER", "TASKSHQ_D1_NAME", "TASKSHQ_R2_BUCKET"];
const SECRETS = ["BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CONSENT_SECRET", "INTROSPECT_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_TLS", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "SIGNUP_EMAIL_ALLOWLIST"];

function fail(message) {
  console.error(`write-deploy-env: ${message}`);
  process.exit(1);
}

// deploy.env is sourced by the shell and read by process.loadEnvFile, so keep it plain.
const settings = SETTINGS.map((key) => {
  const value = process.env[key] ?? "";
  if (!/^[A-Za-z0-9._:/-]*$/.test(value)) fail(`${key} may only contain letters, digits and . _ : / -`);
  return `${key}=${value}`;
});

// cf parses secrets.env with dotenv and dotenv-expand: escape `$`, and use single
// quotes or backticks, which keep every other character literal on one line.
// A trailing `\` would escape the closing quote.
function quote(key, value) {
  if (/[\r\n]/.test(value) || value.endsWith("\\")) fail(`${key} must be one line and must not end with \\`);
  const escaped = value.replaceAll("$", "\\$");
  if (!value.includes("'")) return `'${escaped}'`;
  if (!value.includes("`")) return `\`${escaped}\``;
  fail(`${key} must not contain both ' and \``);
}

const secrets = { BETTER_AUTH_URL: (process.env.TASKSHQ_WEB_URL ?? "").replace(/\/+$/, "") };
for (const key of SECRETS) {
  const value = process.env[key] ?? "";
  if (value && !value.trim()) fail(`${key} is only whitespace. Set a value or delete the secret.`);
  if (value) secrets[key] = value;
}
const lines = Object.entries(secrets).map(([key, value]) => `${key}=${quote(key, value)}`);

writeFileSync(resolve(root, "deploy.env"), `${settings.join("\n")}\n`, { mode: 0o600 });
writeFileSync(resolve(root, "secrets.env"), `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`deploy.env: ${SETTINGS.join(", ")}\nsecrets.env: ${Object.keys(secrets).join(", ")}`);
