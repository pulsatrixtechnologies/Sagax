/** SSE event boundaries for the voice acceptance harness. Node's fetch
 * yields `\n\n`; some Windows pipes yield `\r\n\r\n`. Consecutive LFs are
 * not present in a CRLF pair, so both delimiters have to be searched. */

export function sseEventCut(buffer: string): { at: number; skip: number } | null {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { at: crlf, skip: 4 };
  if (lf >= 0) return { at: lf, skip: 2 };
  return null;
}

export function sseEventData(block: string): string {
  return block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
}
