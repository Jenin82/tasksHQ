# TasksHQ — repo notes

pnpm monorepo, open source as TasksHQ (formerly Tasks). `PLAN.md` is the historical design record that source comments cite; read §2, §3 and §7 before changing anything. `CONTRIBUTING.md` covers contributor setup and checks; `AGENTS.md` is the deployment checklist for agents.

## Layout
- `packages/core` — Drizzle schema, access rules (`src/access.ts`) and domain functions (`src/domain/*`) shared by both apps.
- `apps/web` — vinext (Next.js App Router API on Vite) on Cloudflare Workers. Better Auth with Google and optional email OTP.
- `apps/mcp` — MCP Worker (`taskshq-mcp` by default), stateless streamable HTTP; validates tokens via the web app's `/internal/introspect` over a service binding.

## Rules that are easy to break
- **Every mutation goes through a `packages/core/src/domain` function** with `{ db, actorUserId, source: 'web' | 'mcp', clientId?, clientName? }`. The domain records activity in the same `db.batch` as the mutation. Creator setup edits skip activity rows for up to five minutes, and repeated description saves from the same actor and client skip extra rows for up to ten minutes. No SQL in Server Actions or MCP tools.
- Org and project deletion are owner-only. Their atomic batches remove project-bound activity with the project, so there is no surviving deletion event.
- Statuses have a name and color. The status dot opens the palette in project settings. Tasks created without a status land in the first column by position and ID.
- Coordinate D1 migration `0004_remove_status_category.sql` with the web and MCP rollout. It preserves displayed colors and drops the column used by older Worker versions.
- Apply D1 migration `0005_task_due_date_and_priority.sql` before deploying either Worker with the new task fields. Due dates are calendar dates, stored as `YYYY-MM-DD`, and priority defaults to Medium.
- Activity reads order by `created_at, rowid`, never `id`. Group consecutive description saves in the web display so the stored audit history stays complete.
- Task dialogs use the list snapshot for first paint and read protected details on demand. Share the canonical task page loader and fields, and keep authenticated caching request-scoped.
- Web and MCP share Markdown descriptions and the private R2 image bucket (`taskshq-images` by default). Keep image keys scoped by immutable project ID, check project access on every read and upload, and store only WebP produced by the shared Images binding helper.
- The visual description editor saves Markdown for MCP. Render images only from the current project’s private attachment route.
- Image uploads can be reused across tasks in a project. R2 currently retains unreferenced objects, including after project deletion.
- Apply `0010_task_project_alias.sql` before releasing task transfers. A move changes the task number, copies linked attachments, and keeps old detail URLs access-checked against both projects.
- Apply `0013_canonical_task_preview.sql` before releasing canonical Share links. Share enables the public Kanban PNG for that task at its current URL. Keep legacy share links compatible, task pages access protected, share responses uncached, and automatic request URL logs disabled on the web Worker.
- Keep task properties pinned on desktop and inline on smaller screens. Account for the top bar and project tabs on the full page, and let the pinned panel scroll internally on short viewports.
- Keep absolute screen-reader labels inside positioned board cards so offscreen columns do not widen the mobile document.
- Board and Table own their filter state and render controls in the active project tab bar. Keep the filter popover closed by default even when the toolbar slot is unavailable. Each task table shares sort state between its picker and headers. Workspace assignment filters group equivalent status names across projects.
- Keep workspace search navigation pending outside the dialog so its shimmer can clear when the route loads or is superseded.
- Resolve generic project links through the saved Board/Table view. Keep explicit tab and task links tied to their own routes.
- The work-item toolbar owns its create dialog. Both web creation flows open the project layout’s shared task details dialog using the preview returned by the create action.
- Keep picker and menu colors in the shared Popover, DropdownMenu, and Command components so nested filters follow the current theme.
- Archived tasks can be restored by project members. Permanent deletion is owner/admin only and atomically removes the archived task, its comments, and its task activity.
- Organization membership grants project access and task assignability in Web and MCP. Project roles only grant scoped administration. Reporting lines drive team views and notifications.
- Apply `0014_project_task_edit_restriction.sql` before deploying either Worker. Restricted edits require the creator, current assignee, or an admin with access to manage that project. Recheck this in the shared domain write, including bulk actions. Organization members can still create tasks and comment.
- Organization invitations are the only active invitation flow. Keep legacy project invitation rows inert and discard queued project invitation and access emails.
- Apply `0012_comment_mentions.sql` before deploying either Worker. Comment mentions use UTF-16 ranges into the stored plain text. Mention email is queued with the comment and rechecks recipient membership before delivery.
- Apply D1 migration `0007_project_task_types.sql` before deploying either Worker with task types. The database seeds project types and assigns the current default on inserts that omit a type.
- Bulk task edits resolve status and type choices separately for each project, verify task access on the server, and report failures per task.
- All My Tasks keeps each row scoped to its source organization and project. Its saved filters follow the user across workspace shells. Your Tasks and All My Tasks filter projects by ID so matching names across organizations stay distinct.
- Workspace settings separate Members, Reporting lines, and General. Organization renames preserve the slug; organization deletion stays owner-only in General.
- `prerender` stays off in `apps/web/vite.config.ts` — it baked authenticated HTML into public assets.
- Visual authority is `apps/web/design.md`; PLAN §7 lists the recorded deviations. One blue (`--primary`) CTA per view.

