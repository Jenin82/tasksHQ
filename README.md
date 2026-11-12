<p align="center"><img src="apps/web/public/taskshq-logo.png" alt="TasksHQ" width="96"></p>

# TasksHQ

TasksHQ is an open-source project and task tracker for small teams and their AI assistants. Teams work from boards and tables in the web app, and MCP clients such as Claude and Codex work with the same tasks under the signed-in user's permissions. The activity history records who made each change and whether it came from the web or MCP. TasksHQ runs on Cloudflare Workers with D1, R2 and KV, and you host it on your own Cloudflare account.

Once deployed, the product guide is served at `<web origin>/docs` and MCP client setup at `<web origin>/docs/mcp`.

> **AI coding agents:** to deploy TasksHQ for a user, follow [AGENTS.md](AGENTS.md).

## Features

- Organize work into organizations and projects, and invite teammates.
- Track tasks on a board or in a table with custom statuses, colors, task types, due dates and priorities.
- Assign tasks, comment with `@` mentions, attach images to Markdown descriptions, and review the activity history.
- Sign in with Google or, when SMTP is configured, with a one-time code sent by email. Uploaded profile photos are converted to 96 × 96 WebP avatars.
- Post new work items and status changes to a Slack channel per project.
- Connect an MCP client to list projects, find tasks, create or update tasks, add comments, and archive tasks. Each tool call follows the signed-in user's project permissions.

### Email and signup policy

Email is optional. Set these values in `secrets.env` for a deployment, or in `apps/web/.dev.vars` for local development. Only the web Worker receives SMTP credentials; the MCP Worker gets the email feature state from the web Worker. Deleting a line from `secrets.env` does not remove a deployed secret; to turn email or the allowlist off, delete the secret from the web Worker:

```sh
pnpm --filter web exec cf workers secrets delete SMTP_HOST --worker taskshq-web
```

Use your `TASKSHQ_WEB_WORKER` name if you changed it, and repeat for each `SMTP_*` key or `SIGNUP_EMAIL_ALLOWLIST`.

| Variable | Value |
| --- | --- |
| `SMTP_HOST` | Your provider's SMTP hostname |
| `SMTP_TLS` | `tls` for implicit TLS or `starttls` for a required TLS upgrade |
| `SMTP_PORT` | Submission port. Defaults to `465` for `tls` and `587` for `starttls`. |
| `SMTP_USERNAME` and `SMTP_PASSWORD` | SMTP credentials |
| `SMTP_FROM` | Sender address authorized by the provider, such as `taskshq@example.com` |
| `SIGNUP_EMAIL_ALLOWLIST` | Optional comma-separated list of exact addresses and `*@domain` entries |

Use a provider that supports SMTP `AUTH PLAIN` or `AUTH LOGIN` over TLS, and configure sender-domain authentication with it before enabling email for users. If SMTP settings are missing or invalid, the app hides email sign-in and disables one-time codes and email notifications. Google sign-in and membership management remain available.

Signup is open by default. `SIGNUP_EMAIL_ALLOWLIST=*@example.com,someone@gmail.com` allows new accounts at `example.com` and the one Gmail address. Domain matches are exact and comparisons ignore case. The policy applies to Google and email signup. A valid pending organization invitation lets the invited address sign up even if it falls outside the allowlist. Existing accounts can always sign in.

New email users provide a name and verify their address with a one-time code. Organization invite emails link to the app home page; the recipient signs in with the invited address and TasksHQ claims the pending invite. Administrators can revoke pending invites under organization Members. Organization membership grants access to all projects in that organization. Project settings are available to organization owners and admins and to admins of that project.

TasksHQ emails a new assignee when someone else assigns them work. For title, description or status changes, it emails the task creator when someone else made the change and the creator is not the assignee, and it emails the assignee's direct lead. It skips the person who made the change and groups edits per task and recipient in five-minute batches. Each person mentioned in a comment receives one email with the comment and a link to the work item. Delivery runs on the web Worker's scheduled trigger.

### Slack project log

Project admins can open **Project settings → Integrations → Slack** and save an [incoming webhook](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/) for a channel. **Send test message** queues a test. TasksHQ posts new work items and status changes from the web app and MCP, with the title, the person who made the change, the status and a link back. Choose a channel where members may see those titles. Delivery runs in the background in project order and does not depend on SMTP. Replacing or disconnecting a webhook clears its pending messages.

Webhook URLs are encrypted with a key derived from `BETTER_AUTH_SECRET`. After rotating that secret, save each project's webhook again.

## Repository layout

