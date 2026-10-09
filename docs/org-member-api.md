# Organization member API (`/api/org/member/*`)

What a person may do with their own Sagax bots from an AI client attached to
Perspicax (Claude Code, claude.ai, Cursor, any MCP client), under their own
identity. Perspicax serves it as its `sagax_*` tools. Plan: Perspicax
`docs/superpowers/plans/2026-10-09-master-implementation-plan.md`, lot C.1.
Code: `server/org-member-routes.ts`, wired in `server/index.ts`
(`createOrgMemberRoutes`, `performAsMember`).

## The gate

- Answered before the session gate and before loopback trust, like the
  admin API (`docs/org-admin-api.md`). The only credential is an assertion
  Perspicax signs per request (`Authorization: Bearer <assertion>`): the
  console assertion's format (`typ` `pulsabot-console+jwt`, ES256, `aud` this
  server's public origin, at most 120 s, single use `jti`, `server_id` equal
  to the link's, `role`, `teams`), with `act.sub` `perspicax-mcp` (an AI
  client) or `console`. The admin API keeps accepting `console` only: an AI
  client's assertion is refused there (`401 assertion_invalid`).
- The person is the assertion's `sub`. They must be known here (the
  directory lists them), active in Perspicax and not turned off in Sagax:
  else `403 unknown_person` or `403 person_disabled`. A person does not
  need to have signed in to Sagax.
- An admin is an organization admin both in the assertion (`role: admin`)
  and on this server.
- Each route needs one permission of the catalogue (`shared/permissions.ts`,
  group `clients`). Without it: `403 forbidden_permission` with
  `permission` naming the key. An admin holds every key.
- The route then performs the matching Sagax route **as the person**,
  through a 60 s session of theirs (`SessionRegistry.actAs`, memory only, not
  listed, not renewed, revoked after the call). Every rule the person meets
  in Sagax holds unchanged: which bots they see, private threads, who may
  answer a card, who may Run now. A refusal of that route passes through
  with its status, its sentence and its `permission` when it names one.
- A refusal is `{code, message, reason, error}` like the admin API. Every
  answer carries `X-Sagax-Member-Api: 1` and `Cache-Control: no-store`.
- Every write leaves one row of the admin activity log, category `client`,
  actor `{kind: "person", principalId, via: "perspicax-mcp"}` (`console`
  when the console signed it). No row carries a message text.

## Permissions

| Key | Member default | What |
|---|---|---|
| `clients.botsRead` | on | list their bots, read their conversations |
| `clients.botsMessage` | on | send a message and wait for the answer |
| `clients.routinesRun` | off | run a routine now, read a run |
| `clients.approvalsAnswer` | off | allow or deny a card |
| `clients.peopleNudge` | off | nudge a person |

Keys have two segments (`group.name`): Perspicax refuses a catalogue with
any other shape, so the plan's `clients.bots.read` is written
`clients.botsRead`.

## Routes

| Method and path | Permission | What |
|---|---|---|
| `GET capabilities` | none | the version and the routes |
| `GET bots` | `clients.botsRead` | the bots the person can see, with status |
| `POST bots/{id}/messages` | `clients.botsMessage` | send, optionally wait up to 120 s |
| `GET threads/{id}?since&limit` | `clients.botsRead` | messages since a cursor, steps, pending cards |
| `POST routines/{id}/run` | `clients.routinesRun` | run now |
| `GET routines/runs/{id}` | `clients.routinesRun` | one run |
| `POST approvals/{id}` | `clients.approvalsAnswer` | allow or deny |
| `POST people/{id}/nudge` | `clients.peopleNudge` | nudge |

### `GET capabilities`

```json
{ "api": 1, "version": "0.4.16", "routes": ["GET bots", "GET capabilities", "POST bots/{id}/messages"] }
```

### `GET bots`

```json
{
  "bots": [{
    "id": "5e38e819-...", "name": "Orion", "title": "Operations", "description": "",
    "source": "mine",
    "owner": { "principalId": "pr_7c1e...", "sub": "01J9...", "name": "Bob" },
    "status": "idle", "canMessage": true, "threadId": "a5fe..."
  }]
}
```

- `source`: `mine`, `shared` (shared with them or their team) or
  `organization` (published to the organization's Browse Bots).
- `status`: `idle`, `working`, `waiting` (a card waits for someone) or
  `archived`, for the person's own conversations.
- `canMessage`: the person can use the bot. A published bot they cannot use
  is listed with `false`: they can copy it in Sagax.
- `threadId`: the person's own conversation with the bot.
- `owner.sub` is filled for the person's own bots only.

### `POST bots/{id}/messages`

```json
{ "text": "Count the open tickets of Acme", "wait": 60 }
```

- `text`: 1 to 32,000 characters. Sent as the person, in their own
  conversation with the bot (Sagax's rule on an organization server).
- `threadId`: one of their conversations with this bot; `newThread: true`
  starts a new one instead (not both).
- `wait`: 0 to 120 seconds (default 0). The request stays open until the bot
  has answered, a card waits, or the time is up.
- `sendId`: 8 to 80 of `[A-Za-z0-9_-]`; a retry with the same id is the same
  message.

```json
{
  "botId": "5e38...", "threadId": "a5fe...", "messageId": "m_81...",
  "status": "done", "pending": false,
  "reply": "Acme has 4 open tickets: ...",
  "approvals": [], "cursor": "m_83..."
}
```

`pending: true` (with `status` `working` or `waiting`) when the bot did not
finish within `wait`, or a card waits: read the thread later with
`GET threads/{threadId}?since={cursor}`. `reply` is every bot text after the
message, joined, at most 32,000 characters.

### `GET threads/{id}`

`since` is a message id (the `cursor` of the previous answer); `limit` 1 to
200 (default 50) keeps the newest.

```json
{
  "threadId": "a5fe...", "status": "working",
  "messages": [{ "id": "m_84...", "role": "bot", "kind": "text", "text": "Half way.", "at": 1791500000000, "sender": null }],
  "steps": { "count": 3, "recent": [{ "tool": "Bash", "ok": true }] },
  "approvals": [{ "id": "req_4", "threadId": "a5fe...", "title": "Run a command?", "subtitle": "uptime", "tool": "Bash", "options": ["Allow", "Deny"] }],
  "cursor": "m_84..."
}
```

- `messages`: text lines only (`text`, `nudge`, `access`), never a tool's
  input or output.
- `steps`: the tool calls after the cursor, counted, the last ten named.
- `approvals`: the cards of this conversation still open.
- `gap: true` when the cursor is no longer in the newest 200 messages.

### `POST routines/{id}/run`, `GET routines/runs/{id}`

Run now answers `201 {run: {id, routineId, routineName, botId, status,
threadId, startedAt, endedAt}}`. Sagax's Run now rule still applies (the
bot's owner, the person it runs as, an admin, or `routines.runNowAny`): its
refusal names `routines.runNowAny`. The run read adds `attention`, `error`
and `output` (at most 32,000 characters) for a run the person can see.

### `POST approvals/{id}`

`{"threadId": "a5fe...", "decision": "allow"}` or `"deny"`; `{id}` is the
card's request id (`approvals[].id`). Answers `{answered: true, decision}`.
Who may answer is Sagax's rule (the bot's owner, an admin for a server
command).

### `POST people/{id}/nudge`

`{}`; `{id}` is a Sagax principal id or a Perspicax user id. Answers `{ok,
id, at}`. The nudge cooldown and refusals are Sagax's.
