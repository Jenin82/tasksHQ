# AGENTS.md

Instructions for AI coding agents. Two tasks are covered: deploying TasksHQ to a user's Cloudflare account, and working on the code.

## Deploying TasksHQ to the user's Cloudflare account

Follow these steps in order. Run commands from the repository root unless a step says otherwise. Do not skip verification.

**Never commit `deploy.env` or `secrets.env`.** Both are gitignored. Do not print secret values back to the user, paste them into chat, or write them anywhere except `secrets.env`.

### 1. Ask the user for inputs

Ask for all of these before running anything that changes their account:

1. **Cloudflare account.** They must be able to sign in to it in a browser (step 3). Confirm R2 is enabled on the account; enabling it requires a payment method, even on the free tier.
2. **URLs.** Custom domains or workers.dev?
   - Custom domains: two hostnames on a zone in their Cloudflare account, for example `taskshq.example.com` and `taskshq-mcp.example.com`.
   - workers.dev: their account's workers.dev subdomain. The `cf` CLI (1.0.0-beta.27) has no command to look it up or register it, so ask the user to read it from the Cloudflare dashboard under **Workers & Pages** (an account that has never used Workers registers one there first). The URLs become `https://taskshq-web.<subdomain>.workers.dev` and `https://taskshq-mcp.<subdomain>.workers.dev`.
3. **Google OAuth client ID and secret** (Google Cloud console, OAuth 2.0 Client ID, type "Web application"). These are required by the deploy. If they do not have one yet, tell them to create it; they register the redirect URI in step 6.
4. **SMTP settings** (optional, enables email sign-in and notifications): host, `tls` or `starttls`, port (optional), username, password, sender address.
5. **Signup allowlist** (optional): comma-separated exact addresses and `*@domain` entries. Empty means open signup.

Removing a line from `secrets.env` does not remove a deployed secret. To turn email or the allowlist off on an existing deployment, delete each secret from the web Worker, for example `pnpm --filter web exec cf workers secrets delete SMTP_HOST --worker taskshq-web` (use the `TASKSHQ_WEB_WORKER` name). Confirm with the user first.

Also confirm whether this is a new deployment or an upgrade of an existing one. For an upgrade, skip to "Upgrading" below.

### 2. Check the toolchain

```sh
node --version   # must be v24 or later
pnpm --version   # must be 10.25.0
pnpm install --frozen-lockfile
```

The `cf` CLI is a dev dependency. Run it as `pnpm --filter web exec cf …` from the root, or `pnpm exec cf …` inside `apps/web`. Use `cf`, not wrangler.

### 3. Sign in to Cloudflare

```sh
pnpm --filter web exec cf auth login
```

This opens a browser. The user completes sign-in; you do not handle their Cloudflare credentials. Check the result with `pnpm --filter web exec cf auth whoami`.

**Choose the account.** If the login can reach several accounts, cf prompts on the first command that needs one, then remembers the choice for this checkout. To pick it explicitly, ask the user for the account ID and prefix every `cf` and `pnpm run` command with `CLOUDFLARE_ACCOUNT_ID=<id>` (or `export` it for the session). To keep logins apart, `cf auth create <name>` creates a named profile and `cf auth activate <name>` binds it to the repository directory.

**Interactive prompts.** cf may stop to ask a question, for example to pick an account, or to confirm taking over a custom domain hostname that already has DNS records or another Worker attached. Do not answer a domain prompt yourself: show it to the user and let them decide.

### 4. Create the D1 database

```sh
pnpm --filter web exec cf d1 create --name taskshq-db
```

Record the database ID from the output. If a database with that name already exists, ask the user whether to reuse it before continuing.

### 5. Create `deploy.env` and `secrets.env`

```sh
cp deploy.env.example deploy.env
cp secrets.env.example secrets.env
```

`deploy.env` (not secret):

| Key | Value |
| --- | --- |
| `TASKSHQ_WEB_URL` | `https://<web host>`, no trailing slash |
| `TASKSHQ_MCP_URL` | `https://<mcp host>`, no trailing slash |
| `TASKSHQ_WEB_DOMAIN`, `TASKSHQ_MCP_DOMAIN` | The hostnames, only for custom domains; otherwise empty |
| `TASKSHQ_D1_ID` | The ID from step 4 |
| `TASKSHQ_KV_ID` | Empty for a new deployment |
| Name overrides | Leave the defaults unless the user asks |

`secrets.env` (literal values; the file expands `$NAME`, so escape a literal `$` as `\$`):

| Key | Value |
| --- | --- |
| `BETTER_AUTH_SECRET` | Generate: `openssl rand -base64 32` |
| `CONSENT_SECRET` | Generate separately: `openssl rand -base64 32` |
| `INTROSPECT_SECRET` | Generate separately: `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Exactly `TASKSHQ_WEB_URL` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From the user |
| `SMTP_*` | From the user (uncomment the lines), or leave commented out |
| `SIGNUP_EMAIL_ALLOWLIST` | From the user (uncomment the line), or leave commented out |

`secrets.env.example` lists the required keys uncommented with empty values and the optional ones commented out. Fill in every uncommented line or delete it, and uncomment optional lines only when the user gave a value: `scripts/check-deploy.mjs` rejects any empty `KEY=`, because cf would upload it as an empty secret and overwrite the live value. Quote a value that contains `#`.

