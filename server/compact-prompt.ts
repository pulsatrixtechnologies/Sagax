// A compact, stable prompt for a bot turn on a local model (#1276).
//
// A local model reads the whole prompt before its first token, at a few
// hundred tokens a second, and only a byte-identical prefix is served from
// its cache. A turn of a bot on an organization server sent about 90,000
// tokens (Claude Code's prompt, Sagax's, and every tool of every MCP server),
// and two new conversations shared only the first 2,800 characters (Claude
// Code's auto memory path and the conversation's working folder both differ).
// The first token of a new conversation came after minutes.
//
// A compact turn (Claude Code on a local model, unless the bot or its engine
// says "full"):
// - lists the agents tools Claude Code would load up front, or, once the
//   bot's own use is known, the heart of a chat turn plus the tools it uses;
//   every other agents tool is found with search_tools and run with
//   call_tool (agents-proxy.ts);
// - gates every MCP server the bot owns with the gate's own search
//   (mcp-gate-search.ts): a big catalog lists whole only the tools this bot
//   used, the rest are searched;
// - keeps the system prompt the same for every conversation of the bot and
//   person: Claude Code's auto memory sits in one folder per bot and person,
//   and the conversation's file locations ride in its first message;
// - turns Claude Code's own tool search off, so what is listed is exactly
//   what Sagax lists, in the same order every time.
// Nothing is removed: every tool stays reachable, every rule and section is
// still sent, and approvals read the tool a call_tool runs.
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { CompactPromptInput } from "./contracts.ts";
import { isLocalModelId } from "./drivers/local-inject.ts";

export type LocalPromptMode = "compact" | "full";

/** System prompt sections that ride the volatile half (the first message of
 * a conversation) in a compact turn: the conversation's own folder, the one
 * line of the file locations that differs in every conversation. The rest of
 * the file locations stays in the cached system prompt. */
export const COMPACT_VOLATILE_SECTIONS: ReadonlySet<string> = new Set(["files-cwd"]);

/** Volatile sections that differ between two new conversations of the same
 * bot: in a compact turn they go last in the volatile half, so everything
 * before them (workplace rules, reach, model) is the same bytes in every new
 * conversation and a local model's prefix cache serves it. */
export const COMPACT_VOLATILE_LAST: readonly string[] = ["recent", "stream", "files-cwd"];

/** The volatile half of a compact turn, with the per-conversation sections
 * last (COMPACT_VOLATILE_LAST order). Nothing is dropped or changed. */
export function compactVolatileOrder<T extends { volatile: string; volatileSections: Array<{ id: string; text: string }> }>(prompt: T): T {
  const rank = (id: string) => COMPACT_VOLATILE_LAST.indexOf(id);
  const sections = prompt.volatileSections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => (rank(a.section.id) - rank(b.section.id)) || (a.index - b.index))
    .map(({ section }) => section);
  return { ...prompt, volatileSections: sections, volatile: sections.map((section) => section.text).join("") };
}

/** Whether a turn sends the compact prompt: Claude Code on a local model
 * (a `host::model` row of a local server or of the person's computer),
 * unless the bot or its engine is set to "full". */
export function usesCompactPrompt(input: {
  driverKind: string | undefined;
  model: string | null | undefined;
  bot?: LocalPromptMode;
  engine?: LocalPromptMode;
}): boolean {
  if (input.driverKind !== "claudeAgent") return false;
  if (!isLocalModelId(input.model)) return false;
  return input.bot !== "full" && input.engine !== "full";
}

/** A stored setting, or undefined. */
export function parseLocalPromptMode(value: unknown): LocalPromptMode | undefined {
  return value === "compact" || value === "full" ? value : undefined;
}

/** One tool call the bot made, as its activity row names it. */
export interface ToolUse {
  /** `mcp__<server>__<tool>`, a Claude Code built-in, or another engine's name */
  name: string;
}

/** How often the bot called each MCP tool, by server then tool. */
export function toolUsage(uses: Iterable<ToolUse>): Map<string, Map<string, number>> {
  const byServer = new Map<string, Map<string, number>>();
  for (const use of uses) {
    const name = use.name;
    if (!name.startsWith("mcp__")) continue;
    const rest = name.slice("mcp__".length);
    const split = rest.indexOf("__");
    if (split <= 0) continue;
    const server = rest.slice(0, split);
    const tool = rest.slice(split + 2);
    if (!tool || tool === "search_tools" || tool === "describe_tool" || tool === "call_tool") continue;
    const tools = byServer.get(server) ?? new Map<string, number>();
    tools.set(tool, (tools.get(tool) ?? 0) + 1);
    byServer.set(server, tools);
  }
  return byServer;
}

/** A bot whose agents use is known: this many recorded agents calls. Below
 * it, the agents catalog lists what Claude Code would load up front. */
export const KNOWN_USE_CALLS = 20;
/** A tool used at least this often is listed whole. */
export const PIN_MIN_USES = 1;
/** At most this many tools of one server are listed whole. */
export const PINNED_PER_SERVER_MAX = 12;

function topTools(tools: Map<string, number> | undefined, max = PINNED_PER_SERVER_MAX): string[] {
  if (!tools) return [];
  return [...tools]
    .filter(([, count]) => count >= PIN_MIN_USES)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, max)
    .map(([name]) => name)
    // the list rides the prompt: sorted, so the same use gives the same bytes
    .sort();
}

/** What a compact turn lists whole, from the bot's own recorded calls. */
export function compactPins(usage: Map<string, Map<string, number>>, servers: readonly string[]): Pick<CompactPromptInput, "agents" | "pinned"> {
  const agents = usage.get("agents");
  const agentsCalls = agents ? [...agents.values()].reduce((sum, count) => sum + count, 0) : 0;
  const pinned: Record<string, string[]> = {};
  for (const server of [...servers].sort()) {
    const tools = topTools(usage.get(server));
    if (tools.length) pinned[server] = tools;
  }
  return {
    agents: { core: agentsCalls >= KNOWN_USE_CALLS ? "used" : "default", pinned: topTools(agents) },
    pinned,
  };
}

/** Claude Code's auto memory folder for one bot and one person: the same in
 * every conversation they have, never shared with another person. */
export function compactMemoryDir(dataDir: string, botId: string, person: string): string {
  const key = createHash("sha256").update(`${botId}\u0000${person.trim().toLowerCase()}`).digest("hex").slice(0, 32);
  return join(dataDir, "claude-auto-memory", key);
}
