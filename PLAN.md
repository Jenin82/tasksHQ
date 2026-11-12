# Task Manager — Implementation Plan

> **Historical design record.** This is the plan and running log kept while TasksHQ (originally named Tasks) was built. Source comments cite it as "PLAN §…", so section numbers are stable. Names, origins and commands below reflect the time they were written; for current setup and deployment see [README.md](README.md) and [AGENTS.md](AGENTS.md). Deployment-specific origins are replaced with placeholders such as `<web origin>` and `<mcp origin>`.

Revision 4. Incorporates three Stage 1 review passes; §10 lists what changed and why.

## 0. Decisions taken (user-approved)

| Decision | Choice |
|---|---|
| MCP OAuth topology | Authorization server lives in the **web app Worker**; MCP Worker is a pure resource server |
| Build order | **M1 web app**, then **M2 MCP**. DO / R2 / API keys / billing out of scope |
| UI | Tailwind v4 + shadcn/ui, components vendored into `apps/web/components/ui` |

## 1. Why the brief's MCP design changed

The brief said: *"The consent screen lives in the web app and talks to the MCP Worker over a service binding."*

That is not buildable from `workers-oauth-provider`'s documented API:

- `parseAuthRequest()` **rejects a request that arrives anywhere but the advertised authorize endpoint**, which sits on the issuer's origin.
- `beginConsent()` returns a handle bound to the browser by a `__Host-` cookie. `__Host-` cookies are host-only and never cross origins. The docs: *"A post from another site has the handle but not the cookie, and is refused."*
- The helpers take a `Request` and return `headers` that must go on the browser response. The Worker owning that response must be the Worker calling them.

**The fix keeps the brief's intent — consent UI in the web app — by moving the role, not the UI.** The web app Worker becomes the authorization server, so `/authorize`, the consent page and the Better Auth session cookie all share one origin. The service binding still exists; it runs the other way, with the MCP Worker calling back to validate tokens.

```
web.tasks.app    Next.js (vinext) + OAuthAuthorizationServer
                 /authorize + consent UI, /oauth/token, discovery
                 Better Auth session — same origin, user already signed in
                 /internal/introspect  ◄──┐
                                          │ service binding .fetch()
mcp.tasks.app    OAuthResourceServer ─────┘
                 /mcp — 7 tools
```

This resembles upstream `examples/split-workers` but is **not identical to it**, and the plan should not claim otherwise. Two real differences: that example's `authorize()` body is a stub that never calls `beginConsent`, and `docs/upstream-sign-in.md` orders consent *before* the identity-provider redirect, whereas here Better Auth has usually signed the user in long before `/authorize` is ever reached.

### Why the MCP Worker cannot just read the KV

Tempting and wrong. Verbatim from `docs/resource-servers.md`:

> "Only the authorization server can validate a token: the props are encrypted with a key wrapped by the token itself, and the token record lives in its KV. A resource Worker therefore asks it, over a Service Binding."

Binding `OAUTH_KV` into `apps/mcp` is therefore not a shortcut — it cannot work. Written here so nobody "optimizes" the service binding away later.

### Why no `WorkerEntrypoint` RPC export is needed

The upstream example exposes `validateToken` as an RPC method on a `WorkerEntrypoint`. vinext owns the Worker's default export, so adding one is undocumented territory. It is avoidable: a service binding can be invoked with `.fetch()`, so `apps/mcp` calls an ordinary `POST /internal/introspect` route handler in `apps/web`, which calls `authorizationServer.validateToken(resource, token, env)` and returns the result as JSON. The authorization server still does the validating, satisfying the constraint above.

**Note the provenance honestly:** `.fetch()` on a service binding is a general Workers capability, not a pattern this library documents for this purpose. It is sound reasoning, not a citation. The binding is declared in **`apps/mcp`'s** config targeting the web Worker by name, so `apps/web` needs no config change at all.

The residual risk is **not** the `.fetch()` — a service binding supports it, and vinext's default export is an ordinary fetch handler, making this strictly less speculative than adding an RPC export. The risk is only whether `/internal/introspect` is routable under vinext at all, which is the same unknown as §5.1.

## 2. Repo layout

