// A number the bot states from a connected app names that piece and its date.
// A read with no date is not a source. Nothing here invents a number.

const DAY = /\b(\d{4}-\d{2}-\d{2})\b/;
const NUMBER = /\d+(?:[.,]\d+)?/g;
const READ = /^(?:read|list|search|get|find|fetch|lookup|count|view)(?:[_\s-]|$)/i;
const REFUSED = /send|write|edit|delete|remove|post|put|patch|create|update|browser|navigate|browse|bash|shell|exec|pay|purchase|publish|computer/i;

export interface AppPiece {
  piece: string;
  asOf: string;
  text: string;
}

function hasNumber(haystack: string, number: string): boolean {
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d])${escaped}(?![\\d])`).test(haystack);
}

/** A connected-app read, or null when it is not a read or has no date.
 * The action is the tool's own name, after an `mcp__server__` prefix. */
export function noteAppRead(tool: string, result: string | undefined): AppPiece | null {
  const name = tool.trim();
  const action = name.split("__").pop() ?? name;
  if (!name || REFUSED.test(name) || REFUSED.test(action) || !(READ.test(action) || READ.test(name)) || !result?.trim()) return null;
  const asOf = result.match(DAY)?.[1];
  if (!asOf) return null;
  let piece = name;
  try {
    const value = JSON.parse(result) as unknown;
    const row = Array.isArray(value) ? value[0] : value;
    if (row && typeof row === "object") {
      const titled = (row as { piece?: unknown; title?: unknown; subject?: unknown; name?: unknown }).piece
        ?? (row as { title?: unknown }).title
        ?? (row as { subject?: unknown }).subject
        ?? (row as { name?: unknown }).name;
      if (typeof titled === "string" && titled.trim()) piece = titled.trim();
    }
  } catch {
    /* the tool name is the piece */
  }
  return { piece: piece.slice(0, 200), asOf, text: result.replace(/\s+/g, " ").trim().slice(0, 2_000) };
}

/** Name the piece and the date for each number that came from one.
 * A number that is not in a dated piece is left as the bot wrote it.
 * No number is added. */
export function citeAppFigures(text: string, pieces: readonly AppPiece[]): string {
  if (!text.trim() || !pieces.length) return text;
  const numbers = text.match(NUMBER) ?? [];
  if (!numbers.length) return text;
  const notes: string[] = [];
  for (const piece of pieces) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(piece.asOf) || !piece.piece.trim()) continue;
    const body = piece.text.replaceAll(piece.asOf, " ");
    const used = numbers.some((number) => number !== piece.asOf && hasNumber(body, number));
    if (!used) continue;
    if (text.includes(piece.piece) && text.includes(piece.asOf)) continue;
    const note = `${piece.piece}, ${piece.asOf}`;
    if (!notes.includes(note)) notes.push(note);
  }
  if (!notes.length) return text;
  return `${text.replace(/\s+$/, "")} (${notes.join("; ")})`;
}
