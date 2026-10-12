# Tool policy (securable tool layer)

Every HTTP route the server answers has one row in `server/tool-policy.generated.ts`. The types and the matcher are in `server/tool-policy.ts`.

| field | meaning |
|---|---|
| `method`, `kind`, `route` | The guard the handler matches: an exact path, a prefix or a regex source, and its method (`ANY` when the handler has no method guard). |
| `tier` | `read`, `write` or `admin`. |
| `readOnly` | `true` only for a GET that deletes nothing. |
| `scope` | `<area>:<tier>`, the grant a caller needs. |
| `defaultEnabled` | Whether agent tools may use the route without a grant that names it. It is never `true` for admin. |
| `destructive`, `billing` | These rows are always admin. |

Default classification (`classifyRoute`):
- **read:** GET.
- **admin:** DELETE, a deletion verb (`delete`, `remove`, `wipe`, `purge`, `reset`, `revoke`, `archive`), org, admin, billing, usage, fleet, engines, keys, credentials, roles, members, import and export.
- **write:** everything else, including a route with no method guard.

A request that matches no row is treated as **write**, off by default (`UNKNOWN_ROUTE_POLICY`).

## Adding a route

`scripts/tool-policy/tool-policy-coverage.test.ts` fails when a route has no row, and when a row's route is gone. It runs in the vitest shards (`vite.config.ts` includes `scripts/**/*.test.ts`). To fix it:

1. Run `node scripts/tool-policy/generate.ts`. Reviewed rows are kept; new routes get the default classification.
2. Review the new rows (tier, scope, defaultEnabled) and commit them.

The route list comes from the server sources (`scripts/tool-policy/route-inventory.ts`). Sagax routes are code, not a registry. `server/request-auth.ts` is left out because its path rules are the auth gate, not routes.

Status: B1 declares the policy only and nothing enforces it yet. B2 adds grants and the guard (docs/agent-api.md).
