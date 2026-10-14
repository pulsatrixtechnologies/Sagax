// The tools a Grok bot keeps calling, so a fresh conversation can call them
// directly. Grok reaches every Sagax MCP tool through search_tool then
// use_tool; on a tool's first use in a conversation the search is a full
// model round, and measured on the production server (2026-10-11) the round after it
// also lost the provider's prompt cache (512 of ~18k tokens cached). A bot
// mostly calls the same few tools, so the ones it used successfully before
// are named in a context section and the model goes straight to use_tool.
//
// Only names are kept (never arguments or outputs), per bot, in DATA_DIR.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../../atomic.ts";
import { DATA_DIR } from "../../config.ts";

/** `<server>__<tool>`, the name use_tool takes. */
const TOOL_NAME = /^[a-z0-9][\w.-]{0,63}__[a-z0-9][\w-]{0,63}$/i;
/** How many tools the section names at most. */
export const GROK_KNOWN_TOOLS_MAX = 12;
/** The id of the context section (prompt-split sends only changed sections). */
export const GROK_KNOWN_TOOLS_SECTION = "grok-known-tools";
/** Counts per bot are capped so one file stays small. */
const MAX_TRACKED = 200;

type Counts = Record<string, number>;
const cache = new Map<string, Counts>();

function fileFor(botId: string, dataDir: string): string {
  const digest = createHash("sha256").update(botId).digest("hex").slice(0, 24);
  return join(dataDir, "grok-tool-usage", `${digest}.json`);
}

function load(botId: string, dataDir: string): Counts {
  const key = `${dataDir}\0${botId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let counts: Counts = {};
  try {
    const parsed = JSON.parse(readFileSync(fileFor(botId, dataDir), "utf8")) as { counts?: unknown };
    if (parsed && typeof parsed.counts === "object" && parsed.counts !== null) {
      for (const [name, n] of Object.entries(parsed.counts as Record<string, unknown>)) {
        if (TOOL_NAME.test(name) && typeof n === "number" && Number.isFinite(n) && n > 0) counts[name] = Math.floor(n);
      }
    }
  } catch {
    counts = {};
  }
  cache.set(key, counts);
  return counts;
}

/** The use_tool target of an ACP tool call, when it names one. */
export function useToolName(rawInput: unknown): string | null {
  if (!rawInput || typeof rawInput !== "object") return null;
  const name = (rawInput as { tool_name?: unknown }).tool_name;
  return typeof name === "string" && TOOL_NAME.test(name.trim()) ? name.trim() : null;
}

/** Count one successful call of `toolName` by this bot. Never throws. */
export function recordGrokToolUse(botId: string | undefined, toolName: string | null, dataDir: string = DATA_DIR): void {
  if (!botId || !toolName || !TOOL_NAME.test(toolName)) return;
  try {
    const counts = load(botId, dataDir);
    counts[toolName] = (counts[toolName] ?? 0) + 1;
    const names = Object.keys(counts);
    if (names.length > MAX_TRACKED) {
      names.sort((a, b) => counts[a]! - counts[b]!);
      for (const name of names.slice(0, names.length - MAX_TRACKED)) delete counts[name];
    }
    const path = fileFor(botId, dataDir);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, JSON.stringify({ counts }), { mode: 0o600 });
  } catch {
    // a lost count only costs a search later
  }
}

/** The bot's most-used tools among the servers mounted on this turn, in a
 * stable (alphabetical) order so the section changes only when the set does. */
export function knownGrokTools(botId: string | undefined, serverNames: readonly string[], dataDir: string = DATA_DIR): string[] {
  if (!botId || !serverNames.length) return [];
  const mounted = new Set(serverNames);
  const counts = load(botId, dataDir);
  return Object.entries(counts)
    .filter(([name]) => mounted.has(name.slice(0, name.indexOf("__"))))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, GROK_KNOWN_TOOLS_MAX)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

/** The context section naming them, or null when there is none. */
export function knownGrokToolsSection(tools: readonly string[]): { id: string; text: string } | null {
  if (!tools.length) return null;
  return {
    id: GROK_KNOWN_TOOLS_SECTION,
    text: "Tools you already used and can call directly with use_tool, without search_tool first: " +
      tools.join(", ") +
      ". Pass tool_input per the tool's usual arguments; use search_tool only for another tool, or when a direct call reports bad arguments.",
  };
}

/** Test seam: forget cached counts. */
export function resetGrokToolUsageCache(): void {
  cache.clear();
}