## Deploy config
- Deployment settings live in root `deploy.env` (non-secret `TASKSHQ_*` values) and `secrets.env` (Worker secrets, literal values). Both are gitignored, and have `*.example` templates. Never commit them. Both `cloudflare.config.ts` files load `deploy.env` into `process.env`; `secrets.env` is never loaded there, so `cf deploy --secrets-file` stays its only parser (and `\$` escaping holds). The web config only reads it to decide which optional secrets to declare.
- No hardcoded domains, account IDs or resource IDs. Worker, D1, R2 and KV names and IDs come from `TASKSHQ_*` with `taskshq-*` defaults; custom domains are attached only when `TASKSHQ_WEB_DOMAIN`/`TASKSHQ_MCP_DOMAIN` are set.
- `MCP_RESOURCE` (both Workers) and `AUTH_ISSUER` (MCP) are text bindings built from `TASKSHQ_MCP_URL`/`TASKSHQ_WEB_URL`. They must agree byte for byte, so redeploy both Workers after changing either URL. In dev, the `cloudflare({ config })` hooks in both `vite.config.ts` files override them to `http://localhost:8787/mcp` and `http://localhost:5173`, so local dev never uses deployed URLs.
- Pages that must not import Worker-only OAuth modules (such as `/docs`) read public URLs from `apps/web/lib/public-urls.ts`.
- Root scripts: `pnpm run db:migrate:remote`, then `pnpm run deploy` (or `deploy:web` / `deploy:mcp`). The apps have no `deploy` scripts of their own. Each root script first runs `scripts/check-deploy.mjs` (plain Node), which requires both files, LF line endings in `deploy.env`, https origin-only `TASKSHQ_WEB_URL`/`TASKSHQ_MCP_URL` whose hostnames match any `TASKSHQ_*_DOMAIN`, `TASKSHQ_D1_ID`, no empty or unset-`$VAR` `secrets.env` values (cf would upload them as empty secrets) and `BETTER_AUTH_URL` equal to the `TASKSHQ_WEB_URL` origin. Listed secrets overwrite deployed values; unlisted ones are kept. Keep `README.md` and `AGENTS.md` in sync with any deploy change.

## Commands (run from repo root)
- `pnpm --filter web dev` (port 5173) / `pnpm --filter web build`; `pnpm --filter mcp dev` runs Vite on port 8787 and persists to `apps/web/.cloudflare/state`, so both dev servers share local D1, R2 and KV. Both ports are `strictPort` in the apps' `vite.config.ts`, because the localhost URL bindings depend on them.
- `pnpm --filter web test` and `pnpm --filter mcp test` (vitest in workerd via `@cloudflare/vitest-plugin`)
- Typecheck: `npx tsc --noEmit -p .` inside `apps/web`, `apps/mcp`, `packages/core`; run `pnpm exec cf workers types` first in each app (`.cloudflare/types` is gitignored). CI (`.github/workflows/ci.yml`) runs typecheck, both test suites and the web build.
- `pnpm --filter web seed [email]` resets the local `acme` org
- Add deps with `pnpm add --filter <pkg> …` from the root, never inside an app (duplicates drizzle-orm).
- Local D1 for dev lives in `apps/web/.cloudflare/state`; pass `--persist-to .cloudflare/state` to `cf d1` commands. Local D1 is keyed by `TASKSHQ_D1_ID`, so migrations and the dev server only meet when it is set.
- Keep Vite's dependency cache inside each app root when local test fixtures share `node_modules`.
- Cloudflare tooling is the `cf` CLI with `cloudflare.config.ts`, not wrangler.
- MCP OAuth runs on the web Worker with `OAUTH_KV`. Deploy the web Worker first (`pnpm run deploy` does web then MCP; bare `pnpm deploy` is pnpm's own command). Both Workers need the same `INTROSPECT_SECRET`, and the web Worker needs a separate `CONSENT_SECRET`.
- `/docs` is the public product guide, with MCP setup at `/docs/mcp`. Keep guide routes independent of sessions and Worker-only OAuth modules. Search reads each guide’s `content.tsx`, so preserve section IDs and add `searchTerms` for common alternate wording. Capture public docs images with synthetic data and preserve the old MCP anchors.
- Apply the mail outbox migration before releasing the web and MCP Workers. Keep SMTP credentials on the web Worker and pass only email enablement through MCP introspection. A valid pending invite for the verified address bypasses the signup allowlist.
- Apply `0009_project_slack.sql` before releasing either Worker. Slack delivery uses the web cron independently of SMTP. Keep automatic outbound fetch traces disabled there because Slack webhook paths contain secrets.
