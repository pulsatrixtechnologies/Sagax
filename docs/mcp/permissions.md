# MCP permissions

One permission per action, named `resource:verb` (`memory:save`,
`claims:acquire`, `routines:propose.action`). The registry is
`server/mcp-permissions.ts`; the inventory is `coverage.md`.

## Rules

1. **Deny by default.** A tool with no registered permission, a role that is
   not one of the five, or a tier a role does not hold is refused.
2. **Scope.** Every grant has a widest scope: `self` < `team` < `org`. A call
   reaches a scope (`scopeForCall`): another bot, a room, group or team
   argument means `team`; `scope: "org"` means `org`; otherwise `self`. The
   call is allowed only when the role's grant is at least as wide.
3. **Audit on every call, allowed and denied.** One record per call:
   time, principal, role, tool, permission, scope, decision, reason, and
   whether the denial was enforced. It never holds arguments, message text or
   results. It goes to the server's activity log (see Audit below), with a stderr
   `[mcp-audit]` line as the fallback. A sink
   that throws never changes the decision.
4. **Mode.** `SAGAX_MCP_PERMISSIONS`: `off`, `shadow` (default: denials are
   audited and the call goes through, so existing bots keep working while the
   audit shows what would break), `enforce` (denials are refused with a
   sentence naming the permission).
5. **Identity.** `SAGAX_MCP_ROLE` (default `member`), `SAGAX_MCP_PRINCIPAL`
   (default the bot id), `SAGAX_MCP_TEAMS`. The harness sets these when it
   builds the integration; the server remains the authority on what a route
   allows, this layer only narrows.

## Tiers

| Tier | Meaning |
|---|---|
| read | changes nothing |
| own | the caller's own work: memory, skills, files, widgets, reactions, proposals |
| dispatch | puts other bots, people, routines or cloud agents to work |
| claim | holds on shared work (acquire, renew, release) |
| admin | creates bots, rooms or credentials, edits shared rules, runs host commands, pairing, settings |

## Roles (widest scope per tier)

| Role | read | own | dispatch | claim | admin |
|---|---|---|---|---|---|
| viewer | team | no | no | no | no |
| member | team | self | self | self | no (a few self-scope exceptions: create a bot or room of their own) |
| operator | team | team | team | team | no |
| admin | org | org | org | org | org |
| service | team | self | self | self | no (and never `vm:exec` or `actions:invoke`) |

The `service` role holds claims at `self`: automation can hold work it
started, not take over someone else's.

## Dynamic keys

Gateway APIs are many. An `api_query`, `api_write` or `api_action` call names
an API, a resource and a verb; the guard derives `<api>:<resource>.<verb>`
(`cw:ticket.update`; a query is `.read`). A call is allowed when the role
holds the tier permission and no deny rule matches the derived key.
`SAGAX_MCP_DENY` lists the rules, comma separated: an exact key,
`cw:ticket.*` or `cw:*`. A denied key is reported as `resource_denied` and the
audit row carries `resource`. Segments must be plain slugs; when a catalog of
the Perspicax APIs is passed to the guard (`ApiCatalog`), a name it does not
list gives no key. Reading that catalog from Perspicax at turn time is not
wired yet.

## Where the guard runs

- The agents proxy, for every Sagax tool.
- `PerspicaxMcp.relay` (and so `callTool`), for every `tools/call` relayed to a
  Perspicax profile, with the same mode and identity.

Identity is set by the harness when it builds the integration
(`mcpIdentityEnv`): the speaking person, their role (Perspicax admin is
`admin`, manager is `operator`, anyone else `member`) and teams; a turn with
no person is `service`.

## Audit

Both guards write to the server's activity log (category `security`, actions
`mcp.call`, `mcp.shadow`, `mcp.deny`) through `POST /api/internal/mcp-audit`
for the proxy and directly for the relay. Only the whitelisted fields of the
record are kept. If the server cannot be reached, the proxy writes the
`[mcp-audit]` line on stderr.

## Adding a tool

Add the tool to the catalog, add its row to `MCP_PERMISSIONS` with a tier,
and update `coverage.md`. The registry test fails while a catalog tool has no
permission. Never rename a key; retire it and add another.
