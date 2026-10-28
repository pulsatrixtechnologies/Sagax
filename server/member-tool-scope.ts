// Which built-in Sagax tools a member's bot runs on an organization server
// without an organization admin (2026-10-08).
//
// The admin gate (memberBotAdminApproval in ./engine-access.ts) exists
// because every bot shares one container, one user and one HOME: a shell
// command, a file outside the bot's own workspace or a new local MCP server
// is as good as a command on the server. The built-in agents tools below do
// not touch the host: each one is served by a Sagax route that already
// checks who the bot is, who it speaks for and what it may reach (its own
// bots, threads, rooms, routines, memory and skills, and the bots shared
// with its person). Gating them behind an admin blocked a member's bot from
// answering "which bots do you see". They now follow the member's own
// approval level for their own bot, as any owner's tool does.
//
// The rule is a reviewed list, never a prefix or a name pattern: a tool
// added to the agents catalog is host-level (admin gate) until it is
// classified here. member-tool-scope.test.ts fails on an unclassified tool.

import { READ_ONLY_AGENT_TOOL_NAMES } from "./agent-tool-policy.ts";

/** Why an agents tool stays inside the member's own scope. */
export type MemberToolFamily =
  /** reads of the bot's own team, threads, routines, skills, sessions */
  | "read"
  /** talking to the bot's own teammates, rooms and threads, or to its person */
  | "conversation"
  /** the bot's own memory and its room's shared memory */
  | "memory"
  /** the bot's own setup: proposals its person confirms, its skills, its rooms */
  | "own-setup";

const READ = Object.fromEntries([...READ_ONLY_AGENT_TOOL_NAMES, "list_room_targets"].map((name) => [name, "read" as const]));

/** The agents tools a member's bot runs under its own approval level. */
export const MEMBER_OWN_SCOPE_AGENT_TOOLS: Readonly<Record<string, MemberToolFamily>> = Object.freeze({
  ...READ,
  ask_bot: "conversation",
  send_to_bot: "conversation",
  delegate_bot: "conversation",
  coordinate_bots: "conversation",
  post_to_room: "conversation",
  react_to_message: "conversation",
  remove_reaction: "conversation",
  start_thread: "conversation",
  route_message: "conversation",
  close_thread: "conversation",
  retry_thread: "conversation",
  create_options_card: "conversation",
  ask_choice: "conversation",
  // the person's own rights decide through act; a nudge is rate limited
  run_routine: "conversation",
  answer_approval: "conversation",
  nudge_person: "conversation",
  // Perspicax gateway tools (PERSPICAX_TOOLS): Perspicax applies the person's
  // grants; the admin ones (api_reload, review_write) are host level below
  memory_recall: "read", memory_search: "read", memory_feedback: "read",
  memory_write: "memory", memory_propose: "memory", memory_forget: "memory",
  api_list: "read", api_search: "read", api_describe: "read", api_lookup: "read",
  api_plan: "read", api_result_query: "read", identity: "read", flow: "read",
  api_upload: "conversation", flow_action: "conversation",
  remote_support_open: "conversation", remote_support_status: "conversation", remote_support_close: "conversation",
  // chat widgets (agents-widget-tools.ts): a card in the member's own conversation
  check_widget: "read",
  show_widget: "conversation",
  update_widget: "conversation",
  // live HTML apps (agents-app-tools.ts): a card in the member's own conversation
  show_html: "conversation",
  update_html: "conversation",
  // artifacts (agents-artifact-tools.ts): the bot's own saved widgets; a
  // source runs alone only when it needs no approval (artifact-refresh.ts)
  save_artifact: "conversation",
  update_artifact: "conversation",
  list_artifacts: "read",
  delete_artifact: "conversation",
  // a page proposal: a card in the member's own conversation; publishing is theirs
  propose_page: "conversation",
  // a phone call: a card in the member's own conversation, through their own Twilio profile
  place_phone_call: "conversation",
  send_voice_note: "conversation",
  end_call: "conversation",
  request_credential: "conversation",
  request_login: "conversation",
  // a sign-in card in the member's own conversation, for their own engine account
  open_connector_setup: "conversation",
  // claims (perspicax-claims.ts): a lease in Perspicax held by this bot for
  // its person, through the turn's own Perspicax token; claim_list is a read
  claim: "conversation",
  claim_renew: "conversation",
  claim_release: "conversation",
  memory_update: "memory",
  memory_log: "memory",
  group_memory_update: "memory",
  // the bot's own RULES.md and docs/ (server/workspace-files.ts)
  rules_update: "memory",
  docs_update: "memory",
  create_bot: "own-setup",
  create_room: "own-setup",
  manage_room: "own-setup",
  select_computer: "own-setup",
  skill_manage: "own-setup",
  propose_routine: "own-setup",
  propose_routine_action: "own-setup",
  propose_profile: "own-setup",
  propose_model: "own-setup",
  propose_team_memory: "own-setup",
  propose_team_setup: "own-setup",
  propose_bot_deletion: "own-setup",
  archive_bot: "own-setup",
  // every setting as the member (server/settings-actions.ts): the member's
  // own rights decide on the route the screen calls, a card otherwise
  sagax_settings: "own-setup",
  // #1269: act runs as the signed-in person (server/bot-act.ts). A read
  // with no effect of the member's own bot is their own card
  // (ownBotReadAct). A write, or a call on someone else's bot, stays an
  // admin card (memberBotAdminApproval): own-setup here only lets the read
  // through, it does not drop the admin gate for the rest.
  act: "own-setup",
  manage_settings: "own-setup",
  // the member's own cards, at their request (server/primary-approvals.ts)
  sagax_approvals: "own-setup",
  // 2026-10-26: a pairing code for the member's own device; the route binds
  // the code to the person the turn speaks for, never anyone else, and a
  // turn no person speaks in never calls it (mcp-permissions.ts service)
  manage_pairing: "own-setup",
  // The in-chat terminal (2026-10-15): the list is what THIS person may
  // open (their own environments; the server's hosts for an admin only), and
  // the offer only stages a card the person approves; the server checks the
  // person's rights again when they open it (terminal-resources/registry.ts).
  list_terminal_resources: "read",
  offer_shell_terminal: "conversation",
  publish_remote_session: "conversation",
  // a usage card (server/resource-usage/): read-only, on a computer this
  // person already reaches; the target's own rights are checked
  resource_usage: "conversation",
  // the speaker's own Tailcat session: a fixed read, and one command that
  // asks unless it only reads (server/remote-session-exec.ts)
  remote_session_snapshot: "read",
  remote_session_exec: "conversation",
  // join_meeting only stages a consent card; the person approves each join
  join_meeting: "conversation",
});

