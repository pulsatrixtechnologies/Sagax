# Organization admin API (`/api/org/admin/*`)

The API the Perspicax console reads through its proxy to administer a Sagax
organization server. Design: Perspicax
`docs/superpowers/specs/2026-10-08-sagax-admin-console-design.md`, section 5.
Code: `server/org-admin-routes.ts` (the gate and the first routes),
`server/org-admin-console.ts` (the route table, paging, refusals) and one
module per area (`server/org-admin-*.ts`).

## The gate

- Answered before the session gate and before loopback trust. The only
  credential is a console assertion Perspicax signs per request
  (`Authorization: Bearer <assertion>`, `typ` `pulsabot-console+jwt`, at most
  120 s, single use `jti`, `server_id` equal to the link's). A session cookie
  is ignored here.
- The role is the assertion's Perspicax role: `admin`, `manager` or
  `employee`. A manager reads only their reach: themselves plus the people of
  the teams they manage, and the bots those people own or that are shared
  with them. Out of reach reads as `404 not_found`.
- An optional `locale` claim (`fr`, `en`, `fr-CA`) chooses the language of
  every readable `label`. English otherwise.
- Every answer carries `X-Sagax-Admin-Api: 1` and `Cache-Control: no-store`.
- A refusal is `{code, message, reason, error}`: `reason` is the sentence the
  console shows (`message` and `error` carry the same text for older
  readers). A server fault is `500 server_error` with a generic sentence; its
  detail goes to the server log only.
- Lists page by an opaque cursor: `limit` (1 to 200, default 50), `cursor`
  (the `next` of the previous page) and `q` (search, at most 200
  characters). The answer is `{items, next}`; `next` is null on the last
  page.
- Every POST writes one row of the admin activity log, actor
  `{kind: "person", principalId, via: "console"}`, and answers the changed
  record.
- No answer carries a secret: model keys, tokens and passwords are named by
  provider or reported as set or not set, never shown.

## Routes

| Method and path | Role | What |
|---|---|---|
| `GET capabilities` | employee | the release and every route this server serves |
| `GET overview` | manager | health, engines, sandboxes, presence, turns, routines, errors, latency, host, deploy, backup |
| `GET bots` | manager | every bot in reach; paged and filtered when asked |
| `GET usage?from&to` | manager | usage per day, bot, speaker and engine |
| `GET approvals` | employee | the cards the caller may decide |
| `POST approvals/{thread}/{request}` | employee | `{decision: "allow" or "deny"}` |
| `GET audit?from&to&limit&before&category&target` | admin | the admin activity log, newest first |
| `GET files/{bot}/roots,list,stat,read,download` | manager | a bot's files, read only |

### `GET capabilities`

```http
GET /api/org/admin/capabilities
```

```json
{
  "version": "0.4.14",
  "api": 2,
  "routes": ["GET audit", "GET bots", "GET capabilities", "GET overview", "GET usage"]
}
```

`version` is the Sagax release people know (`package.json` `forkVersion`, or
`SAGAX_RELEASE_VERSION`), not the base version the link sends. `api` is 1 for
a server that predates this route (it answers `404 not_found`) and 2 since
the console routes. A route missing from `routes` is not offered by this
server: the console says so instead of calling it.

### `GET overview`

Counts are within a manager's reach; host, engines, sandboxes, deploy and
backup are server facts.

```json
{
  "version": "0.4.14",
  "startedAt": 1791500000000,
  "deploy": { "image": "ghcr.io/pulsatrixtechnologies/sagax:0.4.14", "builtAt": 1791400000000, "commit": "fc6af09" },
  "host": { "diskTotalBytes": 136000000000, "diskFreeBytes": 80000000000, "memTotalBytes": 16000000000, "memUsedBytes": 9000000000, "load": [0.4, 0.5, 0.6], "cpus": 4 },
  "engines": [
    { "id": "claude", "name": "Claude Code", "version": "2.1.0", "state": "ok", "reported": "2.1.0 (Claude Code)", "reason": null, "checkedAt": 1791500005000 },
    { "id": "cursor", "name": "Cursor", "version": null, "state": "not_preinstalled", "reported": null, "reason": "No Linux arm64 build", "checkedAt": 1791500005000 }
  ],
  "sandboxes": { "enabled": true, "running": 2, "limit": 10 },
  "presence": { "online": 3, "idle": 0, "away": 1, "offline": 6 },
  "turns": { "today": 41, "last24h": 57 },
  "routines": { "runs24h": 12, "failed24h": 1 },
  "errors": { "last24h": 3, "byReason": [{ "reason": "rate_limited", "label": "The provider is rate limiting", "count": 2 }] },
  "latency": [{ "engine": "claude", "turns": 50, "p50Ms": 8200, "p90Ms": 31000 }],
  "backup": { "lastAt": 1791472000000, "ok": true }
}
```

- `engines`: the boot self-check of the image's engines
  (`server/engines-self-check.ts`); without an image manifest, the configured
  instances as their probes found them (`checkedAt` null).
- `presence`: Sagax knows online, away and offline; `idle` is always 0.
  Hidden presence counts as offline.
- `errors`: failed, stalled and unstartable runs, failed routines and refused
  turns of the last 24 hours (`server/org-problem-log.ts`), grouped by reason
  code. `label` is the readable reason in the assertion's language.
- `latency`: from the duration each usage row now carries (`durationMs`, the
  turn's start to its settle); an engine whose rows predate it reads null.
- `deploy`: `SAGAX_IMAGE`, `SAGAX_IMAGE_BUILT_AT` (ISO or seconds) and
  `SAGAX_IMAGE_COMMIT` from the environment; null when unset.
- `backup`: the deployment's backup job writes
  `SAGAX_BACKUP_STATUS_FILE` (default `<data>/backup-status.json`):
  `{"enabled": true, "schedule": "daily 03:00 UTC", "lastAt": "<ISO or ms>", "ok": true}`.
  Sagax takes no scheduled backup itself; with no file every fact is null.

### `GET bots` (extended)

Without paging parameters the answer is unchanged: `{bots, truncated}`, at
most 2,000. With any of `q`, `status` (`active` or `archived`), `engine`
(instance id or driver), `owner` (principal id or Perspicax user id),
`limit` or `cursor`, the answer is a page:

```http
GET /api/org/admin/bots?status=active&q=atl&limit=50
```

```json
{
  "items": [{
    "id": "5e38e819-...", "name": "Atlas",
    "owner": { "principalId": "pr_1abf...", "sub": "01J9...", "name": "Alice" }, "ownerRole": "admin",
    "engine": { "instanceId": "claude", "driverKind": "claudeAgent", "installed": true }, "model": "claude-opus-4-1",
    "access": "org-key", "mcpProfiles": [], "grants": [], "sections": [], "routines": 1,
    "createdAt": 1791500000000, "lastActivityAt": 1791500100000,
    "status": "active", "label": null, "threads": 3
  }],
  "next": null
}
```

Every bot now carries `status` (`archived` is a bot hidden from the sidebar,
which answers nothing until restored), `label` (the sidebar section it is
filed under) and `threads` (its main conversation plus its tasks).

### `GET usage` (extended)

Each row gains `engine`: the engine instance the turns ran on, from the
ledger row, null for rows that did not know it. Rows are grouped by day, bot,
speaker and engine.

### `GET audit` (extended)

`category` (one of the admin activity categories: `config`, `people`,
`session`, `webhook`, `mcp`, `engine`, `bot`, `budget`, `visibility`,
`rights`, `section`, `org`, `approval`, `computer`) and `target` (the id of a
bot, a person or a routine) narrow the page. Without `category`, the
organization categories are read as before.

## People

| Method and path | Role | What |
|---|---|---|
| `GET people?q&role&presence&disabled&limit&cursor` | manager | every person of the organization in reach |
| `GET people/{principal}` | manager | a person's page |
| `POST people/{principal}/disable` | admin | turn a person off or on in this Sagax |
| `POST people/{principal}/reset-access` | admin | delete their engine sign-ins, end their sessions |
| `POST people/{principal}/connections/revoke` | admin | remove their own connections |

### `GET people`

`role` is `admin` or `member`, `presence` one of `online`, `idle`, `away`,
`offline`, `disabled` `true` or `false`, `q` searches the name and the
Perspicax user id.

```json
{
  "items": [{
    "principalId": "pr_7c1e...", "sub": "01J9...", "name": "Bob", "role": "member",
    "disabled": false, "disabledBy": null,
    "presence": { "state": "online", "lastSeenAt": 1791500000000 },
    "bots": 2, "routines": 1, "lastTurnAt": 1791500100000, "turns30d": 48, "costUsd30d": 3.2,
    "engines": [{ "id": "claude", "via": "subscription" }, { "id": "codex", "via": "org-key" }]
  }],
  "next": null
}
```

- `disabledBy`: `perspicax` when Perspicax says the person is out,
  `sagax` when an admin turned them off here, null otherwise.
- `routines`: the routines that run as this person.
- `turns30d`, `costUsd30d`, `lastTurnAt`: the turns this person spoke (a
  routine counts for the person it ran as) over the last 30 days.
- `engines[].via`: what their own turns run with on each engine:
  `subscription` (their own sign-in here), `key` (their model key in
  Perspicax, named by provider only), `org-key`, or `none`.

### `GET people/{principal}`

The row above, plus:

```json
{
  "bots": ["AdminBot, as GET bots answers it"],
  "shared": [{ "botId": "5e38...", "botName": "Atlas", "level": "use", "via": "team" }],
  "connections": {
    "engines": [{ "id": "claude", "via": "subscription", "signedIn": true, "key": false }],
    "mcpServers": [{ "id": "github", "name": "github", "transport": "remote", "state": "enabled" }],
    "composioApps": []
  },
  "routinesAsRunner": [{ "id": "r_1", "name": "Daily digest", "botId": "5e38..." }]
}
```

Connected apps (Composio) belong to the workspace in Sagax, not to a person:
`composioApps` is always empty. `mcpServers[].state` is `paused` while
Perspicax `sagax_integrations` is off for the person.

### `POST people/{principal}/disable`

```json
{ "disabled": true, "reason": "Contract ended" }
```

Answers `{person}` (the row). Disabling ends every session of the person at
once; while disabled no request of theirs is served (401
`principal_disabled`), a new sign-in is refused at its first request, their
routines do not run, and a console assertion naming them is refused. It is
independent of Perspicax's own disable: a sign-in does not clear it, only
`{"disabled": false}` does. An admin cannot disable themselves (409 `self`).
Audited `person.console_disable` and `person.console_enable`.

### `POST people/{principal}/reset-access`

```json
{ "scope": "engine-logins" }
```

`scope` is `engine-logins` (delete the person's subscription sign-ins on
this server), `sessions` (end every session; they sign in again) or `all`.
Answers `{person, cleared: {engineLogins, sessions}}`. Audited
`person.reset_access`.

### `POST people/{principal}/connections/revoke`

The body of the session route: `{"all": true}`, `{"kind": "mcp", "name"}`,
`{"kind": "github"}` or `{"kind": "plugin", "botId", "key"}`. Answers
`{removed, connections}` (the listing after the change). Audited
`connections.revoke` when something was removed.
