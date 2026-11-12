// Deploys the MCP Worker with only the secret it uses. `cf deploy --secrets-file`
// uploads every key in the file, so passing the shared secrets.env would copy
// the web Worker's credentials onto the MCP Worker.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

const KEY = "INTROSPECT_SECRET";
const root = resolve(import.meta.dirname, "..");

function fail(message) {
  console.error(`deploy:mcp: ${message}`);
  process.exit(1);
}

// Pass the raw line so cf parses it exactly as it parses secrets.env for the
// web Worker, then make sure that line alone yields the same value.
const text = readFileSync(join(root, "secrets.env"), "utf8");
const lines = text.split(/\r?\n/).filter((line) => line.startsWith(`${KEY}=`));
const value = parseEnv(text)[KEY];
if (value !== parseEnv(lines.join("\n"))[KEY]) {
  fail(`write ${KEY} in secrets.env as one ${KEY}=value line (no export, leading spaces or multiline quotes).`);
}
// cf expands `$NAME` from other keys, which the MCP file does not include.
if (value !== undefined && /(?<!\\)\$(?:[A-Za-z_]|\{)/.test(lines.at(-1))) {
  fail(`${KEY} must be a literal value without $NAME references.`);
}

const args = ["--filter", "mcp", "exec", "cf", "deploy"];
// Let cf handle Ctrl+C so the temporary secret is still removed below.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});
let dir;
try {
  if (value === undefined) {
    console.log(`deploy:mcp: ${KEY} is not in secrets.env; the MCP Worker keeps its deployed value.`);
  } else {
    dir = mkdtempSync(join(tmpdir(), "taskshq-mcp-"));
    const file = join(dir, "secrets.env");
    writeFileSync(file, `${lines.at(-1)}\n`, { mode: 0o600 });
    args.push("--secrets-file", file);
  }
  // Reuse the pnpm that runs this script (pnpm.cmd on Windows cannot be spawned directly).
  const [command, commandArgs] = process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath, ...args]]
    : ["pnpm", args];
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit" });
  if (result.error) console.error(`deploy:mcp: could not run pnpm: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
