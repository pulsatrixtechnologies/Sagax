// The one line a list shows under a bot's name (the phone's search, 19):
// the first non-empty line of its standing instructions (`soul`), without
// Markdown heading marks, bounded. Computed by the server for every wire bot
// (`WireBot.instructionsLead`) so every client shows the same words.

/** Longest lead, in characters (an ellipsis is added when cut). */
export const INSTRUCTIONS_LEAD_MAX = 140;

export function instructionsLead(soul: unknown): string | undefined {
  if (typeof soul !== "string" || !soul) return undefined;
  for (const raw of soul.split(/\r?\n/)) {
    // "# Title", "## Role", a closing "###" and an empty heading all reduce.
    const line = raw.replace(/^\s{0,3}#{1,6}(?=\s|$)/, "").replace(/\s+#+\s*$/, "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const chars = Array.from(line);
    return chars.length <= INSTRUCTIONS_LEAD_MAX ? line : `${chars.slice(0, INSTRUCTIONS_LEAD_MAX - 1).join("").trimEnd()}…`;
  }
  return undefined;
}
