// Which built-in Sagax tools a member's bot runs on an organization server
// without an organization admin (JC, 2026-10-08).
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
  start_thread: "conversation",
  close_thread: "conversation",
  retry_thread: "conversation",
  create_options_card: "conversation",
  send_voice_note: "conversation",
  request_credential: "conversation",
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
});

/** The agents tools that keep the admin gate, and why:
 *   act             any /api route or a plugin install, as the bot
 *   add_mcp_server  starts a local program on the server
 *   attach_file     reads any path on the server into the chat
 *   vm_exec         a shell command
 *   shared_computer files, a terminal or the screen of a shared desktop */
export const HOST_LEVEL_AGENT_TOOLS: ReadonlySet<string> = new Set(["act", "add_mcp_server", "attach_file", "vm_exec", "shared_computer"]);

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