pnpm workspaces (vinext's scaffolder is pnpm-based).

```
tasks/
  pnpm-workspace.yaml
  packages/core/
    src/schema/           # drizzle tables (auth + app)
    src/domain/           # org.ts, project.ts, task.ts, comment.ts
    src/access.ts         # requireOrgMember / requireProjectMember
    src/activity.ts       # event type union + payload builders
  apps/web/               # vinext Next.js app + authorization server
  apps/mcp/               # MCP Worker (M2)
```

`packages/core` earns its place: web and MCP both consume it. Nothing else is extracted — in particular shadcn components stay in `apps/web`, since a UI package with one consumer is an abstraction without a second caller.

### The single most important rule

**Every mutation goes through a `packages/core/src/domain` function taking `{ db, actorUserId, source: 'web' | 'mcp', clientId?, clientName? }`, and that function writes its own activity row.**

Provenance becomes correct by construction rather than by discipline, MCP tools become thin wrappers over code the web app already exercised, and the domain layer is directly testable. No mutation is written inline in a route handler, Server Action or MCP tool.

## 3. Data model (D1 / SQLite via Drizzle)

Better Auth owns `user`, `session`, `account`, `verification`, generated by `npx auth@latest generate` — never hand-written.

- `org` — id, slug (unique), name, createdAt
- `org_member` — orgId, userId, role `owner|admin|member`, createdAt; unique(orgId,userId)
- `org_invite` — orgId, email (**stored lowercased**), role, invitedByUserId, createdAt, acceptedAt; unique(orgId,email)
- `project` — id, orgId, slug, name, key (`ENG`, **immutable**), taskCounter, createdAt; unique(orgId,slug), unique(orgId,key)
- `project_member` — **orgId**, projectId, userId; unique(projectId,userId); composite FK `(orgId,userId) → org_member(orgId,userId)`
- `status` — id, projectId, name, color `gray|blue|green|red|yellow|orange|purple|pink`, position (text), createdAt; unique(projectId,name). Unset colors display grey.
- `task` — id, projectId, number, title, description, statusId, assigneeUserId, position (text), archivedAt, createdByUserId, createdAt, updatedAt; unique(projectId,number)
- `comment` — id, taskId, userId, body, source, createdAt, updatedAt
- `activity` — id, **projectId**, taskId (**nullable**), actorUserId, source, clientId, clientName, type, data (JSON text), createdAt

**Correction (verified in step 2):** D1 pins foreign-key enforcement **on**, and `PRAGMA foreign_keys = ...` is a no-op there — setting it to `OFF` still enforces. No pragma is needed. The test suite asserts `PRAGMA foreign_keys === 1` before relying on it, so if that ever changes the suite fails loudly instead of silently passing a test that proves nothing.

### Decisions that stop a subagent inventing something

**Task key allocation.** D1 has no interactive transactions. One atomic statement:

```sql
UPDATE project SET task_counter = task_counter + 1 WHERE id = ? RETURNING task_counter
```

The key is **derived at read time** as `project.key || '-' || task.number`, not stored — storing it would go stale the moment `project.key` changed, which is why `project.key` is also declared immutable. A failed insert after a successful counter bump leaves a gap in the sequence. That is acceptable and deliberate; do not "fix" it with a read-then-write, which reintroduces the race.

**Board ordering.** `position` is a text fractional index (`fractional-indexing`). The alternative worth weighing is not floats but an integer `position` renumbered per move; the string key is chosen because a move writes exactly one row instead of a column's worth. Ordering scope is **within `(projectId, statusId)`**; ties break on `ORDER BY position, id`.

**Who can reach a project.** Every organization member can open and work in every project in that organization, in Web and MCP. Project roles grant scoped administration. Project Settings require an organization owner, organization admin, or admin of the project.

**Cascades.** Removing a member from an org deletes their `project_member` rows and clears their assignments in that organization. The domain requires task assignees to belong to the task's organization.

**Deleting a status** is blocked while tasks reference it; the UI requires choosing a target status to move them to first. Never cascade-delete tasks.

**Re-inviting.** `unique(orgId, email)` plus `acceptedAt` would otherwise strand anyone who accepted and was later removed — a case the cascade paragraph above explicitly contemplates. Re-inviting is therefore an **upsert**: it clears `acceptedAt` and sets a fresh `createdAt` on the existing row.

Two guards, because that upsert otherwise pushes a failure into login: **inviting an address that is already an `org_member` is refused at invite time**, with the members page saying so; and **`claimInvites` is idempotent** — it inserts the `org_member` row only if absent and stamps `acceptedAt` either way. Without the second guard a cleared `acceptedAt` would make the next session-create hook attempt a duplicate `org_member` and trip `unique(orgId,userId)` inside a login.

**Email matching.** Google returns the address as registered, and SQLite text comparison is case-sensitive. Invite emails are lowercased on write *and* lookup. If someone signs in with a Google address different from the invited one, nothing happens and no email is ever sent — so the members page must show pending invites with their exact address, which is the user's only feedback channel.

### Activity payloads

Enumerated now, because step 10's renderer cannot be written against an unspecified blob. **Every payload stores display labels next to IDs** — a renamed or deleted status makes an ID-only history unreadable, and status editing is in scope.

| type | taskId | data |
|---|---|---|
| `task.created` | set | `{title, status:{id,name}}` |
| `task.updated` | set | `{fields:{<field>:{from,to}}}` — scalars only |
| `task.moved` | set | `{from:{id,name}, to:{id,name}}` |
| `task.archived` | set | `{}` |
| `task.unarchived` | set | `{}` | *(added in step 7 — web-only; §5.7 gives MCP no unarchive tool)*
| `comment.added` | set | `{commentId, excerpt}` |
| `project.created` | null | `{name, key}` |
| `project.member_added` / `member_removed` | null | `{userId, displayName}` |
| `status.created` | null | `{id, name, color}` |
| `status.renamed` | null | `{id, from, to}` |
| `status.recolored` | null | `{id, name, from, to}` (previous color or null, selected palette color) |
| `status.reordered` | null | `{id, name}` |
| `status.deleted` | null | `{id, name, movedTo:{id,name}}` |

Three rules that stop two subagents logging the same event differently:

- **A status change always logs `task.moved`, never `task.updated`.** This holds whether it came from a board drag or from MCP `update_task(status:…)`. `task.updated` never carries a status field, so step 11's renderer has exactly one case to handle.
- **`task.updated` carries scalar fields only** — `title`, `description` — as plain `{from, to}` strings. Assignee changes log `task.updated` with `assignee: {from: {id, displayName} | null, to: {…} | null}`; it is the one non-scalar exception and is spelled out because `null` on both sides is meaningful.
- **Reference fields are never a bare id.** Statuses are `{id, name}`; users are `{id, displayName}`.
- **Activity reads must `ORDER BY created_at, rowid` — never `created_at, id`.** Verified in real data: two rows written one `await` apart share a `created_at` millisecond, and `activity.id` is a random UUID, so it sorts arbitrarily. SQLite's implicit `rowid` is a stable tiebreak for retained project history. Without this a `task.updated` + `task.moved` pair from one call renders in arbitrary order, and can flip between renders. **Binding on step 11's renderer.** Those two spellings and no others, so `activity.ts` and the renderer cannot split on key name. (`project.member_*` carries a flat `{userId, displayName}` and `comment.added` a bare `{commentId, excerpt}` — each row's payload is pinned literally by the table above.)

`comment.source` duplicates its activity row's source deliberately, so rendering a comment's badge needs no join.

### Org role matrix

Pinned so nobody invents one — including the project-level authority that §4.10 needs:

| | invite / remove org members | change a member's role | create project | delete project | manage project statuses | manage project members | delete org |
|---|---|---|---|---|---|---|---|
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ (not owners) | ✓ (cannot grant or target owner) | ✓ | — | ✓ | ✓ | — |
| member | — | — | — | — | — | — | — |

A plain member can use all projects in the organization. Invitations are managed at the organization level. Project admins can manage project settings for their project, and organization owners and admins manage project admin roles.

**Last-owner rule:** an org always has at least one owner. Removing, or demoting, the final owner is refused.

Owners can permanently delete an organization or project from its settings after confirming the slug. Deleting a project removes its statuses, tasks, comments, memberships, and project activity. Deleting an organization also removes all of its projects, invites, and memberships. User accounts are shared across organizations and are kept.

## 4. Milestone 1 — web app

1. **Scaffold + spike.** `pnpm create vinext-app@latest`, Cloudflare target, pnpm workspace wiring. The spike must answer, by running: D1 binding via `import { env } from "cloudflare:workers"`; setting **arbitrary** compatibility flags (`nodejs_compat` now, `global_fetch_strictly_public` in M2); **how migrations actually apply** — drizzle-kit only *generates* SQL, and the local D1 vinext's dev server reads may not be the file wrangler writes; secrets and `.dev.vars` for `GOOGLE_CLIENT_SECRET` / `BETTER_AUTH_SECRET` / `CONSENT_SECRET`; whether `npx shadcn init` recognizes a vinext project at all; **and a deploy to workers.dev**. Deploying in step 1 is the cheapest possible de-risk of young software, and M2 needs a stable HTTPS origin for Google's redirect-URI allowlist anyway.
2. **core: app schema + test harness.** App tables, drizzle-kit migration applied to local D1, and `@cloudflare/vitest-plugin` stood up now. The harness goes in early because every later domain module writes its tests inside its own step — retrofitting it at the end is what forces signature churn.
3. **Better Auth + its tables.** Google provider, `@better-auth/drizzle-adapter` (`provider: "sqlite"`), `app/api/auth/[...all]/route.ts` via `toNextJsHandler`, `nextCookies()` last in the plugin array, `baseURL` set explicitly — without it the Google callback defaults to localhost and throws `redirect_uri_mismatch`. `npx auth@latest generate` runs **here**, not in step 2: it derives the schema by reading the Better Auth config, which does not exist until now.
4. **Invite claiming.** `databaseHooks.user.create.after` plus a session-create check, both calling one `claimInvites(email)`, so invites sent before *and* after signup land.
5. **core: org + project domain + access.** Org CRUD, invites, the role matrix, project CRUD, default status seeding (`Todo` / `In Progress` / `Done`), `requireOrgMember` / `requireProjectMember`. Plus a **seed script**: one org, one project, three statuses, ~12 tasks. Steps 8–10 are hard to build and impossible to eyeball against an empty database.
6. **Routing shell + authorization.** `/`, `/[org]`, `/[org]/settings/members`. One `getOrgContext(slug)` called in the `/[org]` layout, returning **`notFound()` rather than 403** for non-members so org slugs are not enumerable — and every domain function re-checks independently, because MCP never runs a layout. **Reserved-slug denylist** (`api`, `login`, `new`, `settings`, `consent`, `authorize`, `_next`, `.well-known`) plus slug validation, or a user creates an org slugged `api` and breaks auth. Defines the first-run path for a user with no org and no invite.
7. **core: task domain.** create / update / move / archive / comment, each writing its activity row. The module MCP reuses verbatim.
8. **Board.** dnd-kit, optimistic move, Server Action persisting `{taskId, statusId, position}`.
9. **Table.** TanStack Table — key, title, status, assignee, updated.
10. **Project settings.** `/[org]/[project]/settings`: statuses (add / rename / recolor / reorder / delete-with-reassign) and project members (add from org members, remove). **These are the brief's two distinguishing project features** and neither exists without this step.
11. **Task detail.** Description, comments, activity log rendering source and client.
12. **States pass.** Empty and error states for: no orgs, empty project list, empty board column, empty table, no comments, failed Server Action, 403, 404. One named surface and one line of copy each.

## 5. Milestone 2 — MCP

1. **Spike — and it is not the one you would guess.** The constraint is not "can vinext export a `WorkerEntrypoint`" (§1 removes that need), it is that **vinext owns the default export** while the authorization server must serve several fixed paths. Answer by running: does a route handler get an `ExecutionContext`, or does a stub suffice for `authorizationServer.fetch(req, env, ctx)`; does `app/.well-known/oauth-authorization-server/route.ts` survive Vite's file globbing, which commonly skips **dot-prefixed directories** (fallback: a `middleware.ts` intercept or a rewrite); and does vinext allow a catch-all for the remaining OAuth paths.
2. `OAuthAuthorizationServer` in `apps/web`: issuer = web origin, `resources: ['https://mcp…/mcp']`, `OAUTH_KV`, `clientIdMetadataDocumentEnabled` plus `global_fetch_strictly_public`, and `clientRegistrationEndpoint` for DCR — deprecated by MCP 2026-07-28 but still needed by ChatGPT and older clients.
3. **`/authorize` is a route handler, never an RSC page.** `beginConsent()` returns headers that must go on the HTML response, and App Router forbids setting cookies or response headers during an RSC render — a `page.tsx` here is a guaranteed runtime error. GET and POST are both route handlers; the consent markup is a React component rendered to HTML, linking the app's compiled stylesheet. Three constraints, each a real failure mode:

- **Import `renderToString` from `react-dom/server.browser`**, not `react-dom/server` — the latter resolves to the Node build. (`renderToReadableStream` is the alternative.)
- **Native form controls only.** shadcn's `<Button>` and `<Checkbox>` are Radix: the checkbox renders `<button role="checkbox">` and submits no form value, so `remember` and `scope` would reach `approveConsent` empty. Use `<input type="checkbox" name="remember">` and `<button type="submit">` with shadcn *classes* applied. This page has no client JS, so anything depending on hydration is simply broken here.
- **A deny path exists.** The submit button carries `name="decision"` with `approve` / `deny`; deny calls `denyConsent` and redirects the client with `access_denied` rather than leaving the request hanging.

*Spike item: resolving the compiled stylesheet URL under vinext; fallback is a small inlined stylesheet for this one page.*
4. **Sign-in ordering.** GET `/authorize` checks the Better Auth session first; if absent it redirects to sign-in carrying **only a nonce**, with the original `/authorize` URL held server-side in KV for ten minutes. Round-tripping the whole query string through Better Auth's `callbackURL` risks version-dependent URL normalization, double-encoded client `state`, and `parseAuthRequest`'s exact-endpoint check. Then `parseAuthRequest` → `lookupClient` → `isConsentRemembered` (skip the page for an already-approved client, or every reconnect re-prompts) → `beginConsent`. POST → `approveConsent(req, handle, {scope, remember})` → `completeAuthorization`. `remember` needs `{secret: env.CONSENT_SECRET, subject: session.userId}` so a second account on the same browser is asked again. The consent handle's ten-minute life is never at risk: it is minted *after* the user returns from sign-in.
5. **Record the client at consent time.** `props: {userId, clientId, clientName}` — not just `userId`. The brief names four distinct agents, so "which agent did this" is the question immediately after "web or MCP", and `activity` already has columns for it. Refresh tokens live 30 days, so adding this later means forcing every user to re-authorize.
6. `apps/web`: `POST /internal/introspect` calling `authorizationServer.validateToken`. **It must authenticate.** Unlike the RPC export it replaces, a route handler is publicly reachable on the web origin; without a check it is an open token-validity oracle. `apps/mcp` sends a shared secret from a Worker secret, compared in constant time, and the handler rejects anything else. Do not rely on "only the service binding calls it". `apps/mcp`: `OAuthResourceServer` with `validateToken: (env) => (resource, token) => env.AUTH_SERVER.fetch(...)`, service binding declared here, its **own D1 binding** to the same database, `nodejs_compat`, and a stateless streamable-HTTP MCP transport — no Durable Object, since DOs are explicitly out of scope.
7. **The seven tools.** Agents do not know UUIDs, so everything is addressed by the identifiers a human would type: `project` is a project key or slug, `task` is a task key (`ENG-42`), `status` is a status name, `assignee` is an email.

   | tool | arguments | returns |
   |---|---|---|
   | `list_projects` | — | `[{key, slug, name, org, statuses:[{name, color}]}]` |
   | `list_tasks` | `project`, `status?`, `assignee?`, `includeArchived?` (default `false`), `limit?` (default 50), `cursor?` | `{tasks:[{key, title, status, assignee, updatedAt}], cursor?}` |
   | `get_task` | `task` | `{key, title, description, status, assignee, comments:[…], activity:[…]}` |
   | `create_task` | `project`, `title`, `description?`, `status?` (default: first board column), `assignee?` | the created task |
   | `update_task` | `task`, `title?`, `description?`, `status?`, `assignee?` | the updated task |
   | `add_comment` | `task`, `body` | `{commentId, createdAt}` |
   | `archive_task` | `task` | `{key, archivedAt}` |

   `list_projects` returns each project's statuses so one call gives an agent everything `create_task` and `update_task` need. There is no unarchive tool — archiving is reversible only in the web UI, deliberately. Each tool is a thin wrapper over a core domain function with `source: 'mcp'` and identity from `ctx.props`. A grant covers everything the user can access, so **every tool filters by live org/project membership on each call** — which is what makes a token outliving an org removal harmless.

## 6. Risks

| Risk | Severity | Handling |
|---|---|---|
| vinext README: *"not yet a drop-in replacement for every application or production workload"* | High | Step 1 is a spike ending in a real deploy |
| vinext owns the default export; AS needs fixed paths incl. a dot-prefixed `.well-known` dir | High | M2 step 1 spike; documented fallbacks (middleware intercept / rewrite) |
| Service-binding `.fetch()` to an introspection route — sound but not a documented pattern for this | Medium | Proven in the same M2 spike; RPC export remains a fallback |
| vinext documents neither compat flags nor secrets | Medium | Step 1 spike |
| Better Auth needs `nodejs_compat` (AsyncLocalStorage) | Medium | Step 1 spike |
| D1 has no interactive transactions | Medium | Atomic `UPDATE … RETURNING`; gaps accepted |
| `__Host-` cookie needs Secure; HTTPS issuer required | Medium | Deploy to workers.dev from step 1 |
| `npx shadcn init` may not recognize vinext | Low | Step 1 spike; fallback is manual vendoring |

## 7. Design direction

**`apps/web/design.md` is the visual authority** — a dark, near-monochrome style reference: a black canvas, a five-step surface stack, one electric blue, pill buttons, and elevation by inset hairline rather than shadow. It supersedes the earlier seed-derived direction. The subsections below are the adaptations this app makes to it, and keep their old numbers because the codebase and later sections cite them.

### 7.1 Numerals are never crowded

Kept from the earlier direction, and the strictest rule in the UI:

- Task keys (`ENG-42`), counts, dates and durations use **tabular numerals**, separated from neighbouring data by **whitespace — never a divider, pipe, bullet or glyph set directly against the numeral**. The top bar's project crumb follows it: name, key and the switcher chevron are spaced apart, not joined.
- No badge pairs two numbers. A column header reads `In Progress` with its count at the far edge of the header row, not `In Progress (12)`.
- Density comes from **letterforms — titles, names, comments — never from numbers**. A numerically dense view is fixed by removing a number, not shrinking it.

### 7.2 Layout and elevation

- **A 56px opaque top bar, no sidebar.** Left to right: the app mark (angular, in foreground — design.md's logo note), the org crumb (name, role in the stutter register, a searchable switcher — §26), a `/`, then the project crumb (name, key, a switcher) on project routes only. The right edge holds a 32px ghost theme button, then the account menu (name, email, sign out — the theme is not in it; 2026-11-06). The bar is the canvas colour with a bottom hairline: there is no filled chrome.
  - **Accepted: the switchers can go stale.** The bar renders in the `[org]` layout, which a soft navigation does not re-render, so an org or project someone else creates, renames or removes reaches the lists only on a full load. Navigating to a removed project still 404s, because every page re-proves reach (§4.6). Polling or a refresh on navigation was not worth the cost for a small-team tool.
- **Headings.** The project's name lives in the bar, so project routes carry an `sr-only` `<h1>` with it, in the project layout. The task page's own heading (key and title, also `sr-only`, since the visible title is an input) is therefore an `<h2>`, and its sections `<h3>`: one h1 per page.
- **Tabs** sit on a hairline row under the bar — Board / Table / Settings for a project. The org has no tab row: its settings are reached only from `/[org]`, the project page (§26). The active tab is **foreground text and a 2px foreground underline**, not blue.
- **The signed-out `/` has no top bar.** Its top-left corner holds the app mark and a ghost theme button (36px, sun and moon swapped by the `.dark` class alone, so server and client markup match); the signed-in headers carry the same button (at 32px, the avatar's size) just left of the account menu. The signed-in org page shares that page's shell, lattice and footer, not its sign-in block; its header's right edge holds the theme button and the account menu (§26). On a laptop-height screen (1280×800) the whole signed-out page fits one screen, the footer's TASKS wordmark cut off at the bottom edge (65% visible, as in the reference); behind the top of the page sits a faint isometric lattice (foreground at 7% light, 14% dark — dark needs twice the alpha to read on #000; worst case muted text over a line stays ≥4.8:1 — full strength across the top fifth, then fading out before the headline) — the only decoration.
- **Elevation is the surface stack plus an inset 1px hairline** (`--shadow-subtle`); inputs take design.md's faint outer glow (`--shadow-subtle-2`). **No drop shadows anywhere**, including the dragged card.
- Cards and panels — settings sections, the members list, the task properties panel, error pages — are the card surface, inset hairline, 16px radius. **Board cards are 12px**, a recorded deviation: 16px reads as a bubble at that size. Board columns stay box-less on the canvas, separated by space and the faintest rule; sections on the task page are separated by a hairline, not boxed.

### 7.3 Type

- **Inter and JetBrains Mono** substitute for the proprietary typefaces design.md originally specified. `html` sets `font-feature-settings: "case", "cv11"`.
- **Two registers, nothing between.** Calm: Inter, sentence case — titles, descriptions, comments, names. Stutter (`.stutter`): JetBrains Mono **12px, uppercase, +0.035em**, muted — keys, status labels, timestamps, `web`/`mcp` badges, tab labels.
- **A dense app scale**, not the marketing one: 14px in dense views (board cards, the table, the activity log — the body default), 16px for prose (the task description, empty states). Page and section headings are 20–24px and nothing is larger — except the footer's "Tasks" wordmark at 36px, a recorded brand-mark exception: it is a logo, not a heading. **Headings are weight 400**; a name may take 500 as body emphasis. Tracking tightens with size: −0.007em at 16px, −0.015em at 18px, −0.027em at 20–24px.

- **The sign-in page is the one marketing surface**, and the only place the dense scale does not apply: its headline is 52px desktop, 36px mobile, weight 400, −0.04em, line-height 1.05, set in two tones ("Work, tracked" foreground, "by people and agents." muted), and its subtext 16px muted. Everything sits left-aligned on the same 1200px column as the mark and the footer. From `lg` a three-row activity ledger (`aria-hidden`, key / what by whom / via web or mcp, in columns rather than separators) sits to the right as the claim's proof; below `lg` it is hidden. (An isometric scene with floating badges was tried and removed at the user's request, 2026-11-06.) The app itself keeps the scale above.

### 7.4 Tokens

Tailwind v4 with `@theme inline`, **shadcn's token names and structure** with this project's values, so vendored components work unmodified (`--accent` is a hover surface, not a brand colour; the `.dark` class goes on `<html>`, set before first paint by an inline script, with `@custom-variant dark` so vendored `dark:` utilities fire). `app/globals.css` holds the values; in summary:

| | Dark (design.md) | Light (derived) |
|---|---|---|
| Canvas `--background` | `#000` | `#fff` |
| Card `--card` | `#0d0d0d` | `#fafafa` |
| Input / muted / secondary | `#1f1f1f` | `#f4f4f5` |
| Hover `--accent` | `#2b2c2e` | `#ececee` |
| Popover / menus / drag overlay | `#2b2c2e` | `#e4e4e7` |
| Foreground / muted | `#fff` / `#8f8f8f` | `#0a0a0a` / `#6b6b6b` |
| Border | `rgba(255,255,255,.12)` | `rgba(0,0,0,.10)` |
| Primary, ring | `#0063e1` | `#0063e1` |
| Destructive | `#d9474c` | `#c0363b` |

- **Light is derived**: the same steps as dark's surface stack, inverted. The blue is identical in both themes; the red is not (below).
- Status dots have an eight-color palette. The rest of the interface uses the surface stack and accent tokens above.
- **Recorded deviations, for contrast (WCAG AA, 4.5:1 for text):**
  - **Dark muted is `#8f8f8f`, not design.md's Ash `#858585`.** Ash is 4.47:1 on Iron (`#1f1f1f`), the fill of every input and select, so placeholders and select text failed. `#8f8f8f` is 5.10:1 on Iron, 6.01:1 on the card, 6.49:1 on the canvas. Selects also show their chosen value in foreground, not muted.
  - **Light destructive is `#c0363b`**, darker than dark's `#d9474c`, which is 4.24:1 on `#fff` and 4.06:1 on the card, and 4.24:1 under a white label. `#c0363b` is 5.48:1 / 5.25:1, white on it 5.48:1, and white on its `/90` hover still ≥4.66:1 on any light surface.
  - **Hover washes behind muted text are `bg-foreground/5`, not `--accent`.** Dark muted on Steel is 4.32:1; on the wash it is 6.01:1 (dark) and 4.80:1 (light). Applies to the top bar's crumbs and the org and project list rows.
  - **Input boundaries fail 1.4.11 non-text contrast (3:1), by design.md's choice.** An input is its fill on the surface behind it — 1.18:1 dark on the card, 1.27:1 on the canvas, 1.05–1.10:1 light — with a faint glow, not a bordered box. Accepted: every input has a visible label or placeholder, and the focus ring (the blue: 3.58:1 on the dark card, 5.20:1 on the light) marks the active one.
- **Text on the popover surface is foreground** (or a foreground tint for secondary lines), never `--muted-foreground`, which fails contrast on it.
- **Radii are explicit steps**, not one `--radius` scaled: 2px nav and tabs (`rounded-sm`), 8px inputs and menus (`rounded-lg`), 12px board cards (`rounded-xl`), 16px cards (`rounded-2xl`), buttons pill (`rounded-full`).
- In project settings, click the status dot to open the palette. New projects start with Todo in grey, In Progress in blue, Done in green, and Blocked in red.
- **Focus is a plain 1–2px blue ring** everywhere, no glow.

### 7.5 Restraint rule

**Blue is reserved for** a view's single primary call to action, the focus ring, and status dots using blue.

The sign-in page's only blue is the Google button.

Muted red is used for errors, destructive confirmation, and status dots using red.

### 7.6 Motion

Kept: **fast at the start, then settles** — `cubic-bezier(0.2, 0, 0, 1)`, 140ms for state changes (the theme's default transition, menus included), 200ms for a card settling after a drag. Nothing eases in slowly. The sign-in block enters once — a 140ms fade and 8px rise, `motion-safe` only; no loops. Drag uses lift — the popover surface and a 1.02 scale — never rotation or a shadow.

## 8. Out of scope

Durable-Object live board updates, R2 attachments, API keys for CI, org billing. Per the brief's "Later". Also deliberately absent, because nothing in the brief needs them: due dates, priorities, labels, multi-provider auth.

## 9. Open item

`npx skills add cloudflare/vinext` was denied by the auto-mode permission classifier, so this plan was written from upstream docs directly. Those skills are the vinext maintainers' own setup guidance and should be installed before Stage 2 scaffolding.

## 10. Revision history

Review findings accepted, grouped by what they fixed:

**Would have failed at runtime.** `/authorize` as an RSC page cannot set the consent cookie (§5.3). The `.well-known` discovery route may not survive Vite's dotfile globbing (§5.1). shadcn token names were invented rather than matched, which would have surfaced mid-UI-build and invalidated several steps (§7.4).

**Would have been wrong in the data.** `project_member` had nothing tying it to `org_member` (§3). Invite emails had no case normalization, so Google-returned addresses would silently miss (§3). `activity.data` was an unspecified blob, and had no home for project-level events (§3). Task keys were stored as well as derived, going stale on any project-key change (§3).

**Would have been missing from the product.** Custom status management and project membership — the brief's two distinguishing project features — had no step at all (§4.10). Neither did empty and error states (§4.12), seed data (§4.5), reserved org slugs (§4.6), or the MCP client identity that `props` must carry from day one (§5.5).

**Corrected the reviewer.** It argued `validateToken` could be a fetch because the docs present that as an alternative implementation. They do not — that example covers a *different issuer's* tokens. The conclusion survives on general Workers grounds and is now labelled as reasoning rather than citation (§1), and the risk is Medium, not eliminated. Its worry about the consent handle's ten-minute cookie spanning the Google round trip was unfounded and is noted as such (§5.4).

**Reordered.** Test harness moved to step 2 from step 11; Better Auth table generation moved to step 3, since the CLI reads a config that does not exist in step 2; a deploy was added to step 1.

### Revision 3 — second review pass

The confirmation pass returned NOT-SOLID with seven must-fix items. All seven are applied.

**A regression I introduced in revision 2.** Rewriting §5.7 dropped four of the seven MCP tool names; only three survived, leaving a subagent to invent the roster. All seven are now named with arguments and return shapes (§5.7).

**A security hole I introduced in revision 2.** Replacing the RPC export with `POST /internal/introspect` made it publicly reachable on the web origin — an open token-validity oracle, where the RPC export had been unreachable from outside. It now authenticates with a shared secret (§5.6).

**Ambiguity that would have split two subagents.** A status change had two plausible event types, so a board drag and an MCP `update_task` would have been logged differently; `task.moved` now always wins. `{from, to}` shapes are pinned, and recategorize/reorder events were missing entirely (§3).

**Authority the matrix did not cover.** It governed four org-level capabilities while §4.10 introduced project statuses and project membership, and its silence read as license. Extended, plus a last-owner rule (§3).

**The token block was only one of three layers.** Valid shadcn names and correct v4 value form, but without `@theme inline` none of them generate utilities, and without `@custom-variant dark` every vendored component's own `dark:` utility silently never fires. Both added, with `--sidebar-*` — which is precisely §7.2's top-left anchor — and a stated place for the `.dark` class (§7.4).

**Two unforced failures in the consent page.** `react-dom/server` resolves to the Node build, and shadcn's Radix `<Checkbox>` submits no form value, so `remember` would have arrived empty at `approveConsent`. Worker-safe entry pinned, native controls required, and a deny path defined (§5.3).

**One dead end in the data.** `unique(orgId, email)` plus `acceptedAt` stranded anyone who accepted and was later removed — a case the cascade rules explicitly contemplate. Re-inviting is now an upsert (§3).

**Accepted from the reviewer.** It conceded both revision-2 corrections, and sharpened one: the residual MCP risk is not `.fetch()` itself but whether `/internal/introspect` routes under vinext — the same unknown as §5.1, now scoped that way (§1).

**Judgment call, not a finding.** The reviewer noted `--cat-in-progress` was identical to `--primary`, which with custom statuses means several brand-violet columns against a one-accent-per-view rule. Resolved by making the category hue adjacent rather than identical, and by scoping the rule to *interactive* emphasis (§7.4, §7.5).

### Revision 4 — third review pass

Four must-fix items, all applied.

**A rule that contradicted its own table.** Revision 3 added "reference fields are always `{id, label}`" directly beneath a table in which no row used `label` — it used `name` for statuses and `displayName` for users. Worse than revision 2, where the shape was merely unspecified: `activity.ts` and step 11's renderer are written by different steps against that one section, and would have emitted and read different keys. The rule now states the two spellings the table actually uses (§3).

**The third layer was named but not delivered.** §7.4 promised three layers and shipped two, on exactly the path where it matters — if `shadcn init` does not recognise vinext, the CSS is hand-written. Tailwind v4 defaults border color to `currentColor` and emits no base layer, so every bordered surface would have rendered in text colour. The `@layer base` block is now present (§7.4).

**Project access was undefined.** The matrix granted owners and admins authority to manage project statuses and members without ever saying whether they can *reach* a project they are not a member of, or who becomes a member when a project is created. The web answer and §5.7's MCP membership filter would have diverged. Now: the creator is always a member, and org owner/admin satisfy `requireProjectMember` implicitly — one rule, both surfaces (§3).

**The re-invite upsert moved a failure into login.** Clearing `acceptedAt` on a row whose user is still a member meant the next session-create hook would attempt a duplicate `org_member` and trip `unique(orgId,userId)` *during sign-in*. Inviting an existing member is now refused at invite time, and `claimInvites` is idempotent regardless (§3).

**Confirmed, not changed.** The reviewer agreed that omitting `--chart-*` is correct — nothing in M1 or M2 charts anything, and only `chart.tsx` consumes those tokens — while `--sidebar-*` genuinely is needed because `sidebar.tsx` reads it, and is present.

## 11. Spike results (M1 step 1) — run 2026-11-05

Everything below was verified by running it, not read from docs. **Five of the eight risks in §6 are now closed, including both M2 blockers.**

### Resolved — M1

| Question | Answer |
|---|---|
| `nodejs_compat` | **Already present.** The scaffold writes `compatibilityFlags: ["nodejs_compat"]`, so Better Auth's `AsyncLocalStorage` need is met out of the box |
| Arbitrary compat flags | Same array — M2's `global_fetch_strictly_public` is a one-line addition |
| `compatibilityDate` | `2026-11-05`, well past the `2024-11-11` that CIMD requires |
| D1 binding | `bindings.d1({ name, id })`. Both fields optional (`@cloudflare/config` 0.29.1, `D1BindingOptions`). `env.DB` type-flows automatically via `.cloudflare/types` |
| `cloudflare:workers` in a route handler | Works. `GET /api/spike` returned live D1 rows through `drizzle-orm/d1`, with a cross-package `@tasks/core/schema` import resolving |
| `npx shadcn init` on vinext | **Works.** Detects "Found Next.js" and "Tailwind CSS v4". The manual-vendoring fallback in §6 is not needed |

### Resolved — M2, ahead of schedule

Both of §5.1's real unknowns are answered, so M2 opens with far less risk than planned:

- **`.well-known` routes fine.** `app/.well-known/oauth-authorization-server/route.ts` appeared in the build's route table and served HTTP 200 live. The reviewer's dotfile-globbing worry does not apply to vinext 1.4.3 — its `excludeDir` drops `_`- and `@`-prefixed directories only, not dot-prefixed ones. No middleware intercept or rewrite needed.
- **`ExecutionContext` is solvable.** `cloudflare:workers` exports a standalone `waitUntil(promise)`. A `ctx` shim passed to `authorizationServer.fetch(req, env, ctx)` can therefore be backed by the real thing rather than a no-op.

Still untested for M2: catch-all fallthrough for the remaining OAuth paths, and whether `/internal/introspect` routes (it is an ordinary path, so low risk).

### Findings that change how we work

- **`_`-prefixed directories are dropped from routing.** vinext follows the Next.js private-folder convention — `app/api/_spike/` is never bundled, silently. Confirmed in `vinext/dist/routing/app-route-graph.js`. Use a `(group)` folder for an "internal" marker, never a leading underscore. §5.6's `/internal/introspect` is unaffected.
- **Migrations.** `drizzle-kit generate`, then `cf d1 migrations apply <db-id> --dir ./drizzle`, adding `--local --persist-to .cloudflare/state` for local. The `--persist-to` is **required** locally: vinext's dev server keeps D1 at `apps/web/.cloudflare/state/v3/d1/`, while `cf`/wrangler default to a different directory, so without it migrations land in a database the dev server never reads. The plan's worry here was correct.
- **Secrets need two halves.** A secret must be *declared* as `bindings.secret()` in `cloudflare.config.ts` **and** supplied in `apps/web/.dev.vars`. Either alone yields `undefined`; a `.dev.vars` entry with no declaration is silently ignored. Undocumented in the vinext README.
- **`drizzle-kit` belongs in `apps/web` too**, not just `@tasks/core` — `drizzle.config.ts` imports it and pnpm's strict layout fails otherwise.
- **`prerender: { routes: "*" }`** in `vite.config.ts` prerenders everything. Every view in this app is per-user authenticated data, so this must be narrowed before the board and table exist, or they will serve stale or cross-user content.
- **`@tasks/core` ships raw TypeScript** through `exports`, with no build step. Fine for vinext/Vite, which transpiles it. Worth remembering when `apps/mcp` lands.

### Correction to §7.4

`npx shadcn init` generates `--chart-1` through `--chart-5` by default. §7.4 said to omit them; they arrive anyway and are harmless, so leave them. Everything else in §7.4 is confirmed against real generator output: the three layers appear exactly as specified (`@custom-variant dark (&:is(.dark *))`, `@theme inline`, and an `@layer base` whose body is `* { @apply border-border outline-ring/50; }` and `body { @apply bg-background text-foreground; }`), the token names match, and `--destructive-foreground` is indeed absent as predicted. The generated file also imports `tw-animate-css` and `shadcn/tailwind.css`, which the plan did not anticipate and which are additive.

### Deploy — verified

**`https://tasks-web.<account>.workers.dev` is live.** `/` returns HTTP 200 with the rendered RSC page and `/api/hello` returns JSON. Production bindings report `env.DB (tasks-db)` and `env.ASSETS`. Worker startup 18 ms, 20 assets, 928 KiB raw / 284 KiB gzipped.

**§6's top risk is now substantially closed.** vinext's "not yet production-ready" warning stands as a general caution, but the build-and-deploy pipeline demonstrably works end-to-end on Workers with a D1 binding attached.

Auth notes for whoever runs this next:
- `cf` does **not** share wrangler's credentials. The command is `cf auth create <name>`, not `cf auth login --profile <name>` — the latter is rejected.
- `cf auth activate <name>` binds a profile **to a directory**, not globally. Activate the intended profile from the repository directory.
- vinext chooses its deployment tool at `@vinext/cloudflare/dist/deploy.js:389` — `cloudflare.config.ts` present means `cf`, absent means `wrangler`. Deleting that file is all it would take to switch.
- Use `pnpm run deploy`, never bare `pnpm deploy` — the latter is a reserved pnpm command that does something else entirely.

**Remote D1 is still empty** (`num_tables: 0`). There is no schema to migrate yet; that happens in step 2.

### Worker naming — resolved

The scaffold inherited `name: "web"` from its directory, which is a collision risk on a shared company account. Renamed to `tasks-web` in `cloudflare.config.ts` and redeployed; `env.DB` and `env.ASSETS` both survive the rename.

Only the Cloudflare Worker name changed. The pnpm package stays `web` so `pnpm --filter web` keeps working, and `apps/web` remains the conventional monorepo path.

**The original `web` Worker is still deployed and serving** at `https://web.<account>.workers.dev`. A rename on Cloudflare is really a create-under-a-new-name, so the old one is an orphan running stale code, bound to the same `tasks-db`.

Deleting it was approved but refused by the local permission layer as an irreversible deletion. It needs to be run by hand:

```
cd apps/web && npx cf workers delete <worker-id>
```

Context for why the rename mattered: this account already runs `roamjoy-web`, `geo-animator-web`, `smart-ruler-web`, `seo-web` and `toggle`. A Worker called plain `web` was a genuine collision hazard, not a cosmetic concern.

## 12. Step 2 results — schema and test harness

Nine app tables live in `packages/core/src/schema/` (`org.ts`, `project.ts`, `task.ts`, `activity.ts`), migration `0000_sharp_exiles.sql` applied to **both local and remote** D1. Four tests pass against real local D1 in workerd, on `@cloudflare/vitest-plugin`. `tsc --noEmit` clean in both packages.

### Test pool — migrated

`@cloudflare/vitest-pool-workers` was deprecated and renamed upstream. Migrated to **`@cloudflare/vitest-plugin@1.5.1`** while the suite was only four tests.

The official codemod (`npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`) refuses to run on an unclean worktree, and everything here is untracked under the Stage 5 no-commit gate. Rather than `--force` it without a git safety net, the swap was done by hand after confirming the new package exports the identical names — `cloudflareTest`, `readD1Migrations` and `D1Migration` are all on the root export. It was a pure string change in `vitest.config.ts` and `test/env.d.ts`, plus removing the old dependency. All four tests pass, both packages typecheck, and no stale references remain.

`vitest` stays at `4.1.12`; the new plugin peers `^4.1.0 || ^5.0.0`, so a move to vitest 5 is available later but was not bundled into this change.

### API facts that cost time (the published docs are wrong)

These applied to the old package and carried over to its successor unchanged.

- **The `/config` entry point no longer exists.** `defineWorkersConfig` / `defineWorkersProject` were removed in the vitest-4 line. The current shape is a Vite plugin — `cloudflareTest({...})` from the root export, inside an ordinary `defineConfig` from `vitest/config`, with the old `test.poolOptions.workers` object passed straight to it. `readD1Migrations` moved to the root export too; the in-package JSDoc still points at `/config` and is stale.
- **`isolatedStorage` and `singleWorker` are gone.** D1 state therefore **persists across tests within a run** — there is no per-test rollback. Tests must use distinct ids rather than relying on a clean database, and any assertion doing an unscoped `SELECT` will break as soon as another test writes the same table. One such assertion was found and scoped during verification.
- **Version floor (old package only):** the deprecated pool peered `vitest ^4.1.0`, which `vitest@5.1.0` does **not** satisfy, forcing the pin to `vitest@4.1.12`. The successor widens this to `^4.1.0 || ^5.0.0`, so that constraint is lifted — the pin simply has not been revisited. `vitest@4.1.12` accepts the installed vite 8.3.0.

### Compatibility date — now aligned

The old pool's bundled workerd rejected the app's date, forcing tests onto `2026-08-22` while production ran `2026-11-05`. **`@cloudflare/vitest-plugin` bundles a newer workerd and accepts `2026-11-05`**, so tests and production now run on the same runtime date. `vitest.config.ts` carries a comment tying it to `cloudflare.config.ts` so the two do not drift apart again.

### Schema choices worth knowing

- The composite FK on `project_member` carries `onDelete("cascade")` — the mechanism for §3's "removing a member from an org deletes their `project_member` rows". It is the only `onDelete` in the schema; everything else uses SQLite's default `NO ACTION`, which gives "deleting a status is blocked while tasks reference it" and "never cascade-delete tasks" for free.
- `project_member.orgId` has no direct FK to `org.id`. The composite FK to `org_member(org_id, user_id)` already guarantees the org row transitively, so a second constraint would be redundant.
- `org_member`, `org_invite` and `project_member` have no primary key — §3 gives them no `id`, so they are rowid tables carrying only the unique indexes the plan specifies.
- `activity.data` is plain `text()`, not `{ mode: "json" }`, which would type the column as `unknown` on select while §3 already pins the payload shapes.
- Drizzle emits `comment` before `task`, so `comment`'s FK references a not-yet-created table. SQLite resolves FK targets at DML time, not DDL time, so this applies cleanly.

### Local-only cruft

`spike_probe` still physically exists in local D1. It was created by hand during the step-1 spike, so no generated migration will ever drop it. It is absent from remote and referenced by nothing. To clear it:

```
sqlite3 apps/web/.cloudflare/state/v3/d1/miniflare-D1DatabaseObject/249e8e1a9ebe9ccc10a490733d85e7ded53dd7e9094644fe4a71b9f4678f9b9f.sqlite "DROP TABLE spike_probe;"
```

Note `cf d1 query --local` cannot inspect local D1 — it returns *"This command has no local equivalent"*. Direct `sqlite3` on the persisted file is the only local inspection route.

## 13. Step 3 results — Better Auth with Google

`better-auth@1.7.17` + `@better-auth/drizzle-adapter@1.7.17`. Config at `apps/web/lib/auth.ts`, handler at `app/api/auth/[...all]/route.ts` (build route table confirms `λ /api/auth/:all+`). Migration `0001_loud_prima.sql` applied to **local and remote**. 8 tests pass, both packages typecheck, build clean.

### The table rebuild worked

Adding `.references(() => user.id)` to the seven deferred columns forced drizzle-kit into six create-copy-drop-rename rebuilds (`org_invite`, `org_member`, `project_member`, `comment`, `task`, `activity`). **`project_member`'s composite FK to `org_member(org_id, user_id)` survived intact, cascade and all**, with the new `user_id → user(id)` FK sitting alongside rather than replacing it. Verified directly against the live DDL in **both** local and remote D1, not just in the generated SQL. `PRAGMA foreign_key_check` clean locally. The step-2 composite-FK test still passes, which is what makes it a regression test on the rebuild.

Note for future rebuilds: drizzle-kit emits `PRAGMA foreign_keys=OFF` before the first rebuild and `ON` after it, so the remaining five run with FKs on. Moot on D1 (§3 — the pragma is a no-op there) and harmless on empty tables, but on populated tables the drop-and-rename ordering would deserve a second look, since e.g. `comment` is rebuilt before the `task` it references.

### Generating the auth schema

```
cd apps/web
npx -y auth@latest generate --config ./lib/auth.ts --output ../../packages/core/src/schema/auth.ts -y
```

**Chicken-and-egg:** the adapter's `schema` option cannot name tables that do not exist yet, so `lib/auth.ts` was first written *without* it, the CLI run, then `schema: { user, session, account, verification }` added. Any future regenerate follows the same order.

**The CLI runs under Node, where `cloudflare:workers` is not real**, so `env.*` comes through empty and it warns *"Base URL is not set"* and *"BETTER_AUTH_SECRET appears low-entropy"*. It does not crash, and the output is still correct — the generated table set depends on the adapter and plugins, neither of which varies by env. Expect those warnings on every `generate`; do not read a clean run as evidence the config loads outside Workers.

**Timestamps agree.** Every generated auth timestamp is `integer({ mode: "timestamp_ms" })`, matching the app schema. The generated file is left byte-for-byte unmodified so a regenerate does not silently drift.

### Tests do not read `.dev.vars` — and must not need it

The pool does **not** load `.dev.vars` (confirmed empirically: `env.BETTER_AUTH_SECRET` was `undefined`). Its bundled `.dev.vars` handling keys off a wrangler config, and this repo has `cloudflare.config.ts` instead. So `vitest.config.ts` hands the four secrets to miniflare explicitly.

`.dev.vars` is gitignored, so reading it unconditionally made the suite **fail on a fresh clone and in CI**. Fixed: `vitest.config.ts` defines test fixtures and `.dev.vars` overrides them when present. Verified passing both with and without the file. The fixtures are not secrets — nothing in the suite contacts Google.

`vitest.config.ts` also needs `resolve.alias: { "@": import.meta.dirname }`; the alias exists in `tsconfig.json` but the vitest resolver does not read it, and without it importing the route handler fails with `Cannot find package '@/lib/auth'`.

### Gotcha: duplicate `drizzle-orm` after `pnpm add`

Running `pnpm add` from **inside** `apps/web` left the two packages pointing at different `drizzle-orm` copies — better-auth pulls `kysely`, an optional peer of drizzle-orm, so `packages/core` linked `drizzle-orm@0.45.4_kysely@0.29.8` while `apps/web` kept plain `drizzle-orm@0.45.4`. The result is ~57KB of `Types have separate declarations of a private property 'shouldInlineParams'` errors from a repo where nothing is wrong. The lockfile was already correct; only `node_modules` was stale.

**Always `pnpm add --filter web` from the repo root, or follow an in-package add with a root `pnpm install`.** A stale `apps/web/tsconfig.tsbuildinfo` will keep replaying the old errors afterwards (`incremental: true`) and must be deleted.

### Still required before sign-in works

Google sign-in is wired but **cannot work yet**. `apps/web/.dev.vars` holds obvious placeholders, and the deployed Worker has no secrets at all. Needed:

1. A Google Cloud OAuth 2.0 Client ID (type "Web application") with both redirect URIs authorized:
   - `http://localhost:5173/api/auth/callback/google`
   - `https://tasks-web.<account>.workers.dev/api/auth/callback/google`
2. Real values in `apps/web/.dev.vars` for local work.
3. All four secrets pushed to the deployed Worker, with `BETTER_AUTH_URL` set to `https://tasks-web.<account>.workers.dev` — **not** localhost.

What the tests do and do not cover: `test/auth.test.ts` proves the sign-in *start* leg — config → drizzle adapter → D1 — by asserting the generated Google URL's `redirect_uri` is built from `baseURL` and that the PKCE state is persisted to D1. The **callback leg (token exchange and user creation) is untested** and cannot be without real credentials.

## 14. Step 4 results — invite claiming

`claimInvites(db, userId, email)` in `packages/core/src/domain/org.ts`, wired into two Better Auth hooks. Migration `0002_heavy_blink.sql` applied to **local and remote**. 15 tests pass, both packages typecheck, build clean.

### The hook shape, read from better-auth's types

From `@better-auth/core/src/types/init-options.ts` (`databaseHooks` on `BetterAuthOptions`): each of `user` / `session` / `account` / `verification` takes `create | update | delete`, each with `before` and `after`.

- **`user.create.after`** — invites sent before the user had an account.
- **`session.create.after`** — invites sent after they already signed up. `after`, not `before`: at `before` time the row does not exist, and `before` can veto or rewrite the write, which is not what claiming does.

**The session object carries no email** — `sessionSchema` is `{ userId, expiresAt, token, ipAddress, userAgent }` — so the hook reads it back from `user` by `userId`.

### The failure policy is load-bearing

A throwing hook **fails the sign-in request**. In `better-auth/dist/db/with-hooks.mjs`, `create.after` runs through `queueAfterTransactionHook`, which calls the hook inline outside a transaction and rethrows via `runPendingHooks("throw")` inside one. So the `try/catch` sits at the hook boundary in `lib/auth.ts`, not inside `claimInvites` — a user who cannot be added to an org still gets a session, while `claimInvites` stays honest for its other callers.

### Index on `org_invite.email` (migration 0002)

`claimInvites` looks up by email alone and runs on **every session create**. The existing `unique(orgId, email)` leads with `orgId` and cannot serve that lookup, so SQLite would full-scan the invites table on every sign-in. Added `index("org_invite_email_idx").on(t.email)`. Verified present on both local and remote.

### Tests go through better-auth, not around it

Both hook tests drive the real code path via `auth.$context` → `ctx.internalAdapter.createUser(...)` / `createSession(...)`, the same seam the Google callback uses, so the hooks genuinely fire. No Google credentials needed; the token-exchange leg remains untested, unchanged from §13.

**Two sabotage checks confirm the tests are real:**
- Renaming `databaseHooks` out of the config fails exactly the two hook tests and nothing else.
- Removing `.onConflictDoNothing()` fails exactly one test — *"survives a re-invite to a user who is still a member"* — with the precise `UNIQUE constraint failed: org_member.org_id, org_member.user_id` that §3 predicted. **The plain double-call idempotency test does NOT catch that regression**, because the `acceptedAt` stamp alone makes a second call a no-op. The re-invite test is the only real guard on that line. (Independently re-verified.)

### Deliberate choices

- **No activity row.** `activity.projectId` is NOT NULL and §3 defines no org-level activity type, so an org-membership event has nowhere to go. This is the one documented exception to §2's "every mutation writes its own activity row", commented as such in the source.
- **Both hooks fire on a brand-new user's first sign-in** (user create, then session create), so `claimInvites` runs twice in one request. Harmless by construction — one extra indexed `SELECT` per sign-up.
- **A re-invite does not upgrade an existing role.** `onConflictDoNothing()` leaves `org_member.role` alone, matching §3's "inserts the row only if absent". If re-inviting should ever change a role, that belongs in the invite path in step 5.
- `@tasks/core` gained a `"./domain"` export entry, mirroring `"./schema"`, rather than re-exporting from the root — which would risk name collisions once step 5 adds `createOrg` and friends.

## 15. Custom domains: `<web origin>` and `<mcp origin>`

The production origin is a custom domain, **`<web origin>`**, not the workers.dev URL used during the step-1 spike. This has consequences beyond cosmetics.

- `BETTER_AUTH_URL` in production must be exactly `<web origin>`. If it does not match the origin the browser arrives on, every sign-in fails `redirect_uri_mismatch`.
- `cloudflare.config.ts` needs the custom domain declared on the Worker, plus the DNS record in Cloudflare. **Not yet done.**
- Google OAuth authorized redirect URIs (`<origin>/api/auth/callback/google`):
  - `http://localhost:5173/api/auth/callback/google`
  - `<web origin>/api/auth/callback/google`
  - `https://tasks-web.<account>.workers.dev/api/auth/callback/google` — optional, but it is the only way to test sign-in on the deployed Worker before DNS is live.
  - **Authorised JavaScript origins: none needed.** Better Auth uses the server-side authorization-code flow; that field is only for browser-side Google SDK flows (One Tap, `google.accounts.id`). Note Google treats `localhost` and `127.0.0.1` as different origins.
### M2 origins — settled

| Role | Origin |
|---|---|
| Authorization server + web app (issuer) | `<web origin>` |
| MCP resource server | `<mcp origin>` |

Concretely, for §5:
- `issuer` is `<web origin>`, so the advertised authorize endpoint is `<web origin>/authorize` and discovery lives at `<web origin>/.well-known/oauth-authorization-server` — a path §11 already proved vinext routes and serves.
- `resources: ["<mcp origin>/mcp"]`, and the resource server's `resourceMetadata.resource` must match that string exactly.
- The two are **different origins**, which is precisely why §1 moved the authorization server into the web app: the `__Host-` consent cookie and the Better Auth session cookie both need to be first-party to the origin that renders `/authorize`, and that origin is `<web origin>`.
- `<mcp origin>` needs its own DNS record and its own custom domain on the MCP Worker, plus the service binding back to the web Worker for `/internal/introspect` (§5.6).

## 16. Step 5 results — org + project domain and access

33 tests pass, both packages typecheck, build clean, seed script runs and is re-runnable. **No migration needed** — `drizzle-kit generate` reported "No schema changes, nothing to migrate", so local and remote are already correct.

### The role matrix is data, in one place

`packages/core/src/access.ts` holds §3's seven capabilities as a `const` tuple and derives the three roles from it — `owner` gets all seven, `admin` all but `org:delete`, `member` none. No `if (role === ...)` exists anywhere in the domain layer.

The matrix's two parenthesised qualifiers — admin "(not owners)" and "(cannot grant or target owner)" — depend on the *target* member rather than the capability, so they cannot live in that table; they are enforced in `domain/org.ts` where the target is known, and the table carries a comment saying so.

`AccessError` carries `reason: "not_a_member" | "forbidden"`, so §4.6 maps non-membership to `notFound()` (slugs stay non-enumerable) and a capability denial to 403. `requireProjectMember` returns the same "No such project." for a project that does not exist and one the caller cannot reach, so existence does not leak either.

### §3's project-reach rule has exactly one implementation

`requireProjectMember` is the only place the rule lives: load project → `requireOrgMember` → return immediately for `owner`/`admin` → otherwise require a `project_member` row. Every project-domain function goes through it, so §5.7's "filters by live membership" is the same code path and web and MCP cannot drift apart.

**Sabotage-verified:** deleting the owner/admin early-return fails exactly one test — *"requireProjectMember admits an org owner and admin with no project_member row"* — and nothing else. (Independently re-verified.)

### The composite FK cascade really works

Three independent confirmations: the live DDL carries `ON DELETE cascade`; a direct SQL probe on a copy of the local D1 file shows a `project_member` row disappearing when its `org_member` parent is deleted; and `removeOrgMember` contains no `delete(projectMember)` at all, yet the test asserting the row is gone passes — so only the constraint can have removed it.

The half **no** constraint covers is `task.assigneeUserId`, whose FK points at `user`, not at membership. `removeOrgMember` nulls it explicitly, scoped by a subquery over that org's projects — and the test seeds a second org with a task assigned to the same user and asserts that one keeps its assignee, so the scoping is not vacuous.

### Deviations from the plan, each commented in source

- **`createProject` writes only `project.created`**, not also three `status.created` and a `project.member_added`. The default statuses and the creator's membership are part of creating the project; §3 assigns no payload to "created with defaults", and five activity rows for one user action is noise.
- **`status.deleted`'s `movedTo` is `null`** when the status held no tasks, so no target was needed. §3 pins `movedTo:{id,name}` and is silent on this case.
- **`inviteToOrg` refuses an admin inviting with role `owner`.** Not requested, but it is §3's "cannot grant owner" applied to the one other path that hands out the role — otherwise an admin could route around `changeOrgMemberRole` by inviting.
- **`reorderStatus` takes `{statusId, afterStatusId: string | null}`** (null means first), computing the fractional key server-side so a move writes one row. The plan never specified this API shape.

### Deliberately not implemented

No `deleteProject` / `deleteOrg` function — the capabilities exist because §3's matrix has those columns, but nothing calls them yet. `removeProjectMember` does not refuse removing the last member (§3 says a project is never *created* memberless, not that it stays populated), and `deleteStatus` does not refuse deleting a project's last status. All three are plan silences, not oversights.

### Seed script

```
pnpm --filter web seed                 # synthetic members only
pnpm --filter web seed you@example.com # plus you, as a second owner
```

Creates org `acme`, project `web` (key `WEB`), three statuses at fractional positions `a0`/`a1`/`a2`, and 12 tasks spread 5/4/3. It uses the real domain functions throughout — including routing an invited member through `inviteToOrg` → `claimInvites` — except tasks, which are inserted directly with a comment saying step 7 owns the task domain. It clears the `acme` org first, so it is re-runnable. Verified: 1 org / 1 project / 3 statuses / 12 tasks / 2 project_members / 2 org_members / 2 activity rows.

**One real workaround.** The seed needs a `D1Database` outside Workers. Miniflare was the obvious route, but the installed `miniflare@5.*-beta` has a breaking constructor shape (`{workers: [{config: …}]}`, no `defaultPersistRoot`/`d1Persist`). The script instead uses `node:sqlite` + `drizzle-orm/sqlite-proxy` against the dev server's persisted file, which needs **one documented cast** to `DrizzleD1Database`. The drivers differ in how they connect, not in the SQL the query builder emits.

### Incidental additions

- `tsx` (dev) in `apps/web` — plain `node` cannot run the seed because `@tasks/core` uses extensionless relative imports, which Node ESM will not resolve even though Node 24 strips the types fine.
- `fractional-indexing` in both `packages/core` and `apps/web` (the seed needs valid keys for its 12 tasks; hand-rolled ones could be rejected by `generateKeyBetween` later).
- `packages/core/tsconfig.json` gained `"WebWorker"` to `lib` for `crypto.randomUUID()` — chosen over `DOM` deliberately, so the package cannot reference `document`.

## 17. Step 6 results — routing shell and org screens

37 tests pass, both packages typecheck, build clean. Screens verified in a real browser against seeded data, in both themes.

### The prerender fix — this was a live data-leak vector

`vite.config.ts` had `prerender: { routes: "*" }` from the scaffold. **It was baking authenticated HTML into static assets**: before the fix, `.cloudflare/output/.../assets/_vinext/static-cache/` contained `*.html` and `*.rsc` files for authenticated routes, shipped as public assets.

vinext's `prerender` accepts only `true` or `{ routes: "*" }` — `normalizeVinextPrerenderConfig` throws on any other `routes` value, and its own types say the object form exists so *future* releases can support narrower selection. **There is no narrower setting; omitting the option is the only way off.** Done, with the reasoning recorded in the file.

`export const dynamic = "force-dynamic"` added to `/` and `/new`, which vinext's static analysis classified `?` (Unknown) — so they stay un-prerenderable even under `deploy --prerender-all`.

Verified three ways: the build no longer prints the prerender line; the `static-cache` directory no longer exists and a `find` for `*.html`/`*.rsc` under assets returns nothing; and the route table is now entirely `ƒ Dynamic` with no `◐ ISR`. (Independently re-verified.)

### Design direction, implemented

Tokens replaced with §7.4's values, keeping shadcn's structure and names intact. Two Tailwind v4 `@utility` rules carry §7.3's registers — `.stutter` (11px mono, uppercase, `+0.06em`, muted) and `.numeral` (tabular, `+0.02em`) — so the two voices are declared once rather than repeated as class strings. Motion defaults (`140ms`, `cubic-bezier(0.2, 0, 0, 1)`) go in `@theme inline`, so every `transition-*` utility inherits them, including the vendored components'.

Confirmed on screen: counts sit at the far edge of their heading row (`Projects … 1`, `Members … 2`), never `Projects (1)`; a project row reads `12 TASKS` at its far edge with whitespace as the only separator; the sidebar is the single filled surface with content on hairlines; exactly one `--primary` control per view; warm paper in light, warm near-black in dark.

**Deviation from §12:** the five `--chart-*` tokens kept their names but took palette values instead of shadcn's cold neutral greys, which would read as foreign the first time anything charts.

### Authorization

`getOrgContext(slug)` lives in `lib/org-context.ts`, is called in the `/[org]` layout **and** again in every page and action, and returns `notFound()` for an unknown slug and for `AccessError.reason === "not_a_member"` — identical responses, so existence does not leak. Verified: an unauthenticated request to any authenticated route 307s to `/`, including `/nonexistent-org`, so org existence is not probeable without a session either.

`AccessError` maps by reason: `not_a_member` → `notFound()`, `forbidden` → a real 403 via `forbidden()`. vinext exports `forbidden()` from its `next/navigation` shim with **no `experimental.authInterrupts` gate**, and the tests prove it reaches the real digest through a real action.

**First-run path:** 0 orgs → redirect to `/new`; exactly 1 org → redirect straight into it; 2+ → a list. The sidebar's org switcher carries the others plus a New organization link, so the single-org redirect never traps anyone.

### Three bugs that only surfaced by driving the UI

- **React 19 resets an uncontrolled form once its action settles**, so a refused submission also wiped what the user typed. `ActionState` now echoes the submitted values back. Same root cause for the role `<select>`, which is `key={role}` so a saved change remounts rather than snapping back.
- **The first `createProject` succeeded in D1 but the list did not change** — the client router still held the pre-action tree. Mutations now `revalidatePath`.
- A help sentence set in 11px lowercase mono was a **third voice**, which §7.3 forbids. Help text is calm-muted.

Role pickers are a native `<select>`, not Radix Select, for the same reason §5.3 rejects Radix Checkbox on the consent page: hidden-input form behaviour.

### Gap in the domain layer

**There is no `revokeInvite` in `packages/core`**, so pending invites are listed but cannot be withdrawn. Given §3 makes the members page the only feedback channel for invites — no email is ever sent — inviting a typo'd address currently has no remedy in the UI. §16 already notes `deleteProject` / `deleteOrg` are absent. Worth adding before the product is used in anger.

### Testing note

`vitest.config.ts` gained three aliases (`next/navigation`, `next/headers`, `next/cache` → `vinext/shims/*`): the vinext plugin that normally aliases `next/*` is not in the vitest config and `next` is not an installed package.

A malformed-slug test initially included `"Acme"` and **passed** — the action lowercases input before calling `createOrg`, so a capitalised slug is normalised rather than refused. The test now uses shapes no normalisation can rescue.

## 18. Step 7 results — task domain

47 tests pass, both packages typecheck, build clean. **No migration** — the task domain adds no column, in particular no `key` column. The seed now creates its 12 tasks through `createTask`, producing real keys `WEB-1 … WEB-12`, `task_counter = 12`, per-column fractional positions and `task.created` activity rows.

### The precedence rule is structural, not disciplinary

§3's "a status change always logs `task.moved`, never `task.updated`" is enforced by construction: `planMove` is the only producer of a `status_id` write, `logMove` the only writer of `task.moved`, and both `moveTask` and `updateTask` use the pair together. Writing the two functions independently is exactly what the rule exists to prevent, and the source says so.

**Sabotage-verified:** flipping `logMove`'s type to `task.updated` fails exactly one test — *"logs task.moved — never task.updated — for a status change, through either function"* — and nothing else. (Independently re-verified.)

### Key allocation

Drizzle emits §3's statement verbatim: `update "project" set "task_counter" = "task_counter" + 1 where "id" = ? returning "task_counter"`. Validation runs *before* the bump, so ordinary failures cost no number; a failed insert after the bump still gaps the sequence, which §3 accepts deliberately.

**The concurrency test does not genuinely race, and says so.** A `Promise.all` burst of 8 creates yields 1–8 with no duplicates, but workerd is single-threaded and D1 serializes statements, so two `UPDATE … RETURNING`s never execute at the same instant. It proves interleaving does not corrupt the sequence; atomicity rests on the single statement itself.

### Decisions beyond what §3 specified

- **`task.unarchived` logs `{}`** — now added to §3's table above. Reusing `task.archived` would make the log state the opposite of what happened; writing nothing would drop a mutation out of the history §2 requires. `TaskActivityType` is exported so step 11's renderer gets a type error if it omits the case.
- **A reorder within one column writes no activity row.** §3 gives `task.moved` a `{from,to}` of statuses, so a same-column drag would render "moved from Todo to Todo". A second documented §2 exception, like `claimInvites`.
- **Equal `position` values are reachable, and repaired on demand** *(revised in §25)*. `deleteStatus` and concurrent `createTask` calls can both leave a run of rows sharing one key. `positionIn` re-keys that run with `generateNKeysBetween` as part of the move that targets it, so a card dropped after a run member lands right after it.
- **Mutating an archived task is not blocked.** §3 and §5.7 specify list filtering only; no rule was invented beyond them. Archiving twice is a silent no-op.
- **`addComment` does not bump `task.updatedAt`** — a comment is not an edit of the task.
- **`createTask`'s status default** is the first `todo`-category status by `(position, id)`, in the domain layer so §5.7's `create_task` and the web agree. A project with no todo status gets a `DomainError` naming the fix.
- **Assignee validation reuses `requireProjectMember`**, so an org owner/admin can be assigned without a `project_member` row — §3's one rule applied consistently, not a second one.
- **`loadTask` throws `AccessError("not_a_member", "No such task.")`** for a task that does not exist *and* one the caller cannot reach, matching `requireProjectMember`'s non-leaking contract.

### Reads, deliberately minimal

`listTasks({projectId, statusId?, assigneeUserId?, includeArchived?})` (default false, §5.7) and `getTask({taskId})`, which returns the task, derived key, `{id,name,category}` status and `{id,displayName}` assignee — **no comments, no activity**. Task detail is step 11 and `get_task`'s composition is M2. No `limit`/`cursor`: §5.7 gives those to the MCP tool and nothing in M1 paginates.

### Test-only wrinkle

Deleting a `task` row directly requires deleting its `activity` rows first (`activity.task_id` FK is `NO ACTION`). Nothing in the domain layer deletes tasks.

## 19. Step 8 results — kanban board

50 tests pass, both packages typecheck, build clean, every route still `ƒ Dynamic`. Drag verified end to end in a real browser: WEB-5 dragged Todo → Done landed at fractional position `a3` and wrote `task.moved` with `source: web` and §3's exact `{from:{id,name}, to:{id,name}}` payload. **This is the first proof that §2's provenance design works in practice, not just in tests.** (Independently re-verified.)

### Optimistic state vs `revalidatePath` — the tension §17 set up

`revalidatePath` runs **only on success, only in the Server Action, once per move**. The client applies the move with `useOptimistic` inside the same `startTransition` that awaits the action, so the revalidated tree is what *resolves* that transition — the optimistic card is replaced by an identical server-rendered one with no flicker. On failure nothing is revalidated, the transition ends against the unchanged tree, and discarding the optimistic move **is** the revert. No `router.refresh()`, no revalidate on drag-over or on failure.

### dnd-kit's stock keyboard support is wrong for a board

`sortableKeyboardCoordinates` is written for a single list and ranks candidates by corner distance, so pressing Right walked a card *down its own column* (a card 100px below beats a column 300px across) and an empty column was unreachable entirely. Replaced with a ~35-line `coordinateGetter` carrying its own `{statusId, index}` cursor, installed only when `activatorEvent instanceof KeyboardEvent`, with absolute positions from `droppableRects`. Verified by reading the live region: Right/Right/Down announced the column changes and dropped the card exactly where announced, including into an empty column.

Announcements are custom — dnd-kit's defaults read raw UUIDs aloud. `announcements.onDragMove` was also needed: a keyboard step can change the slot without changing `over` (the step past the last card is exactly that), and `onDragOver` alone silently skipped it.

### Three bugs only a real browser surfaced

1. **Hydration mismatch on every card** — dnd-kit's module-level counter numbered `aria-describedby` differently on server and client. Fixed with a stable `id` on `DndContext`.
2. **An empty column was not a mouse drop target.** A column droppable spans the full height, so by corner distance a card in the *next* column outscored the column the cursor was inside. Fixed with `pointerWithin(args) || closestCorners(args)` — `pointerWithin` ranks only what the cursor is genuinely over and returns nothing for the keyboard, which falls through to corner distance.
3. **A drag ending on the card's own slot appended it to the end of the column.** Now returns early when `over.id === active.id`.

### Design (§7) — verified on screen in both themes

No boxes anywhere: columns separated by `gap-6` plus a single hairline, cards at `border-border/40` (lighter than the column rule) with a `0.04` alpha shadow, column surface transparent. The decay chrome → column rule → card hairline → muted metadata is visible. Card rhythm is exactly mono key / calm title / mono footer. Column headers put the count at the far edge. Dates render `6 NOV`, never `11/06`, so no badge pairs two numerals. The only `--primary` element is the active tab underline; category markers use `--cat-*`. Drag lifts with `scale-[1.02]` and shadow — **no rotation** — and settles at 200ms.

### Known limits, stated not hidden

- **Cross-column drags do not reflow live.** Within a column `verticalListSortingStrategy` opens a gap; across columns the target column tints instead. Live cross-container reflow needs a parallel state machine during the drag — a deliberate cost call, not an oversight.
- **A window resize cancels an in-flight drag.** dnd-kit's own behaviour.
- **The Table tab 404s** until step 9. It renders the app's own non-leaking 404.
- `positionIn` never generates fractional keys in the browser — `moveTask` computes them server-side from the neighbour, so duplicate positions cannot originate client-side.

## 20. Step 9 results — table view

53 tests pass, both packages typecheck, build clean, every route still `ƒ Dynamic`. The Table tab resolves, so step 8's deliberate 404 is closed. Verified in a real browser: default order is `WEB-1 … WEB-12` with **`WEB-2` before `WEB-10`**, and the title filter `board` narrows to 2 rows with the count updating to `2 TASKS` at the far edge.

### TanStack Table resolved to v9, and v9 is a rewrite

`pnpm add @tanstack/react-table` gives **9.3.1**, which **is the `latest` dist-tag — a stable release, not a preview** (checked against npm: `alpha` 9.0.0-alpha.54, `beta` 9.0.0-beta.80, `latest` 9.3.1). But v9 is a rewrite of v8: `useTable` instead of `useReactTable`, features registered explicitly through `tableFeatures({...})`, row models as feature slots. The implementation follows the skills docs the package itself ships in `node_modules/@tanstack/react-table/skills/`, not v8 knowledge. Only `columnFilteringFeature` + `filteredRowModel` and `rowSortingFeature` + `sortedRowModel` are registered, with sort and filter functions passed directly to columns rather than through the registries, so nothing unused is bundled. **Most TanStack Table material online is v8 and does not apply.**

### Sorting decisions

- **The key column sorts on `task.number`, never the rendered string.** §3 derives the display key at read time, so sorting what is printed would put `WEB-10` before `WEB-2`. The accessor is `number`; the cell renders the key. **Sabotage-verified:** switching to a text sort fails exactly one test with `['WEB-1', 'WEB-10', 'WEB-2', …]`.
- **Status sorts by board order** (`Todo → In Progress → Done`) via an index derived from the project's status positions, not alphabetically — alphabetical would read as arbitrary next to the board.
- `enableSortingRemoval: false`, `sortDescFirst: false` — every column starts ascending, and a third click cannot drop the table back into whatever order rows happened to arrive in.

### Filtering

Client-side, deliberately: the board already renders a project's whole task list in one page, and §18 gave `listTasks` no `limit`/`cursor` on purpose. A round trip per keystroke buys nothing at this scale. Two filters — a substring over title, and a status filter matching on **status id, not name**, since two projects' statuses can share a name. Both are native controls (§17's precedent over Radix) writing table state directly; no `useState`, no URL persistence.

### Task detail URL shape

**`/[org]/[project]/<TASK KEY>`**, e.g. `/acme/web/WEB-5`, uppercase exactly as displayed. The key is the only identifier a human or an agent types — §5.7 addresses everything by key — and Next prefers a static segment over a dynamic one, so `table` and step 10's `settings` keep winning over `[task]`. It 404s until step 11, consistent with how the Table tab behaved until this step. **Step 11 implements `app/[org]/[project]/[task]/page.tsx`.**

### Design (§7) — verified on screen in both themes

No box, no zebra striping, no vertical rules; decay runs chrome → header rule → row hairline, and the header row carries no fill. Keys and dates are tabular mono, the count sits at the far edge as `12 TASKS`, and no cell pairs two numerals. Column headers are the stutter register inside their sort buttons — none became a 13px semibold label. The table introduces no `--primary` element; the active tab underline remains the only one.

### Testing: the suite now renders components

`vitest.config.ts` needed two additions, both forced. `tsconfig.json` carries Next's `jsx: "preserve"`, so Vite refuses to transform any `.tsx` module in the test environment — the vinext plugin does this during dev and build and is not in the vitest config. **Without `@vitejs/plugin-react`, no test can import a `.tsx` module at all**, which would have ruled out testing sorting against the real component. `next/link` needed the same shim alias as the three `next/*` aliases §17 documents.

The sort test hands the table its rows **reversed**, because `listTasks` already returns `WEB-1 … WEB-10` — without that, the test would pass with no sorting at all.

### Incidental

- `lib/format.ts` holds `shortDate`, lifted out of the board page so the two views cannot drift into different date shapes.
- `rows.ts` is a shared read model so the tests build rows the same way the page does, rather than asserting against their own copy of the mapping.
- `.claude/launch.json` added (name `web`, `pnpm --filter web dev`, port 5173) so the dev server is managed rather than hand-rolled. It is tracked, not ignored.
- The filter input's focus ring is `--ring`, which equals `--primary`. Every existing control in the app already does this; §7.5 governs interactive *emphasis* and a focus ring is transient, so it was left consistent rather than changed in one place.

## 21. Step 10 results — project settings

59 tests pass, both packages typecheck, build clean, `/:org/:project/settings` is `ƒ Dynamic`. **This closes the gap the first review pass called missing product rather than missing code** — until now step 5 seeded three statuses that nobody could change, and project membership had no UI at all.

### A blocking bug its own review caught

**Deleting a project's last status hid the add form**, leaving the project with no statuses and no way back — and §16 explicitly allows that delete, since `deleteStatus` refuses only on referencing tasks, not on being the last one. The add form now survives the empty state, with a regression test. This is exactly the class of bug that only appears when a UI and a domain rule are written in different steps.

### The two choices worth recording

**Reorder uses up/down buttons, not drag.** This *is* a single vertical list, so dnd-kit would have worked — but it would have cost a `DndContext`, a sortable wrapper, custom announcements and a fresh keyboard story to verify (§19 found the stock coordinate getter wrong), for a list of three to six rows that changes order rarely. Two `<button>`s in one form are keyboard-operable *because they are buttons*. Both carry a neighbour id as `name="after"` (empty string = first), so `reorderStatus` still computes the fractional key server-side and one row is written per move.

**Members are one list of real `project_member` rows, with org reach stated separately.** §3 gives org `owner`/`admin` access without a membership row, so a naive picker either hides them (implying no access) or offers them (implying access depends on being added) — both lies. Instead: the Members list holds only real rows, each removable; below it, owners and admins without a row appear under *"These people reach this project through their organization role, without a membership row. Nothing here grants or removes that."*; and the picker splits into `<optgroup>`s — "Not on this project" and "Already has access — org role" — so they stay addable without the UI implying they must be.

### Delete-with-reassign

Confirmed on screen: deleting a status holding tasks expands an inline **MOVE TO** row demanding a destination before the destructive action is available — not a refusal the user has to decode. `status.deleted` carries §3's `movedTo:{id,name}`, and no task is ever cascade-deleted. **"Move and delete" is the only `--destructive` element in the view**, per §7.5.

### Other review findings applied

`revalidatePath` now makes one `(path, "layout")` call covering the whole project subtree — two explicit paths had missed `/table`, leaving the table's status filter stale. Both arrows disable while a move is in flight, since their neighbour ids come from props. The eligible-members list is no longer serialized into a read-only viewer's payload. `aria-label`s distinguish the otherwise-identical Remove and Delete buttons.

### Authorization

A plain member sees **no controls at all** — verified in the accessibility tree, not merely disabled controls that would error on submit — and the same actions called directly return 403. `can()` / `requireCapability` from `packages/core/src/access.ts` is the only matrix; no second one was written.

### The no-Todo case

If no status is categorised `todo`, the page says so: §18's `createTask` default has nothing to pick, so a new task would have nowhere to land. Surfaced as a standing note rather than an error, since it is a reachable configuration, not a failure.

### Known, deliberately left

- **`CATEGORY_DOT` is now defined in three files** (board, table, settings) and the native-select class in three more. Both want one shared module; the refactor touches files outside this step and is **worth doing in the Stage 4 pass**.
- **A status's task count includes archived tasks** — deliberately, because that is the set `deleteStatus` counts, so the number shown is the number that blocks a delete. A `listStatuses({projectId, taskCount})` in core would collapse the two expressions of that invariant, and §5.7's `list_projects` would be its second caller.
- **Enter in a rename field submits twice** (implicit submission plus the blur handler). Harmless — `renameStatus` returns early when unchanged — but a wasted round trip.

### Local dev state

A minted Better Auth session for a local test user is still in local D1, so the preview stays signed in. Clear it with `sqlite3 <dev d1 file> "delete from session;"`. **Better: sign in through Google for real** — the credentials are in `.dev.vars` now, and doing so would close the callback leg that §13 notes has never been exercised.

## 22. Step 11 results — task detail

68 tests pass, both packages typecheck, build clean, `/:org/:project/:task` is `ƒ Dynamic` and the static `table` / `settings` segments still win over it. Driven end to end in a real browser against the seed, in both themes: title and description edited, status changed, assignee set, comment added, archived and unarchived.

### The composition moved into core, not the page

§18 left `getTask` returning no comments and no activity on purpose. §5.7's `get_task` returns both, so `packages/core/src/domain/task.ts` gained `getTaskDetail({taskId})` — task, comments oldest-first, activity log — and `getTaskByKey({projectId, key})` on top of it. M2's tool calls the same two functions; the page composes nothing of its own. `getTask` is untouched, so the board and table reads are unchanged.

### `rowid` through drizzle

§3's `ORDER BY created_at, rowid` has no drizzle column — `rowid` is implicit and absent from the table definition — so it is a raw fragment, table-qualified because both reads join `user`:

```ts
const ACTIVITY_ROWID = sql`"activity"."rowid"`;
const COMMENT_ROWID  = sql`"comment"."rowid"`;
...orderBy(asc(activity.createdAt), ACTIVITY_ROWID)
```

Both tables have a `text` primary key, so neither aliases `rowid` and neither is `WITHOUT ROWID`; the implicit one exists and is monotonic. Comments get the same tiebreak for the same reason.

**Measured, not assumed:** `updateTask` writing `task.updated` then `task.moved` one `await` apart landed in the same millisecond **4 times in 10**. **Sabotage-verified:** swapping the fragment to `"activity"."id"` fails exactly one test — *"orders activity by rowid when two rows share a created_at millisecond"* — with the pair reversed, and nothing else.

### Key parsing — case-insensitive on the project half

`parseTaskKey` is the inverse of §3's read-time derivation: `/^([A-Za-z][A-Za-z0-9]{1,5})-([1-9]\d*)$/`, matching `assertValidProjectKey`'s shape, and rejecting `TDW-0` and `TDW-05` so a task has exactly one URL. `getTaskByKey` then compares the project half **case-insensitively** — `project.key` is uppercase by construction while the org and project slugs sharing the URL are lowercase, so `/acme/web/web-5` is the ordinary hand-typed case rather than a 404. The number matches exactly.

An unparseable key, a key naming another project, a task that is not there and a task the caller cannot reach are the **identical** `AccessError("not_a_member")` → `notFound()`. Verified live: `/acme/web/WEB-999` and `/acme/web/not-a-key` both serve HTTP 404 with the same page.

### The renderer

`TaskActivityEntry` is a mapped type **keyed off `TaskActivityType`**, so a type added to that union without a payload fails to compile at the type, and `describe`'s `never` default fails to compile when a case is missing. No lookup, no fallback. Every payload is read in §3's exact spelling — `{id,name}` for statuses, `{id,displayName}` for users.

**Provenance renders.** Three `source: "mcp"` activity rows and one MCP comment were inserted straight into local D1 — the one thing M1 cannot produce on its own — and the log reads `MCP CLAUDE DESKTOP`, `MCP CURSOR` and a bare `MCP` for a grant with no client name. Two of those rows share a `created_at` millisecond and render in insertion order on screen, which is the rowid rule visible in the product rather than only in a test. **They are still in local D1** (`activity` ids `mcp-demo-1..3`, `comment` id `mcp-cmt-1`); `pnpm --filter web seed` clears them, or delete them by id.

An MCP row is told apart by **what it says, not by a second colour or a box**: §7.3 puts both badges in the muted stutter register, so the web row reads `web` and the MCP row reads `mcp <client name>`.

### Design (§7)

No boxes: sections are separated by a top hairline and the properties rail by a `border-border/50` left rule — lighter than the section rules beside it, continuing §7.2's decay. Counts sit at the far edge (`COMMENTS … 2`, `ACTIVITY … 11`). Timestamps are `6 NOV 06:20` — three whitespace-separated tokens, the month between the two numerals. Two registers only: comment bodies, the title and names are calm; keys, status names, badges and timestamps are stutter.

**The one `--primary` is the Comment button** — the page's single creative act; every other control edits something that already exists. **Archiving does not take `--destructive`**: `unarchiveTask` sits right next to it, so it is not a destructive confirmation (§7.5).

### Known, deliberately left

- **A board card does not open the task.** Step 8 made the whole card a dnd-kit drag handle with `role="button"`, so there is no anchor on it; the table's rows have linked since step 9. Nesting a link inside that handle is step 8's interaction surface and its keyboard story, not this step's, so it was not touched. One line in `CardFace` plus a keyboard pass would close it.
- **`SELECT_CLASS` and `CATEGORY_DOT` now exist in four files.** §21 already flagged the shared module as owed; this is its fourth copy, kept local rather than importing a settings client module whose Server Actions would come with it.
- **Title and description submit on blur**, the pattern §21 established for the status rename field. A save landing mid-typing in the other field can discard what was being typed — seen once while driving the page, and it is the cost of the blur-submit pattern rather than a new bug.

### Addendum to §22 — board cards now open their task

Step 11 reported, honestly, that **a board card could not open its task**: step 8 made the whole card a dnd-kit drag handle with no anchor, so the detail page was reachable only from the table. The board is the primary view, so that was a real hole rather than a deferral.

Fixed here rather than left: the card's **title** is now a `Link`. The pointer sensor's existing `activationConstraint: { distance: 4 }` is what makes the two coexist — a press that moves more than 4px starts a drag and suppresses the click, a press that does not navigates. `CardFace` takes `href` optionally so the **drag overlay renders no anchor**, which would otherwise be a duplicate of the same link while dragging.

**Both behaviours verified in the browser after the change**, because this touched §19's hard-won drag surface: clicking WEB-1's title navigated to `/acme/web/WEB-1`, and dragging WEB-1 from Todo to Done still moved it and updated the counts. 68 tests and both typechecks still pass.

### Local dev state after step 11

Fabricated MCP provenance rows remain in local D1 — `activity` ids `mcp-demo-1/2/3` and `comment` id `mcp-cmt-1`, all on `WEB-5`. They exist because **M1 cannot produce an MCP-sourced row on its own**, and without them the renderer's main purpose would ship unexercised. They render as `MCP CLAUDE DESKTOP`, `MCP CURSOR` and a bare `MCP`. `pnpm --filter web seed` clears them.

The board state also drifted from the seed during verification (WEB-1 and WEB-5 were moved). Re-seed to restore 5/4/3.

## 23. Step 12 results — empty and error states

71 tests pass, both packages typecheck, build clean. The audit found **21 states already in place** and seven real gaps.

### The gaps that were real

1. **No error boundary existed at all.** `toActionState` rethrows anything that is not an `AccessError`/`DomainError`, and a thrown exception during render had no app-owned fallback — it landed on vinext's built-in default. Added `app/error.tsx` (catches page and layout renders below the root layout, plus rethrown Server Action errors) and `app/global-error.tsx` (root-layout failure only, so it replaces the whole document and carries its own inline colours — the only hard-coded colours in the app). Both confirmed supported in vinext 1.4.3's route graph, then proven live: a thrown render error returned **HTTP 500** with the app's own page and a digest.
2. **A genuine bug, not a missing state: the detached assignee.** `removeProjectMember` deletes the membership row, and **nothing nulls `task.assigneeUserId`** — §16 nulls it only when someone leaves the *org*. The assignee picker is built from the assignable list, so a removed person had no `<option>` and the browser fell back to the first one: **the page read "Unassigned" for a task that was assigned.** Now rendered in an `<optgroup label="No longer on this project">` (§21's precedent), still shown, not re-selectable — `requireAssignableUser` refuses on submit and the refusal comes back inline.
3. **Board and table with no statuses said "No tasks yet."** §16 allows deleting the last status, so it is reachable — and the message named the wrong thing, since no task *can* be created when `createTask` has nowhere to put one. One shared `NoStatuses` component now serves both views so they cannot drift.
4. **An empty board column was a sentence in the stutter register** — 11px uppercase mono, exactly what §7.3 forbids. Moved to calm.
5. **An archived task opened by URL** showed only a muted timestamp. It now says it stays out of the board and the table until unarchived.
6. **Two dead ends for a plain member** (no statuses, no project members) stated the absence without naming who could fix it.
7. **403 copy** said what you cannot do and stopped; it now says an owner or admin can do it for you.

### What could not be tested, stated plainly

**No test exercises the boundary *catching*.** `renderToStaticMarkup` rethrows straight past a class boundary, and `renderToReadableStream` switches to client rendering at the nearest `Suspense`. **React's server renderer never consults a class error boundary — recovery is client-side**, and the workerd pool has no DOM. The test therefore pins the half that is ours (the fallback's contract: offers a way back, renders the digest, never renders the thrown message), and the catch was verified in a real browser instead.

### Local dev state

An extra org `hollow` with project `void` (no statuses) remains in local D1 from verification. `pnpm --filter web seed` only clears `acme`, so it survives, as does the pre-existing `test` org. Harmless; delete by hand if unwanted.

## 24. Gap found at the end of M1: there is no way to create a task in the web app

**Confirmed by grep: the only `createTask` references under `apps/web/app/` are comments.** Tasks exist only because `scripts/seed.ts` makes them. There is no "New task" surface on the board, the table, or anywhere else.

**This is an omission in this plan, not in the implementation.** §4's twelve steps cover the task domain (7), the board (8), the table (9), project settings (10), task detail (11) and states (12) — every one of them reads or edits tasks, and **not one of them asks for a create-task UI**. It survived three review passes and twelve steps because each step was individually complete against what it was asked for.

It also makes a line of shipped copy untrue: both empty states say tasks arrive *"by hand here, or by an agent"*, and until this exists only the second half is true.

Scope if wanted: a form or inline composer on the board column and/or the table, a Server Action over the existing `createTask` (which already defaults status to the first `todo` category, §18), and §7's one-`--primary`-per-view rule to respect. The domain function, its tests and its activity row already exist — this is a UI surface only.

**Closed (2026-11-06).** Each board column now ends in a quiet "Add task" text button (no `--primary`, §7.5) that opens a single-input composer. `createTaskAction` in `app/[org]/[project]/actions.ts` wraps `createTask` with the column's `statusId`, so the task lands at the end of that column. Enter submits and the composer stays open, cleared and focused, for the next title. Escape closes it and returns focus to the button. A whitespace-only title gets the domain's inline error, with the input echoed back.
- The board-wide "No tasks yet" early return is gone. It hid the columns, and with them every composer, in a project with statuses but no tasks. Each empty column already says "No tasks".
- The composer sits **inside** the droppable list, so it follows each column's last card. Outside it, the droppable's `flex-1` put every button at the tallest column's height, below the fold. Clicks and typing there can't start a drag, because drag listeners are spread on cards only.
- The table has no composer. Its empty-state copy now links to the board instead of claiming "by hand here".
- Verified in a browser: created WEB-13 in In Progress, and it was logged as `task.created` with source `web`. Blank-title error, Escape and focus return all work. A stepwise pointer drag then moved it to Todo, logged as `task.moved`. Tests: 73 across 13 files, including two new `createTaskAction` tests in `test/board.test.ts`.

## 25. Stage 4 review, round 1: findings and fixes (2026-11-06)

The first review pass found 1 blocking issue, 5 major and 17 minor; all are fixed except two left as choices (UTC timestamps, plaintext Google tokens in `account`).
- **B1:** the org page now links each project. Before this, no project could be reached from the UI.
- **M1:** only owners see the "Owner" role. An admin who grants owner anyway, for example from a stale form, now gets an inline `DomainError` rather than a 403.
- **M2:** each board card is its own dnd-kit activator, with `role="group"`. Enter on the title link now navigates, and Space/Enter on the focused card lifts it. Verified in a browser.
- **M3:** duplicate positions get re-keyed, as described in §18's revised bullet.
- **M4:** the last-owner guard is now part of the SQL write itself. On removal, a NOT NULL sentinel `UPDATE` (`role = NULL` on the target row) makes the batch fail if the guarded DELETE matched nothing. D1 has no `RAISE` outside triggers.
- **M5:** every multi-write mutation now runs as one `db.batch`, which is a single implicit transaction. `writeActivity` returns an unawaited builder so it can join the batch. `allocateTaskNumber` stays separate, because the insert needs the number it returns.
- **Changes to §2/§3's wording:**
  - `deleteStatus` and `removeOrgMember` now write a `task.moved` / `task.updated` row for each affected task. These come from one `INSERT … SELECT` in the batch (round 2, MIN-4), not one statement per task.
  - The domain validates roles, categories and length limits (`MAX_LENGTH` in `errors.ts`).
  - Unique and foreign-key races now map to `DomainError`.
  - The project-reach rule is now the `project:reach_all` capability, so `access.ts` no longer branches on role names.

**Known residuals:**
- `moveTask` / `updateTask` into a status that is being deleted at the same moment still surfaces a foreign-key 500.
- Status-name uniqueness races aren't mapped to `DomainError`.

**Round 2 (2026-11-06):** one major and 10 minor findings, all fixed.
- **Major:** `scripts/seed.ts` crashed because sqlite-proxy has no batch. It now passes a transactional batch callback.
- **Minor:**
  - `placeAfter` in `packages/core/src/position.ts` now re-keys positions for both tasks and statuses.
  - The "admins can't touch owners" rule is now enforced inside the guarded write, through `untouchableBy`.
  - Activity rows are written only if their write changed a row (`INSERT … SELECT … WHERE changes() > 0`, in `activity.ts`), so repeated archives and removals no longer log twice.
  - Bulk activity is a single `INSERT … SELECT`.
  - Drizzle's `db.run(sql)` with bound parameters crashes inside a D1 batch, so these helpers use `db.insert(activity).select(...)`. Its select list must follow the column order in `schema/activity.ts`.

**Round 3 (2026-11-06): CLEAN.** No blocking or major findings.
- **Fixed:**
  - `createTaskAction` no longer sends the string `"null"` as a status id.
  - `requireManagedStatus` answers `not_a_member` for a missing id, so it no longer reveals whether a status id exists (this matters once MCP calls it).
  - The seed looks up the email case-insensitively.
- **Residual:** `status.deleted.movedTo` is computed from a count read before the batch. A task created into that status at the same moment is moved and logged, but `movedTo` can still record `null`.
- **Test-quality follow-ups:**
  - The MIN-2 role-change race test relies on `Promise.allSettled` interleaving rather than a deterministic hook.
  - `hardening.test.ts:219` can't detect a missing `updatedAt` bump.
  - No test covers the lost-race path of `writeActivityIfChanged` after a double `deleteStatus` or a reorder.

## 26. Navigation rework: org page, org landing, searchable switchers (2026-11-06)

Supersedes §17's first-run path (0 orgs → `/new`, 1 org → straight in).
- **Signed-in `/` is always the org page**, whatever the count. Orgs are cards on the 1200px column (1/2/3 columns), each with the role and the number of projects the user can reach in it (`reachableProjects`, one count per org, since reach depends on the role in that org). With none, one empty-state card. "New organization" — the page's one blue button, opening a dialog with the create form — sits to the right of the heading block, bottom-aligned, wrapping under it on narrow screens. The header's right edge holds the theme button and the account menu (`components/account-menu.tsx`), as the top bar does — the theme moved out of the menu into that icon button (2026-11-06, user request); the lattice backdrop (`components/iso-lattice.tsx`) is shared with the sign-in page, which is unchanged. `/new` only redirects to `/`; the route and the reserved slug stay so old links work.
- **The flow is `/` (org page) → `/[org]` (project selection page) → a board.** `/[org]` is laid out like the org page: the lattice behind the top, a `Projects` eyebrow (the org's name is already in the bar's crumb) and a 24px weight-400 heading, and to its right an outline "Organization settings" link (→ `/[org]/settings/members`, shown to every member, since any member may read that page) and "New project" — the page's one blue button, for roles with `project:create` (owner, admin), opening a dialog with the existing form. Projects reachable to the caller (`reachableProjects`, by name then `id`) are cards, 1/2/3 columns, each with its name, key and live task count; with none, one empty-state card whose copy depends on whether the caller can create. **Org settings are reachable only from here:** the org tab row (Projects / Members) is gone, nothing else links to settings, and the members page carries a "← Projects" link back. Choosing an org in the bar's switcher lands on `/[org]`, never straight on a board. `createProjectAction` redirects into the new project's board.
- **`/[org]/projects` only redirects to `/[org]`**; the route and the reserved slug stay so old links work.
- **Change of mind (2026-11-06):** `/[org]` briefly only redirected — to the first reachable board, or to a projects list at `/[org]/projects` behind an org tab row. The user restored the project selection page, with the org page's look, as the one place to pick a project and reach org settings.
- **`projects` is a reserved slug.** `/[org]/projects` is a static route and would shadow a project slugged `projects`; the list is shared with org slugs, harmless there.
- **The org and project names link to the current organization listing and project board.** The adjacent chevrons open searchable cmdk popovers. Typing filters by name and project key, arrows and Enter pick, and Esc closes and returns focus. Items are keyed by slug. The footer ("New organization" → `/`, "All projects" → `/[org]`) stays visible while filtering.
- The create dialogs suggest slugs from the name. The project dialog also suggests a task key using initials for multiword names. Manual edits to either field take precedence over later name changes.

**Pre-deploy check.** Local D1 is clean, but remote may hold a project already slugged `projects`, which the new route would make unreachable. Before deploying, run against remote D1:

```sql
SELECT o.slug, p.slug FROM project p JOIN org o ON o.id = p.org_id WHERE p.slug = 'projects';
```

## 27. MCP OAuth rollout

- `tasks-web` serves OAuth discovery, registration, token exchange, Google sign-in resume, and consent on `<web origin>`. `tasks-mcp` serves `<mcp origin>/mcp` and validates its bearer tokens through the service binding to `tasks-web`. The grant uses the signed-in user’s current Tasks access.
- Deploy the web Worker before the MCP Worker. Both use the same D1 database. The web Worker stores OAuth data in `OAUTH_KV` and uses a separate `CONSENT_SECRET`. Both Workers need the same `INTROSPECT_SECRET`.
- Production D1 migrations `0003_status_colors.sql` and `0004_remove_status_category.sql` were applied on 2026-11-06. Pre-deploy queries found no projects, tasks, or projects using the reserved slug. The public metadata endpoints responded, the unauthenticated introspection route returned 403, and MCP rejected an invalid bearer with 401.

Core has no project rename, so any hit needs a manual `UPDATE project SET slug = … WHERE id = …`.

## 28. Product guide

1. Make `/docs` the public entry point. Use shared navigation and section anchors so each guide can be linked directly and read on a phone.
2. Write separate guides for first setup, work items, views and filters, project settings, organization settings, and integrations. Match labels and role requirements to the app and explain how to recover when a required control is unavailable.
3. Move the existing client setup instructions to `/docs/mcp` and keep the old `/docs` MCP bookmarks working.
4. Capture representative product screens in a local workspace with synthetic tasks and people. Store compressed WebP assets under `apps/web/public/docs-media`, with alt text, captions, and dimensions. The written steps should remain usable on their own.
5. Verify the routes while signed out, including article links, old MCP anchors, screenshot delivery, and layout at desktop and phone widths. Keep the docs independent of task data and session state.
