// How much of one machine tool's answer reaches the model.
//
// The bot's own MCP servers already go through mcp-gate.ts, which cuts a
// result to ~8,000 characters. The tools Sagax itself serves on a machine
// (the person's computer through the desktop app, the sandbox, the cloud
// computer, a Local VM) were left out as "already bounded", but their bounds
// are transport limits: a command's output up to 512 KB, a file read up to
// 256 KB by default and 1 MB on request. That is 60,000 to 250,000 tokens in
// one result. An engine keeps every result in its session and re-reads it on
// each later call; a few such results in one model call (a port scan and a
// recursive search for keys run side by side) refill a Claude Code session
// right after it compacts, until the CLI gives up on the turn (Autocompact is
// thrashing, server/context-renewal.ts).
//
// So a text answer is cut to a budget the size of Claude Code's own Bash
// output (30,000 characters), keeping its start and its end (a command's
// error is nearly always last), and the cut says how many lines were left
// out and how to ask for them. Images, and text that must stay whole (a
// base64 file), are never cut.

export const TOOL_TEXT_BUDGET = 30_000;
/** Never cut below this: a result that short is cheaper whole. */
const MIN_BUDGET = 2_000;
/** Share of the budget kept from the start; the rest is the end. */
const HEAD_SHARE = 0.6;

const DEFAULT_HINT = "Ask for the rest in smaller pieces: filter or narrow the command (grep, head, tail, sed -n 'START,ENDp', fewer hosts or ports at a time).";

const fmt = (n: number) => n.toLocaleString("en-US");

function lineCount(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines++;
  return lines;
}

/** `text` within `budget` characters: its start and its end at line
 * boundaries when there are some, and one marker in between that says what
 * was left out. Unchanged when it already fits. */
export function boundToolText(text: string, options: { budget?: number; hint?: string } = {}): { text: string; cut: boolean } {
  const budget = Math.max(MIN_BUDGET, Math.floor(options.budget ?? TOOL_TEXT_BUDGET));
  if (text.length <= budget) return { text, cut: false };
  const headBudget = Math.floor(budget * HEAD_SHARE);
  const tailBudget = budget - headBudget;
  let head = text.slice(0, headBudget);
  const headBreak = head.lastIndexOf("\n");
  if (headBreak > headBudget / 2) head = head.slice(0, headBreak + 1);
  let tail = text.slice(text.length - tailBudget);
  const tailBreak = tail.indexOf("\n");
  if (tailBreak !== -1 && tailBreak < tailBudget / 2) tail = tail.slice(tailBreak + 1);
  const omitted = text.slice(head.length, text.length - tail.length);
  const marker = `${head.endsWith("\n") ? "" : "\n"}[… ${fmt(lineCount(omitted))} more lines (${fmt(omitted.length)} characters) not shown. ${options.hint ?? DEFAULT_HINT}]\n`;
  return { text: `${head}${marker}${tail}`, cut: true };
}

type Content = { type?: unknown; text?: unknown; [key: string]: unknown };

/** An MCP tool result with its text items cut to one shared budget, in
 * order: the first items keep what fits, the next share what is left.
 * Anything that is not a well-formed result comes back as it was. */
export function boundToolResult<T>(result: T, options: { budget?: number; hint?: string } = {}): T {
  const value = result as { content?: unknown } | null;
  if (!value || typeof value !== "object" || !Array.isArray(value.content)) return result;
  const items = value.content as Content[];
  const total = items.reduce((sum, item) => sum + (item?.type === "text" && typeof item.text === "string" ? item.text.length : 0), 0);
  let left = Math.max(MIN_BUDGET, Math.floor(options.budget ?? TOOL_TEXT_BUDGET));
  if (total <= left) return result;
  const content = items.map((item) => {
    if (item?.type !== "text" || typeof item.text !== "string") return item;
    const bounded = boundToolText(item.text, { budget: Math.max(MIN_BUDGET, left), ...(options.hint ? { hint: options.hint } : {}) });
    left = Math.max(0, left - bounded.text.length);
    return bounded.cut ? { ...item, text: bounded.text } : item;
  });
  return { ...(value as object), content } as T;
}

/** The hint for a file read cut short: where to read on from. */
export function readOnHint(): string {
  return "Read the rest in pieces with offset (and a smaller max_bytes), or search the file for what you need.";
}
