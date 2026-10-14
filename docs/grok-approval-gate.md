# Grok approval gate (Sagax gates MCP calls; Grok runs in default mode)

## Why
In `--permission-mode auto`, Grok runs its safety classifier before **every** MCP tool call. On production this measured 4–9 s (up to 17 s, and once an approval card for the read-only `agents__list_bots`) for tools that answer in under 0.5 s. Allow rules do not skip it over ACP (repro below). In `default` mode Grok runs MCP tools supplied by the ACP client with no prompt at all, so Sagax gates them itself.

## How it works
- **Flag:** `DATA_DIR/grok-approval-gate.json`, either `{"bots": ["<botId>"]}` or `{"bots": "all"}`. A missing, empty or invalid file means off, and Grok runs in auto mode as before. The file is read on every turn; the next turn of each bot respawns Grok in the new mode.
- **Scope:** only Auto turns (`approvalMode: "auto"`, not Full access). Ask, Edits and Full access are unchanged.
- **When the flag is on:**
  - Grok starts with `--permission-mode default`. Its built-in tools still prompt through ACP, and their cards are unchanged.
  - Every MCP server, built-in or not, is mounted through `mcp-gate` with an approval socket (`server/mcp-gate-approval.ts`).
  - Only reviewed read-only tools run unasked:
    - agents: `READ_ONLY_AGENT_TOOL_NAMES`
    - harness-spawned Perspicax bridges: `PERSPICAX_READ_ONLY_TOOLS`
  - The agents server's teammate tools (`PEER_REVIEWED_AGENT_TOOL_NAMES`: `coordinate_bots`, `ask_bot`, `delegate_bot`, `send_to_bot`, `post_to_room`) pass **only while peer review is ACTIVE** for that turn (`approvePeerComms` and not Full access, `peerReviewRequired`). They are not reads: the bot's own "Ask me before contacting other bots" then decides them on the server with its own card, and the server's depth, queue and room budgets bound them at every level. With the revue **off** they wait at this gate (fail closed). Covered by `server/drivers/acp/grok-approval-gate.test.ts` ("revue off") and `server/gate-allow-rule.e2e.test.ts`.
  - Every other call, including unknown, new and third-party tools, waits for a canonical approval card. A server's own `readOnlyHint` is ignored. The card's note says this bot asks before any action that changes something (`approval.held.gate`), never that the provider asked.
- **Always allow:** answering a gate card with Always allow saves `mcp:<server>__<tool>` in the bot's Always allowed list (Access settings) and in that conversation.
  - **Granularity:** an MCP key is that exact tool of that exact server, **any arguments** (`mcpAllowKey`). A later call of the same tool with different arguments is the same rule. Peer keys (`ask_bot`, `delegate_bot`, `post_to_room`) name the action and the **target id**, not the message (`peerAllowKey`).
  - **Who it covers:** the bot's list is the standing rule for **every conversation of that bot, whoever is speaking** (the owner or a member the bot is shared with). There is no per-person Always allow. A person who may answer the card but not edit the bot keeps the rule to that conversation only.
  - **Revocation:** removing a key in Access (`store.revokeAlwaysAllow`) drops **that key** from the bot and from every conversation. Other keys a conversation holds stay. A thread-only grant of the same key is dropped too: Access said that tool is no longer always allowed, anywhere.
  - A live turn token (`Authorization: Bearer` of an internal capability) cannot register a rule (`403 turn_cannot_self_approve`). Covered by `server/gate-allow-rule.e2e.test.ts`.
- **Fail closed:** a decline, the 15 min timeout, a stopped turn, no running turn, a closed or unreachable socket, an answer other than an explicit allow, a corrupt config, and JSON-RPC batches or unreadable frames all mean the call never reaches the server.
- **No replay in the driver:** each call is its own card at the gate, and an "always" answer is not reused by the driver. Only the server's saved Allow rule (above) answers a later card.

## Rollback
Remove the bot from the flag file (or delete the file). That needs no deploy.

## Grok bug: allow rules do not skip the auto classifier over ACP
xAI has no public issue tracker (`xai-org/grok-build` has issues disabled), so the repro lives here.

**Docs claim** (user guide 22-permissions-and-safety, "How a tool call is authorized"): rules (`--allow`, `[permission] allow`) are evaluated before the mode's prompt policy, where the auto classifier runs.

**Observed** with grok 1.0.46 (server) and 1.0.50 (Mac), `grok --permission-mode auto [rules] agent stdio`:
1. The client is `initialize` with `clientInfo: {name: "openmausbot"}`.
2. `session/new` passes one stdio MCP server `clock` with one tool, `query_time`.
3. The prompt is "call clock__query_time once".

The classifier gap is the time between `pending_interaction kind=permission` and `interaction_resolved`:

| Mode / rule | Gap | Card |
|---|---|---|
| auto, no rule | 4.5 s | none |
| auto, `--allow 'MCPTool(clock__query_time)'` | 7.9 s | none |
| auto, project `.grok/config.toml` `[permission] allow = ["MCPTool(clock__query_time)"]` | 6.7 s | none |
| auto, `--allow MCPTool` | 7.3 s | none |
| auto, `--allow mcp__clock__query_time` | 6.1 s | none |
| auto, `--allow '*'` | 6.8 s | none |
| default, any rule or none | 0 s | none (the tool runs) |

On production, the live ACP wire log shows `pending_interaction` for `agents__list_bots` from 00:25:43.001 to 00:25:51.474 UTC, with `--allow MCPTool(agents__list_bots)` on argv.

PreToolUse hooks cannot pre-approve: per the docs, a hook "allow" only means "not blocked".

## Production finding: Grok's `use_tool` ask (2026-10-11)

The first live gated turn (Cryptic, thread 84c81700…, 2026-10-12T01:04Z)
showed that with many MCP tools mounted (158 in production) Grok defers them
behind its `use_tool` meta tool, whose `_meta["x.ai/tool"].read_only` is
false. In `default` mode Grok therefore sends `session/request_permission`
for every MCP call, reads included:

```json
{"toolCall":{"kind":"other","title":"agents__list_bots",
  "rawInput":{"variant":"UseTool","tool_name":"agents__list_bots","tool_input":{}},
  "_meta":{"x.ai/tool":{"name":"use_tool","kind":"use_tool","read_only":false}}},
 "options":[{"optionId":"always-allow","kind":"allow_always"},
            {"optionId":"allow-once","kind":"allow_once"},
            {"optionId":"reject-once","kind":"reject_once"}]}
```

The local repro had a handful of tools, so Grok called them directly and never
asked. On a gated turn the driver now answers that ask **allow once** (never
always) only when every name in it resolves to one of the turn's gated mounts
(`server/drivers/acp/gated-mcp-ask.ts`): the call then reaches the MCP gate,
which runs it only if it is a reviewed read and otherwise holds it for the
person's card. Built-in tools, commands, file changes, unmounted servers and a
`use_tool` without a target keep their card.
