// Grok without its per-call auto-mode wait: Sagax gates MCP writes itself.
//
// In `--permission-mode auto` Grok runs its safety classifier before every
// MCP tool call, 4-9 s each, and allow rules do not skip it over ACP
// (measured 2026-10-11 on grok 1.0.46 and 1.0.50, docs/grok-approval-gate.md).
// In `default` mode Grok runs client-supplied MCP tools with no prompt at
// all, so with this gate on Sagax:
// - starts Grok in `default` mode (its own built-in tools still prompt, and
//   their cards are unchanged);
// - mounts EVERY MCP server through the MCP gate with an approval socket;
// - lets only reviewed read-only tools through unasked (below), and holds
//   every other call, unknown, new and third-party ones included, until the
//   person approves its card. Declining, no answer, a closed channel or no
//   running turn all mean the call never reaches the server.
//
// Per-bot flag: DATA_DIR/grok-approval-gate.json, {"bots": "all"} or
// {"bots": ["<botId>", ...]}. Missing, empty or invalid = off = Grok's own
// auto mode, exactly as before. Read on every turn, so turning it off is a
// file edit (the next turn of each bot respawns Grok in auto mode).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../../config.ts";
import type { McpServerSpec } from "../../contracts.ts";
import { READ_ONLY_AGENT_TOOL_NAMES } from "../../agent-tool-policy.ts";
import { isFlowToolsServer, isPerspicaxBridge, PERSPICAX_READ_ONLY_TOOLS } from "./grok-read-only-tools.ts";
import { FLOW_TOOL_NAMES, FLOW_TOOLS_MCP_NAME } from "../../flow-tools.ts";
import { AUTO_COMPUTER_MCP_NAME } from "../../auto-computer.ts";
import { cloudOnlyBot } from "../../cloud-only-bots.ts";

export const GROK_APPROVAL_GATE_FILE = "grok-approval-gate.json";

/** Whether this bot's Grok turns run with the Sagax approval gate. */
export function grokApprovalGateEnabled(botId: string | undefined, dataDir: string = DATA_DIR): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dataDir, GROK_APPROVAL_GATE_FILE), "utf8"));
  } catch {
    return false;
  }
  const bots = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { bots?: unknown }).bots : undefined;
  if (bots === "all") return true;
  if (!botId || !Array.isArray(bots)) return false;
  return bots.some((id) => typeof id === "string" && id === botId);
}

/** The reviewed read-only tools of one mounted server, by upstream name.
 * Only Sagax's own agents server (its reviewed catalog, the same one that
 * sets its readOnlyHint) and harness-spawned Perspicax bridges (an explicit
 * reviewed list) have any, plus computer_select for a cloud-only bot (a
 * no-op there). Everything else, including every third-party
 * server and any annotation it sends, gets none: all its calls ask. */
export function gateReadOnlyTools(server: { name: string; builtin: boolean; spec?: McpServerSpec }, botId?: string, dataDir: string = DATA_DIR): string[] {
  if (server.builtin && server.name === "agents") return [...READ_ONLY_AGENT_TOOL_NAMES];
  // A cloud-only bot's Works on is forced to fixed cloud (cloud-only-bots.ts,
  // turnWorksOn), so computer_select only reports ("you already work on the
  // cloud") or refuses: it can never switch computers. Every other bot's
  // computer_select can move the turn to the person's machine and still asks.
  if (server.builtin && server.name === AUTO_COMPUTER_MCP_NAME && cloudOnlyBot(botId, dataDir)) return ["computer_select"];
  if (!server.builtin && server.name !== "agents" && isPerspicaxBridge(server.spec)) return [...PERSPICAX_READ_ONLY_TOOLS];
  if (!server.builtin && server.name === FLOW_TOOLS_MCP_NAME && isFlowToolsServer(server.spec)) return [...FLOW_TOOL_NAMES];
  return [];
}
