# What a member needs an admin for (audit, 2026-10-19)

On an organization server (Perspicax sign-in), this is everything that can
send a member, or a member's bot, to an organization admin. The rule it is
measured against (JC, 2026-10-19):

- **Own destinations and own data: the person's normal level, never an
  admin.** Their cloud computer (server environment, `sagax-environment`),
  their own computer and its Local VM (`sagax-desktop`), their own bots,
  threads, memory, vault and devices.
- **Reserved, but delegable in Perspicax** (a person or a team, through a
  permission set or "Who has what"): the shared server host, the
  organization's secrets, organization-wide data and settings, creating or
  deleting shared objects.
- **Admin only, not delegable:** only what would change admin rights
  themselves.

The other guardrails stay whatever the rule: the approval level of each
call, security keys (step-up), confidential conversations, the safety review,
the person's own deny and ask rules, and the audit log.

Where: **own** = the person's own destination or data; **host** = the shared
server host; **org** = organization data, settings or secrets;
**rights** = admin rights themselves.

## 1. Bot tool calls (approval cards)

| Tool or action | Where it runs | Before | After | Why |
|---|---|---|---|---|
| `sagax-desktop` `run_command`, `write_file`, `browse`, `fetch_url`, ... on the owner's own computer | own | admin card | the owner's card; their permission mode and rules never answer it (always a card, or Full) | It is their own machine. It is not isolated, so no automatic answer (security review). |
| `sagax-desktop` `read_file`, `list_files`, `search_files` inside the Sagax attachments folder of their own computer | own | admin card | no card, at any level, owner's own turn only, after the safety hold, their rules and their key | The files they sent the bot. Paths normalized (backslashes, `\\?\`, 8.3 short names, case); `..` refused; the folder must look like `<temp>/Sagax/attachments`. |
| `sagax-desktop` `local_vm` | own | owner card at Auto only while autonomy is on, otherwise admin | owner card; unasked at Auto while autonomy is on (unchanged) | The Local VM on their machine is isolated. |
| `sagax-environment` tools (their cloud computer) | own | unasked at Auto while autonomy is on; **admin card when autonomy is off** | unasked at Auto while autonomy is on; otherwise the owner's card | Their own isolated sandbox. |
| `sagax-environment` `read_file`, `list_files` in `/workspace/attachments` | own | as above | no card, owner's own turn | The files they sent. |
| A shell or file tool of the engine itself (Bash, Read, Write, Edit, Glob, Grep, WebFetch...) | host | withheld on every organization turn (admins too); a stray one is an admin card | unchanged; the card goes to the owner by hand if they hold `host.commands`, for their own turn only | It would run in the Sagax server's container. |
| Same, owner holds `host.commands` | host | admin card | owner's card, answered by hand only (no mode, rule, saved command or Always allow); checked again at the answer | Delegable right to the shared host. |
| `agents` `offer_shell_terminal` (the terminal card) | own | **admin card** on engines that ask first: the shell name pattern read `_shell_` in its name as a server command | the owner's card (judged by its exact name first) | It only stages a card the person approves; the terminal opens on their own destination. |
| Built-in `agents` tools in the member's own scope (`member-tool-scope.ts`: reads, conversation, memory, own setup, terminal offer) | own | owner card | unchanged | Already the owner's. |
| `agents` host-level tools: `act`, `add_mcp_server`, `attach_file`, `vm_exec`, `manage_settings`, `api_reload`, `review_write`, cloud-agent tools | host / org | admin card (pre-allowed on Claude, see note) | unchanged; delegable through `host.commands` for the owner's own turn | Each reaches the server or organization settings (`member-tool-scope.ts` lists why). |
| `agents` `shared_computer` | own (organization: the speaker's own desktop) | admin card | unchanged in this pass | The card's answerer is the bot owner while the desktop is the speaker's; moving it needs the card to go to the speaker (see Open points). |
| `agents` `manage_pairing` | own | admin card | unchanged in this pass | The route itself is open to members; to reclassify with the tool scope list. |
| MCP servers acting through the owner's identity (their remote servers, personal connections, claude.ai connectors on their own subscription) | own | owner card | unchanged | Already the owner's. |
| Other MCP servers (`browser`, `computer`, `files`, `shell`, `terminal`, a server's own MCP server) | host | admin card | unchanged; delegable through `host.commands` | Run on the shared host. |
| Always allow, session allow, remembered command on a member's bot | rights | stripped or refused for every card | unchanged | Standing grants on member bots are a separate decision (Open points). |
| Custom approval level (`config.toml`) | host | runs as Ask, cannot be set | unchanged | The file lives on the shared server. |
| Full access on a member's bot | own | `bots.fullAccess` + the organization's Full policy + consent | unchanged | Already delegable. |
| Auto levels while the admin turned `memberAutoApproval` off | org | Ask | unchanged | An organization policy. |

Note on `agents` tools: Claude pre-allows the whole `agents` server, so most
of these never reach a card on Claude; the rule above bites on engines that
ask first (Grok and the other ACP engines, Codex).

## 2. In-chat terminal

| Destination | Before | After |
|---|---|---|
| Their cloud computer, Local VM, own computer, from a conversation with their own bot | allowed | allowed |
| Same, from their own conversation with a bot someone shared with them | refused (not their bot) | allowed (the shell is theirs; answering someone else's card opens nothing) |
| A host of the organization's server (the Sagax server, SSH, unRAID) | admin only, not delegable | admin, or `host.commands` given in Perspicax |

## 3. MCP permission catalogue (`server/mcp-permissions.ts`)

Mode on GOX: `shadow` (unset): a denial is audited (`mcp.shadow`), nothing is
refused. The tiers matter once a server runs `SAGAX_MCP_PERMISSIONS=enforce`.

A turn no person speaks in (a routine, a webhook: role `service`) never gets
`manage_pairing`, `request_login`, `propose_team_setup`, `rules_update` or
`docs_update`, whatever their tier: they need the person, could create bots
under Full access, or would write lasting instructions from untrusted text.

| Tool | Where | Before (member) | After (member) | Why |
|---|---|---|---|---|
| `rules_update`, `docs_update` | own (the bot's own RULES.md and docs) | admin tier (denied) | own | Own data. |
| `request_login` | own (their own vault; the value never reaches the bot) | admin tier | own | Own data. |
| `select_computer` | own (picks among their own places) | admin tier | own | Own destination. |
| `manage_pairing` | own (create: a code bound to the speaking person and capped to their scopes, on an organization server; list stays an admin route) | admin tier | own; the engine gate still treats it as host level (section 1) | Own devices. |
| `propose_team_setup` | own (a card for their own team of bots) | admin tier | own, self scope | A proposal they confirm. |
| `propose_team_memory` | org (memory the whole section reads) | admin tier | unchanged | Organization data. |
| `create_bot`, `propose_bot_deletion`, `create_room`, `manage_room` | own (self scope override) | allowed at self | unchanged | Already. |
| `create_agent`, `delete_agent` | own (a temporary agent of theirs) | admin tier | unchanged; gated by `clients.agentsCreate` on the client side | Already delegable there. |
| `add_mcp_server` | host (a program on the server) | admin tier | unchanged | Shared host. |
| `request_credential` | org (server keys) | admin tier | unchanged | Organization secrets. |
| `shared_computer`, `vm_exec` | host or another person's machine | admin tier | unchanged | See section 1. |
| `act` | any route, under the person's own rights | admin tier | unchanged | Mixed; the route checks the person. |
| `manage_settings`, `api_reload` | org settings | admin tier | unchanged | Organization settings. |
| `review_write` | org (an approval decision) | admin tier | unchanged | Perspicax applies the person's own grants. |
| `memory_promote`, `memory_review` | org (Perspicax) | admin tier | unchanged | Organization memory. |

## 4. Permission keys (`shared/permissions.ts`)

| Key | Where | Before | After |
|---|---|---|---|
| `host.commands` (new) "Run commands on the organization's server" | host | did not exist | grantable, off by default; label says it is admin-equivalent on the server machine |
| `host.shell` "Change the server's own setup" | host | admin only | admin only (this pass) |
| `backup.workspace` | org | admin only | admin only (this pass) |
| `server.settings` | org | admin only | admin only (this pass) |
| `people.manage` | org (other people's accounts) | admin only | admin only (this pass) |
| `server.link` | rights (who may sign in at all) | admin only | admin only, by rule |

The four keys marked "this pass" stay admin only for now because their gates
are the admin scope itself (every admin route not listed in
`PERMISSION_ROUTES`), not one call site: making them delegable means mapping
each of their routes to its key in `server/request-auth.ts`. That is the next
change, see Open points.

## Open points

1. **Delegate the remaining admin-only keys** (`host.shell`, `backup.workspace`,
   `server.settings`, `people.manage`): map their routes in
   `PERMISSION_ROUTES`, then turn `adminOnly` off. `server.link` stays.
2. **A shared bot used by someone else:** the speaker's own destination is
   mounted, but the card's answerer is the bot owner, so it stays an admin
   card (fails closed). The card must go to the speaker before it can lift.
3. **Standing grants on member bots** (Always allow, session allow,
   remembered command): still stripped. Safe to open for own-destination
   tools once the grant is tied to the person whose destination it is.
4. **`shared_computer`** on an organization server acts on the speaker's own
   desktop: same as point 2.
5. Hardening noted by the security review, not blocking: a link inside the
   attachments folder on the person's computer (only they can create one,
   with a command they approved), case folding on a case-sensitive macOS
   volume, matching a late request to the turn generation.
