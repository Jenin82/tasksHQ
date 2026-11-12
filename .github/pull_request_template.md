## What and why

<!-- What does this change do, and why is it needed? Link related issues. -->

## How it was tested

<!-- Tests added or updated, manual steps, screenshots for UI changes. -->

## Migrations and rollout

- [ ] No database migration
- [ ] Adds migration `apps/web/drizzle/NNNN_<name>.sql` (describe rollout order below)

<!-- Deployment, configuration or secret changes, and anything operators must do on upgrade. -->

## Checklist

- [ ] Mutations go through `packages/core/src/domain` functions
- [ ] Typecheck passes in `packages/core`, `apps/web` and `apps/mcp`
- [ ] `pnpm --filter web test` and `pnpm --filter mcp test` pass
- [ ] `pnpm --filter web build` passes
- [ ] Docs updated where behavior or setup changed (`README.md`, `AGENTS.md`, `/docs` content)