| Directory | What it contains |
| --- | --- |
| [`apps/web`](apps/web) | Web app (vinext), Better Auth, MCP OAuth authorization server, scheduled email and Slack delivery |
| [`apps/mcp`](apps/mcp) | Streamable HTTP MCP server; validates tokens through the web Worker |
| [`packages/core`](packages/core) | Shared Drizzle schema, permissions and domain operations |
| [`apps/web/drizzle`](apps/web/drizzle) | D1 migrations |

Both Workers share one D1 database and one private R2 bucket for images, and both use the Cloudflare Images binding to convert uploads to WebP. The web Worker stores OAuth state in KV.

## Run locally

Requires Node.js 24 and pnpm 10.25.0.

```sh
pnpm install --frozen-lockfile
cp deploy.env.example deploy.env
cp apps/web/.dev.vars.example apps/web/.dev.vars
cp apps/mcp/.dev.vars.example apps/mcp/.dev.vars
```

1. Fill in `apps/web/.dev.vars` using its comments. For Google sign-in, register `http://localhost:5173/api/auth/callback/google` as a redirect URI on your Google OAuth client and keep `BETTER_AUTH_URL=http://localhost:5173`. Set the same `INTROSPECT_SECRET` in both `.dev.vars` files.
2. Local D1 is keyed by `TASKSHQ_D1_ID`. Set it in `deploy.env` to your real database ID, or to any UUID (for example from `uuidgen`) if you only run locally. Changing it later points the dev server at a different, empty local database.
3. Apply the migrations and start the app:

```sh
cd apps/web
( set -a; . ../../deploy.env; pnpm exec cf d1 migrations apply "$TASKSHQ_D1_ID" --dir ./drizzle --local --persist-to .cloudflare/state )
pnpm dev
```

Open <http://localhost:5173>. `pnpm --filter web seed [email]` from the repository root resets a local `acme` organization with sample data. To run the MCP server locally, run `pnpm --filter mcp dev` (it listens on `http://localhost:8787/mcp` and shares the web app's local D1, R2 and KV state).

Local dev always uses the localhost URLs: the web app on port 5173 and the MCP server on port 8787, and each dev server fails to start if its port is taken. The URLs in `deploy.env` only affect builds and deploys; locally, `deploy.env` matters only for `TASKSHQ_D1_ID`, which picks the local D1 database.

## Self-host on Cloudflare

### Prerequisites

