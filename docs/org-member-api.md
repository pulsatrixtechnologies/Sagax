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
| `clients.approvalsAnswer` | off (the bot's owner holds it for their own bots) | allow or deny a card |
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
| `GET threads/{id}/stream?anchor&wait` | `clients.botsRead` | watch a running turn, streamed (lot C.3) |
| `POST routines/{id}/run` | `clients.routinesRun` | run now |
| `GET routines/runs/{id}` | `clients.routinesRun` | one run |
| `GET approvals/{id}?threadId` | `clients.botsRead` | may the person answer this card (lot C.3) |
| `POST approvals/{id}` | `clients.approvalsAnswer`, or owning the bot | allow or deny |
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
- `stream`: `true` answers NDJSON instead (see "The streamed turn").

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
message, joined, at most 32,000 characters. Every answer also carries
`summary` (see "The turn summary"), null when the message has no thread.

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

### The streamed turn (lot C.3)

`POST bots/{id}/messages` with `"stream": true`, and
`GET threads/{id}/stream?anchor={messageId}&wait={1..120, default 30}`
(watch a turn already running, typically after an approval), answer
`200` with `Content-Type: application/x-ndjson`: one JSON object per line,
each with `event`. A refusal before the stream begins (permission, a thread
the person cannot read, a bad body) is the usual JSON refusal.

| `event` | Fields | When |
|---|---|---|
| `started` | `botId`, `threadId`, `messageId` | first line |
| `progress` | `status` (`working`, `waiting`, `idle`), `steps` (`count`, `recent` names and outcomes after the anchor), `partial` (the words being written now, at most 600 characters, the newest kept, or null), `elapsedMs` | at most every 2 s, only when something moved, and at least every 10 s |
| `approval` | `approval` (`id`, `threadId`, `title`, `subtitle`, `tool`, `options`) | a card waits; the stream then ends |
| `final` | the body of a non-streamed send (`status`, `pending`, `reply`, `approvals`, `cursor`, `summary`) | last line |
| `error` | `code`, `message` | the work failed after the stream began (last line) |

The stream ends at the first card on purpose: the client asks its person
(Perspicax: an MCP elicitation), answers with `POST approvals/{id}`, then
opens `GET threads/{id}/stream?anchor={messageId}` to follow the rest of the
turn. A waiting flag without an open card (a card just answered) does not
end a watch. A client that closes the connection stops the watch.

`partial` comes from the runtime's assistant text deltas
(`server/member-live-text.ts`, memory only, reasoning never kept). Tool
inputs and outputs never appear, only the tool's name and outcome.

### The turn summary

```json
{
  "text": "Build cleaned.",
  "toolCalls": [{ "tool": "Read", "ok": true }, { "tool": "Bash", "ok": true }],
  "toolCallCount": 2,
  "files": ["build/clean.log"],
  "cost": { "inputTokens": 1200, "outputTokens": 300, "costUsd": 0.0123, "turns": 1 },
  "approvals": [{ "id": "req_1", "tool": "Bash", "title": "Run Bash?", "decision": "allow", "by": "Alice", "via": "ai-client" }],
  "threadUrl": "https://sagax.example/#thread=a5fe...&bot=5e38..."
}
```

Everything after the anchor (the person's message): the bot's reply, the
tool calls (the last 50 named, `toolCallCount` all of them), the files the
successful calls wrote and the turn digests list as added or changed (at
most 50), the usage of the finished turns (`cost` null until a turn reported
one, `costUsd` null when the engine reports no price), every card with its
outcome (`allow`, `deny`, `answered`, `pending`, `dismissed`, `expired`) and
who answered it, and the link that opens the thread in Sagax.

### `POST routines/{id}/run`, `GET routines/runs/{id}`

Run now answers `201 {run: {id, routineId, routineName, botId, status,
threadId, startedAt, endedAt}}`. Sagax's Run now rule still applies (the
bot's owner, the person it runs as, an admin, or `routines.runNowAny`): its
refusal names `routines.runNowAny`. The run read adds `attention`, `error`
and `output` (at most 32,000 characters) for a run the person can see.

### `GET approvals/{id}?threadId=`

Whether the person may answer the card through this API, before anyone asks
them (Perspicax checks it before an elicitation):

```json
{ "id": "req_4", "threadId": "a5fe...", "open": true, "canAnswer": false,
  "reason": "Your profile does not include answering approvals of bots that are not yours.",
  "permission": "clients.approvalsAnswer",
  "whoCanApprove": { "kind": "owner", "principalId": "pr_7c1e...", "name": "Bob", "sentence": "The bot's owner, Bob." } }
```

`canAnswer` holds both gates: the permission (below) and Sagax's own rule (a
server command of a member's bot is an organization admin's, `kind: admin`;
any other card is its bot owner's, `kind: owner`). An answered card is
`open: false, canAnswer: false`; a card the thread does not hold is `404`;
a thread the person cannot read is Sagax's own refusal.

### `POST approvals/{id}`

`clients.approvalsAnswer` is derived per card, nothing stored: the owner of
the bot that raised the card holds it for the cards of their own bots; anyone
else needs it from a permission set (an admin holds every key). Without it:
`403 forbidden_permission`, `permission: clients.approvalsAnswer`.


`{"threadId": "a5fe...", "decision": "allow"}` or `"deny"`; `{id}` is the
card's request id (`approvals[].id`). Answers `{answered: true, decision}`.
Who may answer is Sagax's rule (the bot's owner, an admin for a server
command). The card records its answerer as the person, by the name the
organization knows them by, with `via: "ai-client"` (the app shows "from an
AI client" beside the outcome), and the admin activity log keeps one
`client.approval` row naming the person and `via: perspicax-mcp`.

### `POST people/{id}/nudge`

`{}`; `{id}` is a Sagax principal id or a Perspicax user id. Answers `{ok,
id, at}`. The nudge cooldown and refusals are Sagax's.
