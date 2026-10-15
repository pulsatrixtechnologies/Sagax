# Sagax connected-apps broker

This Worker keeps the shared Composio project key out of desktop builds. Each
installation receives a random bearer token stored only as a SHA-256 hash in
D1. The Worker gives that installation its own Composio user/session, proxies
MCP traffic, and returns short-lived Connect Links to the local app.

The desktop never receives the project key. Authorization links are returned
only on demand and are never persisted in chat messages.

Deployment for this repository:

0. The committed `wrangler.jsonc` ships an all-zero D1 `database_id`
   placeholder. Put the real database ID into your local copy first (do not
   commit it); every command below reads that file.
1. `pnpm broker:types`
2. `pnpm exec wrangler d1 migrations apply openmausbot-composio --remote --config cloudflare/composio-broker/wrangler.jsonc`
3. For an existing Worker, run `pnpm exec wrangler secret put COMPOSIO_API_KEY --config cloudflare/composio-broker/wrangler.jsonc`, then `pnpm broker:deploy`.
4. For the very first deploy, put `COMPOSIO_API_KEY=...` in the ignored `.dev.vars.production` file and run `pnpm exec wrangler deploy --config cloudflare/composio-broker/wrangler.jsonc --secrets-file .dev.vars.production`. Delete the file immediately afterward.

The committed `wrangler.jsonc` ships an all-zero D1 `database_id` placeholder.
Before deploying, create the D1 database (`pnpm exec wrangler d1 create
openmausbot-composio`) and put its real ID into your local copy of
`wrangler.jsonc` (do not commit it). The CI deploy on `main` injects it from
the `COMPOSIO_BROKER_D1_DATABASE_ID` repository secret and skips the deploy
with a warning without it. Forks should likewise create their own D1
database and rate-limit namespaces, replace the IDs in `wrangler.jsonc`, deploy under their own Worker name, and set
`SAGAX_COMPOSIO_BROKER_URL` in their packaged build. Running only the local
server with a Composio project key remains the no-Cloudflare self-host path.

Set `REGISTRATION_MODE` to `closed` to stop issuing new installation tokens
without affecting existing users.
