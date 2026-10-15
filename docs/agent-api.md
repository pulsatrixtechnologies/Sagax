# The agent-to-agent API

Twelve tools let one agent find, prompt and read another agent, with the same
names, parameters and limits as Grok Bot's agent tools, plus `get_agent` and
`delete_agent` (Perspicax #321). One core
(`server/agent-api.ts`) serves two transports:

- **Bots**: the agents MCP server offers the tools in a bot's direct turns
  (`SAGAX_AGENT_API=1`, set when the bot holds at least one scope; `create_agent` and `delete_agent` only for a Primary Bot; never in a
  room or an external runtime). Calls go to `POST /api/internal/agent-api/<tool>`
  behind the per-turn capability.
- **People's AI clients** (Perspicax): `POST /api/org/member/agents/{tool}`,
  acting as the person (see [org-member-api.md](org-member-api.md)).

## Tools

| Tool | Kind | Scope | What |
|---|---|---|---|
| `list_agents` | read | `agents.read` | every agent the caller can reach, with status `running`/`idle` |
| `find_agents` | read | `agents.read` | `query`, optional `status` (`running`/`idle`), `limit` ≤ 64 (default 8) |
| `get_agent` | read | `agents.read` | `agent_id`: the full profile for an audit (see below) |
| `create_agent` | admin | `agents.create` | one temporary agent per call (see below), `name` (≤ 80 chars, one line), optional `description` and `idle_hours` (1 to 720, default 24); it greets the person itself. Only on the person's explicit ask |
| `delete_agent` | admin | `agents.create` | `agent_id` of a temporary agent: archives it (see below). A lasting agent answers 409 `not_temporary` |
| `send_prompt` | write | `agents.send` | `agent_id`, `prompt` (≤ 32,000 chars), `mode` `fire_and_forget` (default) / `blocking` / `async`, `timeout_ms` (1 s to 10 min, default 120 s), `on_busy` `supersede` (default) / `reject` / `queue`, up to 8 `files` (workspace-relative, 25 MiB each). Answers a `handle` |
| `await_turn` | read | `agents.read` | `agent_id`, `handle`, `timeout_ms`. Never send the prompt again: wait again with the same handle |
| `read_transcript` | read | `agents.read` | the whole transcript (the newest 2,000 entries; `truncated` says when there were more) |
| `read_transcript_page` | read | `agents.read` | one bounded page: `limit` (1 to 200) and `before_ms` required, `after_ms` optional (inclusive unix ms), `cursor` for the next older page |
| `read_latest_page` | read | `agents.read` | the newest page: `limit` ≤ 200 (default 20), `cursor` |
| `read_latest_page_with_threads` | read | `agents.read` | the newest page and the conversations it spans, with their status |
| `read_transcript_cold` | read | `agents.read` | the stored transcript only: pages of 50 by `cursor`; never reads live state, never wakes a computer or sandbox |

`list_agents`, `find_agents` and `create_agent` answer each agent as `{id,
name, description, status, temporary}`.

`get_agent` answers `agent` (the summary and its `title`), `owner`
(`principal_id`, `name`), `profile`, `temporary` and `profile_url` (the
Perspicax console sheet, `<issuer>/console/sagax/bots/<id>`, on an
organization server; null otherwise). `profile` holds the `instructions`
(capped at 32,000 characters, `instructions_truncated`), their `persona`,
`rules`, `voice` and `anti_jobs` sections found by their markdown headings in
French or English (each capped at 8,000 characters; the persona falls back to
the text before the first heading), every `headings`, and the
`voice_settings` (`voice`, `speak_replies`, `voice_notes`). `profile` is null,
with a `note`, unless the caller is an organization admin, the owner or a
person who can edit the bot; a bot reads the profile of a temporary agent it
created. `temporary` is null for a lasting agent, else `created_at`,
`idle_hours`, `expires_at` (null while pinned) and `pinned`.

## Temporary agents

Every agent `create_agent` makes is temporary (`server/temporary-agents.ts`,
JC's decisions of 2026-10-14). The mark (`BotRecord.temporary`) never goes on
the wire and is never exported.

- **Owner**: the calling person; for a bot's call, the person its turn speaks
  for, else the calling bot's owner.
- **Expiry**: archived after `idle_hours` without a prompt or any activity of
  its own (default 24; `SAGAX_TEMP_AGENT_IDLE_HOURS` sets the default), unless
  a person pinned it with `PUT /api/bots/:id/temporary-pin` `{"pinned": true}`
  (its owner or an organization admin, never a bot or a local service). The
  server looks every 5 minutes.
- **Quota**: at most 10 active per person (an ownerless one counts against
  the bot that made it); past that `create_agent` answers 409
  `temporary_quota`.
- **Depth 1**: a temporary agent cannot create agents (409 `too_deep`).
- **Visibility**: the app never shows one: `GET /api/bots` leaves it out and
  the event stream drops every frame about it or its conversations. Through
  the agent API, a person reaches their own temporary agents, those a bot they
  reach created, and an organization admin all of them; a bot reaches them as
  any peer (team, scope and allow-list).
- **Deletion is an archive**: `delete_agent` (or the expiry) stops its running
  turns and archives it. It leaves every list, every agent API call on it is
  404 `unknown_agent`, and every write to it or its conversations is 410
  `agent_archived`. Its conversations stay on disk for 30 days (`purge_at`);
  then the bot and its data are deleted like any deleted bot.
- **Rights**: only its owner or an organization admin deletes it; a bot only
  an agent it created itself, for the same owner. Anyone else gets 403
  `forbidden_owner`.
- **Audit**: `agents.create_agent` records `temporary` and `idleHours`,
  `agents.delete_agent` records `archived` and `purgeAt`; the server adds
  `agents.temporary.expired`, `agents.temporary.purged`,
  `agents.temporary.pinned` and `agents.temporary.unpinned`.

Every answer that carries entries stays under 800 KB of JSON. A page that
would be larger keeps its newest entries and continues with `next_cursor`.
A truncated `read_transcript` says so in `next`. Each entry's text is capped
at 16,000 characters, and a reply at 32,000.

Results: `await_turn` and a `blocking` send answer `{finished, reply,
status}`. An empty `reply` with `finished: true` means the turn ended without
text. `finished: false` comes with `next`, telling the caller to wait again
with the same handle. Entries are `{cursor, id, thread_id, role, at, from,
kind, text}`, oldest first. Here `at` is unix milliseconds and `kind` is
`text`, `note` or `tool`. Tool steps carry only the tool's name, never its
input or output, and reasoning is never included. A page's `next_cursor`
reads the entries just before it.

## Guarantees

- **Hidden conversations**: every prompt lands in a hidden conversation owned
  by the caller (#291/#302), never in the person's own chat with the agent. A
  caller's later sends continue the same conversation. `supersede` interrupts
  only that conversation.
- **Isolation**: a bot reaches only its peers. That means the same team and
  scope, the per-pair allow-list, and never a hidden bot. A person reaches
  what `GET /api/bots` shows them, and nothing else exists for them (404
  `unknown_agent`).
- **Handles** are HMAC-signed with a server key (`agent-api.key`, mode 0600)
  and bound to the caller and the agent. They expire after 7 days.
- **One hop**: a prompt a bot received from another agent cannot be passed on
  (409 `too_deep`).
- **Approval gate**: a bot whose peer contact needs review raises the
  `delegate_bot` card before its prompt goes out.
- **Scopes**:
  - Bots hold `agents.read` and `agents.send`. A Primary Bot that is not
    read-only also holds `agents.create`.
  - `agent-api-grants.json` in the data directory narrows this per bot:
    `{"bots": {"<id>": ["agents.read"]}}`. An empty list removes the tools.
  - For people, the scopes come from `clients.botsRead`, `clients.botsMessage`
    and `clients.agentsCreate`, which is off by default.
- **Rate limits** are per caller and tool, over a sliding minute or hour:

  | Tools | Limit |
  |---|---|
  | reads | 240 per minute |
  | `send_prompt` | 30 per minute |
  | `create_agent` | 5 per hour |
  | `delete_agent` | 30 per hour |

  Going over answers 429 with `retry_after_ms`.
- **Audit**: every call is written to the admin activity log (`category:
  client`, action `agents.<tool>`). Each entry records the outcome, the
  agent and the mode, but never the prompt, the reply or a file.
- **Deleting**: `delete_agent` archives temporary agents only; a lasting
  agent is deleted by its owner in Sagax.

## Files

A bot names files relative to its workspace or conversation folder. Paths
are resolved with realpath and confined to those roots. An AI client sends
the bytes (`{path, content_base64}`), and the request can be up to 64 MiB.
The files are copied to the target's workspace under `inbox/<sender>/`, and
the prompt names them.

**On a computer.** The files land in the Sagax workspace on the host, and
the prompt says so. A bot that works on a VM, a cloud computer or a shared
desktop reads them with its host file tools and copies over what it needs.
Nothing syncs them automatically.

**Size per call.** An AI client's request through Perspicax carries base64,
which is a third larger than the files themselves. Keep one call under about
45 MiB of files. For more, send several `send_prompt` calls with `on_busy:
queue`, each with its share of the files. A bot's own send has no
request-size limit, beyond 8 files of 25 MiB each.