Generate the three random secrets yourself and append them without echoing them, after deleting the empty lines for those keys. Each must be different. The first `printf` makes sure the appended lines start on a new line:

```sh
printf '\n' >> secrets.env
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> secrets.env
printf 'CONSENT_SECRET=%s\n' "$(openssl rand -base64 32)" >> secrets.env
printf 'INTROSPECT_SECRET=%s\n' "$(openssl rand -base64 32)" >> secrets.env
```

Check that both files are ignored; this must exit 0:

```sh
git check-ignore -q deploy.env secrets.env
```

Then run `node scripts/check-deploy.mjs` and fix anything it reports.

### 6. Tell the user to register the Google redirect URI

They must add this authorized redirect URI to their Google OAuth client:

```
<TASKSHQ_WEB_URL>/api/auth/callback/google
```

Sign-in fails with `redirect_uri_mismatch` until they do. Continue with the next steps while they do it.

### 7. Apply migrations

```sh
pnpm run db:migrate:remote
```

All migrations in `apps/web/drizzle` should report as applied.

### 8. Deploy

Before the first deploy, build the web Worker and check its bindings without uploading anything:

```sh
pnpm --filter web build
```

Read `apps/web/.cloudflare/output/v0/workers/default/worker.config.json`. Check `name`, `domains` (present only for custom domains), the D1 `name` and `id`, the R2 bucket name, and that `MCP_RESOURCE` is `<TASKSHQ_MCP_URL>/mcp`. The `secret` entries list the keys the deploy will upload; do not print `secrets.env`.

```sh
pnpm run deploy
```

This deploys the web Worker, then the MCP Worker (the MCP Worker has a service binding to the web Worker, so the order matters). The first deploy creates the R2 bucket and the KV namespace if missing. Use `pnpm run deploy`, never `pnpm deploy` (a built-in pnpm command).

Each deploy uploads every key listed in `secrets.env`, overwriting the deployed value. Keys left out keep their current value on an existing Worker, but a new Worker needs every required key; if cf reports missing required secrets, add them and rerun. If `deploy:mcp` fails after `deploy:web` succeeded, fix the cause and rerun only `pnpm run deploy:mcp`.

After the first deploy, record the OAuth KV namespace cf created so later deploys reuse it. List the namespaces with `pnpm --filter web exec cf kv namespaces list`, find the one created for `OAUTH_KV` by the web Worker, and set its `id` as `TASKSHQ_KV_ID` in `deploy.env`.

### 9. Verify

```sh
curl -sS <TASKSHQ_WEB_URL>/.well-known/oauth-authorization-server
curl -sS <TASKSHQ_MCP_URL>/.well-known/oauth-protected-resource/mcp
```

Expect JSON from both. The first has `"issuer": "<TASKSHQ_WEB_URL>"`. The second has `"resource": "<TASKSHQ_MCP_URL>/mcp"`. A 404 from the MCP URL means `TASKSHQ_MCP_URL` does not match the origin being called; fix `deploy.env` and redeploy both Workers.

Custom domains can take a few minutes to issue certificates after the first deploy. Retry before changing anything.

### 10. Report to the user

Tell the user:

- The web app URL (`TASKSHQ_WEB_URL`). They should open it, sign in, and create an organization.
- The MCP server URL: `<TASKSHQ_MCP_URL>/mcp`. Claude Code: `claude mcp add --transport http --scope user taskshq <TASKSHQ_MCP_URL>/mcp`. Other clients: `<TASKSHQ_WEB_URL>/docs/mcp`.
- Manual steps still outstanding: registering the Google redirect URI (step 6), enabling R2 billing if a deploy reported R2 as unavailable, and configuring sender-domain authentication with their SMTP provider if they use email.
- That `deploy.env` and `secrets.env` hold their configuration and secrets, are gitignored, and must not be committed or shared.

### Upgrading

With `deploy.env` and `secrets.env` already in place:

```sh
git pull
pnpm install --frozen-lockfile
pnpm run db:migrate:remote
pnpm run deploy
```

Always apply migrations before deploying either Worker. Then repeat step 9.

Deployments created before the TasksHQ rename used `tasks-web`, `tasks-mcp`, `tasks-db` and `tasks-images`. If the user has one, set `TASKSHQ_WEB_WORKER`, `TASKSHQ_MCP_WORKER`, `TASKSHQ_D1_NAME`, `TASKSHQ_R2_BUCKET`, `TASKSHQ_D1_ID` and `TASKSHQ_KV_ID` to the existing names and IDs, so the deploy reuses their data instead of creating new resources. Ask the user for these values; do not guess.

## Working on the code

Read [CLAUDE.md](CLAUDE.md) for repository conventions and [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and the pull request process. In short: every mutation goes through a `packages/core/src/domain` function, schema changes ship as new Drizzle migrations, and typecheck, tests and build must pass before a change is done.
