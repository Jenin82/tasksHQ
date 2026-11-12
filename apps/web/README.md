# TasksHQ web

The TasksHQ web app serves the project UI, sign-in, the public product guide at `/docs`, and the MCP OAuth authorization server. It runs on Cloudflare Workers with vinext.

See the [repository README](../../README.md) for local setup, self-hosting on Cloudflare, email and signup policy, and MCP setup.

From this directory, `pnpm dev` starts the app, `pnpm test` runs the web tests, and `pnpm build` builds the web Worker.
