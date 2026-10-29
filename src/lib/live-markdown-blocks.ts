// A reply that is still being written, cut into the Markdown blocks that are
// finished and the one still growing (LiveReply). Each finished block keeps
// its own memoized renderer, so a new token parses only the last block, not
// the whole reply: a long answer stays light while it streams.
//
// A block ends at a blank line outside a code fence or a $$ math block, when
// the next line starts a new block of its own: not indented (a list item's
// continuation or indented code), not a list item (a loose list stays one
// list) and not a table row. A reply that uses link reference definitions or
// footnotes is drawn whole: those resolve across blocks.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MATH = /^ {0,3}\$\$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/m;

/** The finished blocks of `text`, then the growing one last. Joined with
 * "\n\n" they read as the same Markdown. */
export function splitLiveMarkdown(text: string): string[] {
  if (!text) return [];
  if (DEFINITION.test(text)) return [text];
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let math = false;
  let blankRun = false;
  for (const line of lines) {
    if (fence !== null) {
      current.push(line);
      const close = FENCE.exec(line);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length && line.trim() === close[1]) fence = null;
      continue;
    }
    if (math) {
      current.push(line);
      if (MATH.test(line)) math = false;
      continue;
    }
    if (!line.trim()) {
      if (current.length) blankRun = true;
      continue;
    }
    if (blankRun) {
      blankRun = false;
      const startsBlock = !/^[ \t]/.test(line) && !LIST_ITEM.test(line) && !line.trimStart().startsWith("|");
      if (startsBlock) {
        blocks.push(current.join("\n"));
        current = [];
      } else {
        current.push("");
      }
    }
    current.push(line);
    const open = FENCE.exec(line);
    if (open) fence = open[1]!;
    else if (MATH.test(line)) {
      // "$$x$$" on one line opens nothing
      const trimmed = line.trim();
      math = !(trimmed.length >= 4 && trimmed.endsWith("$$"));
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}
