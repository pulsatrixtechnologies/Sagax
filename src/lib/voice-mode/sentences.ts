// The bot's answer, cut into sentences while it is still being written, so
// the call speaks the first sentence while the rest is generated. Pure.
//
// Feed it the whole text so far (the streaming bubble's text); it returns the
// sentences completed since the last call. `finish` returns what is left
// once the answer is settled. A boundary is ., !, ?, … or : followed by a
// space or a line break (not a decimal "3.5", not an abbreviation "e.g."
// or "M."), a blank line, or the end of a list item. Text inside a code
// fence is skipped (the server's speakable text drops code anyway). The first
// sentence may be cut early at a comma once it is long, to start speaking
// sooner; later short sentences are joined to the next one, so a reply of
// many short lines is not many requests.

import { speakableSentence } from "./spoken";

const ABBREVIATIONS = new Set([
  "e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "no", "p", "pp", "fig", "approx", "cf",
  "m", "mme", "mlle", "env", "ex", "art", "av", "bd", "ste",
]);

export interface SentenceStreamOptions {
  /** a later sentence shorter than this waits to be joined to the next */
  minChars?: number;
  /** the first sentence is cut at a comma after this many characters */
  firstClauseChars?: number;
  /** a sentence is never longer than this (cut at a space) */
  maxChars?: number;
}

export class SentenceStream {
  private consumed = 0;
  private emitted = 0;
  private carry = "";
  private readonly minChars: number;
  private readonly firstClauseChars: number;
  private readonly maxChars: number;

  constructor(options: SentenceStreamOptions = {}) {
    this.minChars = options.minChars ?? 28;
    this.firstClauseChars = options.firstClauseChars ?? 90;
    this.maxChars = options.maxChars ?? 380;
  }

  /** Characters of the text already turned into sentences. */
  get position(): number {
    return this.consumed;
  }

  /** New complete sentences in `text` (the whole text so far). */
  feed(text: string): string[] {
    if (text.length < this.consumed) {
      // a new block of text started over: begin again
      this.consumed = 0;
      this.carry = "";
      this.emitted = 0;
    }
    const out: string[] = [];
    for (;;) {
      const rest = text.slice(this.consumed);
      const cut = this.boundary(rest);
      if (cut < 0) break;
      const piece = rest.slice(0, cut);
      this.consumed += cut;
      this.push(piece, out, false);
    }
    return out;
  }

  /** Whatever is left once the text is complete. */
  finish(text: string): string[] {
    const out = this.feed(text);
    const rest = text.length >= this.consumed ? text.slice(this.consumed) : "";
    this.consumed = text.length;
    this.push(rest, out, true);
    return out;
  }

  private push(piece: string, out: string[], last: boolean): void {
    const clean = this.speakable(piece);
    const joined = this.carry ? (clean ? `${this.carry} ${clean}` : this.carry) : clean;
    if (!joined) return;
    if (!last && this.emitted > 0 && joined.length < this.minChars) {
      this.carry = joined;
      return;
    }
    this.carry = "";
    this.emitted += 1;
    out.push(joined);
  }

  /** Code fences, markdown, emoji and URLs out, whitespace folded (spoken.ts). */
  private speakable(piece: string): string {
    return speakableSentence(piece);
  }

  /** Index just after the first sentence boundary in `rest`, or -1. */
  private boundary(rest: string): number {
    // a code fence: the text before it is a piece; the block itself is
    // skipped once it is closed
    const fence = rest.indexOf("```");
    let limit = rest.length;
    if (fence >= 0) {
      if (!/\S/.test(rest.slice(0, fence))) {
        const close = rest.indexOf("```", fence + 3);
        return close < 0 ? -1 : close + 3;
      }
      limit = fence;
    }
    const scan = rest.slice(0, limit);
    const first = this.emitted === 0;
    for (let i = 0; i < scan.length; i++) {
      const ch = scan[i]!;
      const next = scan[i + 1];
      if (ch === "\n" && next === "\n") return i + 2;
      if (ch === "\n" && next !== undefined && /^\s*(?:[-*•]|\d+[.)])\s/.test(scan.slice(i + 1, i + 6)) && /\S/.test(scan.slice(0, i))) return i + 1;
      if (".!?…:;".includes(ch)) {
        if (next === undefined) continue; // the next character decides
        if (!/\s/.test(next) && !(ch !== "." && /["'»)\]]/.test(next))) continue;
        if (ch === "." && this.abbreviation(scan, i)) continue;
        if (ch === ":" || ch === ";") {
          if (i < 40) continue;
        }
        return i + 1;
      }
      if (first && ch === "," && i >= this.firstClauseChars && next !== undefined && /\s/.test(next)) return i + 1;
      if (i >= this.maxChars && /\s/.test(ch)) return i + 1;
    }
    return fence >= 0 ? fence : -1;
  }

  private abbreviation(text: string, dot: number): boolean {
    const word = /([\p{L}.]+)$/u.exec(text.slice(Math.max(0, dot - 8), dot))?.[1]?.toLowerCase() ?? "";
    if (!word) return /\d$/.test(text.slice(0, dot)) && /\d/.test(text[dot + 1] ?? "");
    if (ABBREVIATIONS.has(word)) return true;
    // a single capital letter: an initial ("J. Smith")
    return /^\p{Lu}$/u.test(text.slice(dot - 1, dot)) && word.length === 1;
  }
}