- A Cloudflare account. The `cf` CLI is installed as a dev dependency; run it with `pnpm exec cf` inside `apps/web` or `apps/mcp`.
- R2 enabled on the account. Cloudflare requires a payment method to enable R2, including on the free tier.
- The [Cloudflare Images binding](https://developers.cloudflare.com/images/transform-images/bindings/) is used to convert uploads to WebP. Transformations count against your Images allowance; see [Images pricing](https://developers.cloudflare.com/images/pricing/) for the free-plan limit.
- A Google OAuth 2.0 client (type "Web application") from the Google Cloud console. The deploy requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Optional: SMTP credentials for email sign-in and notifications.
- Node.js 24 and pnpm 10.25.0.

The web Worker has a cron trigger that runs every minute to deliver queued email and Slack messages.

### Choose your URLs

TasksHQ needs two public origins, one per Worker:

- **Custom domains.** Set `TASKSHQ_WEB_DOMAIN` and `TASKSHQ_MCP_DOMAIN` (hostnames on a zone in your Cloudflare account) and use `https://<domain>` for `TASKSHQ_WEB_URL` and `TASKSHQ_MCP_URL`. The domains are attached on deploy.
- **workers.dev.** Leave the domain variables empty. The Workers are served at `https://<worker>.<account-subdomain>.workers.dev`, for example `https://taskshq-web.<account-subdomain>.workers.dev`. Your account subdomain is shown in the Cloudflare dashboard under **Workers & Pages**.

The URLs are read when you deploy and become Worker bindings, so they must be set before deploying. If you change them, redeploy both Workers.

### Deploy

Run from the repository root unless noted.

1. Install dependencies and sign in to Cloudflare.

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter web exec cf auth login
   ```

2. Create the D1 database and note the ID it prints.

   ```sh
   pnpm --filter web exec cf d1 create --name taskshq-db
   ```

3. Create the settings files. Both are gitignored; never commit them.

   ```sh
   cp deploy.env.example deploy.env
   cp secrets.env.example secrets.env
   ```

   In `deploy.env`, set `TASKSHQ_WEB_URL`, `TASKSHQ_MCP_URL`, `TASKSHQ_D1_ID`, and the domain variables if you use custom domains. No trailing slashes.

   In `secrets.env`, set:
   - `BETTER_AUTH_SECRET`, `CONSENT_SECRET`, `INTROSPECT_SECRET`: three different values from `openssl rand -base64 32`.
   - `BETTER_AUTH_URL`: the same value as `TASKSHQ_WEB_URL`.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: from your Google OAuth client.
   - Optional SMTP and `SIGNUP_EMAIL_ALLOWLIST` values (uncomment the lines you use).

   Values are literal. Quote a value that contains `#`. The secrets file expands `$NAME`, so write a literal `$` as `\$`.

   The web deploy uploads every key listed in `secrets.env`, overwriting the deployed value. The MCP deploy uploads only `INTROSPECT_SECRET`. Keys you leave out keep their current value on an existing Worker, but a new Worker needs every required key. Fill in each line or delete it: an empty `KEY=` would be uploaded as an empty secret, so the deploy scripts refuse it.

   `pnpm run deploy:web`, `deploy:mcp` and `db:migrate:remote` first run `node scripts/check-deploy.mjs`. It stops when either file is missing, `deploy.env` has CRLF line endings, `TASKSHQ_WEB_URL` or `TASKSHQ_MCP_URL` is not an `https://` origin without a path, a domain variable differs from its URL's hostname, `TASKSHQ_D1_ID` is empty, a key in `secrets.env` is empty or only names an unset `$VARIABLE`, or `BETTER_AUTH_URL` differs from `TASKSHQ_WEB_URL`.

4. In the Google Cloud console, add `<TASKSHQ_WEB_URL>/api/auth/callback/google` as an authorized redirect URI on the OAuth client.

5. Apply the database migrations.

   ```sh
   pnpm run db:migrate:remote
   ```

6. Deploy both Workers. The web Worker deploys first because the MCP Worker has a service binding to it. The first deploy creates the R2 bucket and KV namespace if they do not exist.

   ```sh
   pnpm run deploy
   ```

   Use `pnpm run deploy`, not `pnpm deploy`, which is a built-in pnpm command. `pnpm run deploy:web` and `pnpm run deploy:mcp` deploy one Worker.

7. Record the OAuth KV namespace the first deploy created, so later deploys reuse it. List the namespaces, find the one created for the web Worker's `OAUTH_KV` binding, and set its `id` as `TASKSHQ_KV_ID` in `deploy.env`.

   ```sh
   pnpm --filter web exec cf kv namespaces list
   ```

### Verify

```sh
curl <TASKSHQ_WEB_URL>/.well-known/oauth-authorization-server
curl <TASKSHQ_MCP_URL>/.well-known/oauth-protected-resource/mcp
```

The first returns JSON whose `issuer` is your web URL. The second returns JSON whose `resource` is `<TASKSHQ_MCP_URL>/mcp`. Then open `TASKSHQ_WEB_URL`, sign in, and create an organization.

### Upgrading an existing deployment

```sh
git pull
pnpm install --frozen-lockfile
pnpm run db:migrate:remote
pnpm run deploy
```

Always apply new migrations before deploying either Worker; new code may depend on new columns.

Deployments created before the TasksHQ rename used the resource names `tasks-web`, `tasks-mcp`, `tasks-db` and `tasks-images`. To keep using them, set `TASKSHQ_WEB_WORKER`, `TASKSHQ_MCP_WORKER`, `TASKSHQ_D1_NAME` and `TASKSHQ_R2_BUCKET` to the old names, `TASKSHQ_D1_ID` to the existing database ID, and `TASKSHQ_KV_ID` to the existing OAuth KV namespace ID, so existing data and MCP grants carry over.

### Deploy with GitHub Actions

`.github/workflows/deploy.yml` runs the same migration and deploy from GitHub. It runs only when started by hand and writes `deploy.env` and `secrets.env` on the runner from the `production` environment's Variables and Secrets. For an organization, keep production settings in a private copy of the repository rather than a public one (GitHub does not allow private forks of public repositories).

Do these once by hand first; the workflow cannot:

- Sign in locally (Deploy step 1) and create the D1 database (step 2, using your `TASKSHQ_D1_NAME` if you changed it). Keep its ID for `TASKSHQ_D1_ID`.
- Enable R2 on the account (see Prerequisites).
- Without custom domains, make sure the account has a workers.dev subdomain (**Workers & Pages** in the dashboard). CI cannot register one.
- Add `<TASKSHQ_WEB_URL>/api/auth/callback/google` as an authorized redirect URI on the Google OAuth client.

Then set up GitHub:

1. Create a Cloudflare API token. The simplest known-good choice is the **Edit Cloudflare Workers** template plus **Account › D1 › Edit**. A narrower custom token needs at least **Account › Workers Scripts › Edit** and **Account › D1 › Edit**, plus **Zone › Workers Routes › Edit** for the zones of your custom domains (not yet verified against a live custom-domain deploy). For a first deploy, which creates the KV namespace and R2 bucket, also add **Account › Workers KV Storage › Edit** and **Account › Workers R2 Storage › Edit**; you can remove them afterwards.
2. In the repository, **Settings › Environments › New environment**, create `production`. Under **Deployment branches and tags**, choose **Selected branches and tags** and add `main`.
3. Add these to the `production` environment:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Variable | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
   | Variable | `TASKSHQ_WEB_URL`, `TASKSHQ_MCP_URL`, `TASKSHQ_WEB_DOMAIN`, `TASKSHQ_MCP_DOMAIN`, `TASKSHQ_D1_ID`, `TASKSHQ_KV_ID`, `TASKSHQ_WEB_WORKER`, `TASKSHQ_MCP_WORKER`, `TASKSHQ_D1_NAME`, `TASKSHQ_R2_BUCKET` | As in `deploy.env.example`. Leave optional ones unset. |
   | Secret | `CLOUDFLARE_API_TOKEN` | The token from step 1 |
   | Secret | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CONSENT_SECRET`, `INTROSPECT_SECRET` | As in `secrets.env.example` |
   | Secret | `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SIGNUP_EMAIL_ALLOWLIST` | Optional |

   `BETTER_AUTH_URL` is set from `TASKSHQ_WEB_URL`. Variables may only contain letters, digits and `. _ : / -`. Secret values are written literally (`$` included) and must be one line; a value cannot contain both `'` and a backtick, or end with `\`. A secret you leave unset keeps its deployed value; a first deploy needs every required secret.
4. Run **Actions › Deploy › Run workflow** on `main`, or `gh workflow run deploy.yml --ref main`. Create the `production` environment first, and make sure CI on `main` is green. In CI, `cf` replaces an existing Custom Domain or DNS record for `TASKSHQ_WEB_DOMAIN` and `TASKSHQ_MCP_DOMAIN` without asking, so double-check both before the first run.
5. After the first deploy, set the `TASKSHQ_KV_ID` variable to the ID of the OAuth KV namespace it created (see step 7 above), so later deploys reuse it.

### Troubleshooting

- **Google answers `redirect_uri_mismatch`.** `BETTER_AUTH_URL` must equal the origin users open, and `<BETTER_AUTH_URL>/api/auth/callback/google` must be registered on the Google OAuth client exactly, including scheme and no trailing slash. Fix `secrets.env` and run `pnpm run deploy:web`.
- **The MCP endpoint returns 404.** The MCP Worker only answers on the origin of `TASKSHQ_MCP_URL`. Check that `TASKSHQ_MCP_URL` matches the URL the client uses (custom domain vs workers.dev), then redeploy both Workers so the web and MCP Workers agree on the resource URL.
- **Deploy check fails.** `scripts/check-deploy.mjs` names the problem. For an empty key in `secrets.env`, set a value or delete the line to keep the deployed value.
- **Deploy fails on missing secrets.** A new Worker needs every required key: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CONSENT_SECRET` and `INTROSPECT_SECRET` for the web Worker, and `INTROSPECT_SECRET` for the MCP Worker, with the same value as the web Worker.
- **MCP clients are rejected after a successful sign-in.** `INTROSPECT_SECRET` differs between the Workers, or the MCP Worker was deployed before the web Worker. Redeploy with `pnpm run deploy`.
- **Email sign-in is missing.** SMTP settings are incomplete or invalid. All SMTP values except the port are required.

## Connect an MCP client

The MCP server URL is `<TASKSHQ_MCP_URL>/mcp` (Streamable HTTP). Clients sign in with a TasksHQ account and approve access through OAuth. For Claude Code:

```sh
claude mcp add --transport http --scope user taskshq <TASKSHQ_MCP_URL>/mcp
```

For Codex:

```sh
codex mcp add taskshq --url <TASKSHQ_MCP_URL>/mcp
codex mcp login taskshq
```

`<web origin>/docs/mcp` on your deployment has setup steps for Codex, Claude web and desktop, and Claude Code. To check the connection, ask your assistant "Use TasksHQ to list my projects."

## Checks

From the repository root:

```sh
(cd packages/core && npx tsc --noEmit -p .)
(cd apps/web && pnpm exec cf workers types && npx tsc --noEmit -p .)
(cd apps/mcp && pnpm exec cf workers types && npx tsc --noEmit -p .)
pnpm --filter web test
pnpm --filter mcp test
pnpm build
```

CI runs the same checks on every push and pull request to `main`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). [CLAUDE.md](CLAUDE.md) lists the repository conventions, and [PLAN.md](PLAN.md) is the historical design record. Report security issues as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
