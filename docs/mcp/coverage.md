# MCP coverage: Sagax and Perspicax capabilities vs MCP tools

Inventory of what the Sagax server and the Perspicax gateway can do, against
the tools the Sagax MCP ("agents" server, `server/drivers/agents-catalog.ts`)
exposes to a bot or an AI client. The machine-readable form is the registry in
`server/mcp-permissions.ts`; `server/mcp-permissions.test.ts` fails when a
catalog tool has no permission.

Totals: capabilities 105, covered 97, gaps 8.

Sources read: the agents tool catalog, the internal routes it calls
(`/api/internal/*`), the member API (`docs/org-member-api.md`), and the
Perspicax tool surface (`docs/mcp-surface.md` there): API meta-tools, the
per-API query/write/action tools, the memory tools, flow and review tools.

Reading the table:

- **covered**: one MCP tool carries it, and it is now gated by the permission
  shown.
- **MISSING**: no Sagax MCP tool. Some Perspicax gaps (`api:*`, `memory:*`,
  `flow:action`) are reachable by a bot today through the Perspicax bridge
  (`server/perspicax-mcp.ts`, a profile mounted on the turn). That path is
  governed by the profile's own grant in Perspicax, not by these permissions
  yet; bringing it under them is part of the gap.
- Per-API fine grain (for example a ticket update in a PSA) is not a separate
  registry row: it is the `api:write` permission narrowed by a resource rule,
  `<api>:<resource>.<verb>` such as `cw:ticket.update`, resolved from the
  Perspicax catalog at call time (see `permissions.md`, "Dynamic keys").
- Priority: P0 = coordination safety (claims); P1 = day-to-day work; P2 =
  administrative.