/** The agents tools that keep the admin gate, and why:
 *   api_reload, review_write
 *                   Perspicax admin tools
 *   add_mcp_server  starts a local program on the server
 *   attach_file     reads any path on the server into the chat
 *   vm_exec         a shell command
 *   shared_computer files, a terminal or the screen of a shared desktop
 *   launch_cloud_agent, cloud_agent_follow_up, cancel_cloud_agent,
 *   archive_cloud_agent
 *                   a cloud coding agent run on a provider account */
export const HOST_LEVEL_AGENT_TOOLS: ReadonlySet<string> = new Set([
  "api_reload", "review_write", "add_mcp_server", "attach_file", "vm_exec", "shared_computer",
  "launch_cloud_agent", "cloud_agent_follow_up", "cancel_cloud_agent", "archive_cloud_agent",
]);

/** The agents tool a provider's tool name names, or null. Accepts the
 * spellings the engines report for Sagax's own `agents` MCP server:
 * `mcp__agents__list_bots` (Claude), `agents__list_bots` (ACP titles, the
 * OpenAI-compatible chat engines), `agents.list_bots` and `agents:list_bots`.
 * The name must be exact: no spaces, no other server. */
export function builtinAgentToolName(name: string | undefined): string | null {
  const match = /^(?:mcp(?:__|[.:]))?agents(?:__|[.:/])([a-z][a-z0-9_]{0,63})$/.exec(name ?? "");
  return match ? match[1]! : null;
}

/** The family of an agents tool a member's bot may run without an admin,
 * or null: host-level, unknown, or not an agents tool at all. */
export function memberOwnScopeTool(name: string | undefined): MemberToolFamily | null {
  const tool = builtinAgentToolName(name);
  if (!tool || HOST_LEVEL_AGENT_TOOLS.has(tool)) return null;
  return Object.hasOwn(MEMBER_OWN_SCOPE_AGENT_TOOLS, tool) ? MEMBER_OWN_SCOPE_AGENT_TOOLS[tool]! : null;
}

const ACT_ROUTE_KEYS = new Set(["method", "path", "query", "body"]);
const BOT_ID = /^[\w-]{1,80}$/;

function actRecord(input: unknown): Record<string, unknown> | null {
  let raw = input;
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) return null;
    try { raw = JSON.parse(text); } catch { return null; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** `/api/bots/<id>` of a bot `ownsBot` accepts, nothing else. `..`, an
 * encoding, a query in the path or another bot fail closed. */
function ownBotApiPath(path: string, ownsBot: (id: string) => boolean): boolean {
  let clean = path;
  if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
  if (!clean.startsWith("/api/bots/")) return false;
  if (clean.includes("//") || clean.includes("\\") || clean.includes("%") || clean.includes("?") || clean.includes("#")) return false;
  const rest = clean.slice("/api/bots/".length);
  const segments = rest.split("/");
  if (!rest || segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  const id = segments[0]!;
  return BOT_ID.test(id) && ownsBot(id);
}

/** #1269: `act` that only reads the member's own bot. GET or HEAD, no body,
 * on `/api/bots/<that bot>` (the same read the approval card badges
 * Read-only). A plugin `list` of that bot is the same call. A write, a
 * body, another bot, or a call we cannot prove, is not: those stay an
 * admin card. `ownsBot` is absent when the caller did not say which bots
 * are the member's, and then nothing passes. An omitted plugin `botId` is
 * the calling bot (`callerBotId`). */
export function ownBotReadAct(name: string | undefined, input: unknown, scope: { ownsBot?: (id: string) => boolean; callerBotId?: string } | undefined): boolean {
  if (builtinAgentToolName(name) !== "act" || !scope?.ownsBot) return false;
  const ownsBot = scope.ownsBot;
  const record = actRecord(input);
  if (!record) return false;
  if (record.plugins !== undefined && record.method === undefined && record.path === undefined && record.ui === undefined) {
    if (Object.keys(record).some((key) => key !== "plugins")) return false;
    const plugins = record.plugins;
    if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return false;
    const plugin = plugins as Record<string, unknown>;
    if (plugin.action !== "list") return false;
    if (Object.keys(plugin).some((key) => key !== "action" && key !== "botId")) return false;
    const id = plugin.botId === undefined ? scope.callerBotId : plugin.botId;
    return typeof id === "string" && BOT_ID.test(id) && ownsBot(id);
  }
  if (Object.keys(record).some((key) => !ACT_ROUTE_KEYS.has(key))) return false;
  if (typeof record.method !== "string" || typeof record.path !== "string") return false;
  const method = record.method.trim().toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if (record.body !== undefined && record.body !== null) return false;
  if (record.query !== undefined && (typeof record.query !== "object" || record.query === null || Array.isArray(record.query))) return false;
  return ownBotApiPath(record.path, ownsBot);
}