| Capability | Source | MCP tool | Proposed permission | Priority / status |
|---|---|---|---|---|
| bots:list | sagax | `list_bots` | `bots:list` | covered |
| rooms:list | sagax | `list_rooms` | `rooms:list` | covered |
| rooms:targets | sagax | `list_room_targets` | `rooms:targets` | covered |
| threads:list | sagax | `list_threads` | `threads:list` | covered |
| teamsetup:list | sagax | `list_team_setup` | `teamsetup:list` | covered |
| computers:list | sagax | `list_shared_computers` | `computers:list` | covered |
| terminal:list | sagax | `list_terminal_resources` | `terminal:list` | covered |
| delegation:check | sagax | `check_delegation` | `delegation:check` | covered |
| delegation:wait | sagax | `wait_delegation` | `delegation:wait` | covered |
| sessions:search | sagax | `session_search` | `sessions:search` | covered |
| sessions:read | sagax | `session_read` | `sessions:read` | covered |
| toolresult:read | sagax | `tool_result_read` | `toolresult:read` | covered |
| routines:list | sagax | `list_routines` | `routines:list` | covered |
| skills:list | sagax | `skills_list` | `skills:list` | covered |
| workspace:read | sagax | `workspace_read` | `workspace:read` | covered |
| workspace:search | sagax | `workspace_search` | `workspace:search` | covered |
| agents:list | sagax | `list_agents` | `agents:list` | covered |
| agents:find | sagax | `find_agents` | `agents:find` | covered |
| agents:await | sagax | `await_turn` | `agents:await` | covered |
| transcript:read | sagax | `read_transcript` | `transcript:read` | covered |
| transcript:page | sagax | `read_transcript_page` | `transcript:page` | covered |
| transcript:latest | sagax | `read_latest_page` | `transcript:latest` | covered |
| transcript:latest.threads | sagax | `read_latest_page_with_threads` | `transcript:latest.threads` | covered |
| transcript:cold | sagax | `read_transcript_cold` | `transcript:cold` | covered |
| cloudagents:list | sagax | `list_cloud_agents` | `cloudagents:list` | covered |
| cloudagents:get | sagax | `get_cloud_agent` | `cloudagents:get` | covered |
| cloudagents:find | sagax | `find_cloud_agent_by_pr` | `cloudagents:find` | covered |
| cloudagents:transcript | sagax | `cloud_agent_transcript` | `cloudagents:transcript` | covered |
| cloudagents:artifacts | sagax | `list_cloud_agent_artifacts` | `cloudagents:artifacts` | covered |
| memory:save | sagax | `memory_update` | `memory:save` | covered |
| memory:log | sagax | `memory_log` | `memory:log` | covered |
| groupmemory:save | sagax | `group_memory_update` | `groupmemory:save` | covered |
| files:attach | sagax | `attach_file` | `files:attach` | covered |
| widgets:show | sagax | `show_widget` | `widgets:show` | covered |
| widgets:update | sagax | `update_widget` | `widgets:update` | covered |
| cards:options | sagax | `create_options_card` | `cards:options` | covered |
| rooms:react | sagax | `react_to_message` | `rooms:react` | covered |
| rooms:unreact | sagax | `remove_reaction` | `rooms:unreact` | covered |
| rooms:post | sagax | `post_to_room` | `rooms:post` | covered |
| threads:close | sagax | `close_thread` | `threads:close` | covered |
| voice:note | sagax | `send_voice_note` | `voice:note` | covered |
| voice:end | sagax | `end_call` | `voice:end` | covered |
| skills:manage | sagax | `skill_manage` | `skills:manage` | covered |
| profile:propose | sagax | `propose_profile` | `profile:propose` | covered |
| model:propose | sagax | `propose_model` | `model:propose` | covered |
| routines:propose | sagax | `propose_routine` | `routines:propose` | covered |
| routines:propose.action | sagax | `propose_routine_action` | `routines:propose.action` | covered |
| terminal:offer | sagax | `offer_shell_terminal` | `terminal:offer` | covered |
| bots:ask | sagax | `ask_bot` | `bots:ask` | covered |
| bots:delegate | sagax | `delegate_bot` | `bots:delegate` | covered |
| bots:send | sagax | `send_to_bot` | `bots:send` | covered |
| bots:coordinate | sagax | `coordinate_bots` | `bots:coordinate` | covered |
| agents:send | sagax | `send_prompt` | `agents:send` | covered |
| threads:start | sagax | `start_thread` | `threads:start` | covered |
| threads:retry | sagax | `retry_thread` | `threads:retry` | covered |
| cloudagents:launch | sagax | `launch_cloud_agent` | `cloudagents:launch` | covered |
| cloudagents:followup | sagax | `cloud_agent_follow_up` | `cloudagents:followup` | covered |
| cloudagents:cancel | sagax | `cancel_cloud_agent` | `cloudagents:cancel` | covered |
| cloudagents:archive | sagax | `archive_cloud_agent` | `cloudagents:archive` | covered |
| bots:create | sagax | `create_bot` | `bots:create` | covered |
| bots:delete.propose | sagax | `propose_bot_deletion` | `bots:delete.propose` | covered |
| agents:create | sagax | `create_agent` | `agents:create` | covered |
| rooms:create | sagax | `create_room` | `rooms:create` | covered |
| rooms:manage | sagax | `manage_room` | `rooms:manage` | covered |
| teamsetup:propose | sagax | `propose_team_setup` | `teamsetup:propose` | covered |
| teammemory:propose | sagax | `propose_team_memory` | `teammemory:propose` | covered |
| rules:update | sagax | `rules_update` | `rules:update` | covered |
| docs:update | sagax | `docs_update` | `docs:update` | covered |
| mcp:add | sagax | `add_mcp_server` | `mcp:add` | covered |
| credentials:request | sagax | `request_credential` | `credentials:request` | covered |
| computers:select | sagax | `select_computer` | `computers:select` | covered |
| computers:use | sagax | `shared_computer` | `computers:use` | covered |
| vm:exec | sagax | `vm_exec` | `vm:exec` | covered |
| actions:invoke | sagax | `act` | `actions:invoke` | covered |
| claims:acquire | sagax | MISSING | `claims:acquire` | P0 |
| claims:renew | sagax | MISSING | `claims:renew` | P0 |
| claims:release | sagax | MISSING | `claims:release` | P0 |
| claims:list | sagax | MISSING | `claims:list` | P1 |
| memory:search | perspicax | `memory_find` | `memory:search` | covered |
| memory:recall | perspicax | MISSING | `memory:recall` | P1 |
| memory:write | perspicax | `memory_save` | `memory:write` | covered |
| memory:forget | perspicax | `memory_remove` | `memory:forget` | covered |
| memory:feedback | perspicax | MISSING | `memory:feedback` | P1 |
| memory:promote | perspicax | MISSING | `memory:promote` | P2 |
| memory:propose | perspicax | `memory_suggestions` | `memory:propose` | covered |
| memory:review | perspicax | MISSING | `memory:review` | P2 |
| approvals:answer | sagax | `answer_approval` | `approvals:answer` | covered |
| routines:run | sagax | `run_routine` | `routines:run` | covered |
| people:nudge | sagax | `nudge_person` | `people:nudge` | covered |
| api:list | perspicax | `api_list` | `api:list` | covered |
| api:search | perspicax | `api_search` | `api:search` | covered |
| api:describe | perspicax | `api_describe` | `api:describe` | covered |
| api:lookup | perspicax | `api_lookup` | `api:lookup` | covered |
| api:plan | perspicax | `api_plan` | `api:plan` | covered |
| api:resultquery | perspicax | `api_resultquery` | `api:resultquery` | covered |
| api:upload | perspicax | `api_upload` | `api:upload` | covered |
| api:reload | perspicax | `api_reload` | `api:reload` | covered |
| identity:search | perspicax | `identity_search` | `identity:search` | covered |
| api:query | perspicax | `api_query` | `api:query` | covered |
| api:write | perspicax | `api_write` | `api:write` | covered |
| api:action | perspicax | `api_action` | `api:action` | covered |
| flow:action | perspicax | `flow_action` | `flow:action` | covered |
| review:write | perspicax | `review_write` | `review:write` | covered |
| pairing:manage | sagax | `manage_pairing` | `pairing:manage` | covered |
| settings:manage | sagax | `manage_settings` | `settings:manage` | covered |


## Gap summary by priority

Remaining gaps (8):

- P0/P1: `claims:acquire`, `claims:renew`, `claims:release`, `claims:list`. The
  native claim tools (`claim`, `claim_renew`, `claim_release`, `claim_list`)
  are in pull request #497; map them here when it merges.
- P1: `memory:recall`, `memory:feedback` (Perspicax memory v1 only; the v2
  tools are `memory_find`, `memory_save`, `memory_remove`,
  `memory_suggestions`, see Sagax #496 and Perspicax #326).
- P2: `memory:promote`, `memory:review` (a person's decision in the console;
  v2 `memory_suggestions` accept/reject is refused to AI clients).

Closed here: `approvals:answer` (`answer_approval`), `people:nudge`
(`nudge_person`), `pairing:manage` (`manage_pairing`), `settings:manage`
(`manage_settings`): thin wrappers over `act`, so the person's rights and the
bot's approval mode still decide. The Perspicax gateway tools (`memory_*`,
`api_*`, `flow_action`, `identity_search`, `review_write`) are listed only on an
organization server linked to Perspicax (`SAGAX_PERSPICAX_TOOLS`) and
forwarded by `/api/internal/perspicax/tool` to the profile mounted in the turn,
after the misuse and safety review. Per-API fine grain (`cw:ticket.update`)
still waits for catalogue resolution.
