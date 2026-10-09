// Pure text edits behind the shared markdown editor (MarkdownEditor.tsx):
// the toolbar actions, list continuation on Enter, Tab and Shift+Tab in
// lists, link and table paste, the word count and the Format action. Each
// edit takes the whole text and a selection and returns the new text and
// selection, so the same code drives CodeMirror and the unit tests, and no
// edit ever needs the DOM.

export interface TextSelection {
  doc: string;
  /** selection start (inclusive) */
  from: number;
  /** selection end (exclusive); equal to `from` for a caret */
  to: number;
}

const BULLET = /^(\s*)([-*+])(\s+)/;
const ORDERED = /^(\s*)(\d{1,9})([.)])(\s+)/;
const TASK = /^(\s*)([-*+])(\s+)\[([ xX])\](\s+|$)/;
const QUOTE = /^(\s*)((?:>\s?)+)/;
const HEADING = /^(#{1,6})(\s+|$)/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function lineStartAt(doc: string, pos: number): number {
  return doc.lastIndexOf("\n", pos - 1) + 1;
}

function lineEndAt(doc: string, pos: number): number {
  const end = doc.indexOf("\n", pos);
  return end === -1 ? doc.length : end;
}

/** True when `pos` sits inside a fenced code block (between an opening and
 * a closing fence line, or after an opening fence that never closes). */
export function insideFence(doc: string, pos: number): boolean {
  const before = doc.slice(0, lineStartAt(doc, pos));
  let open: string | null = null;
  for (const line of before.split("\n")) {
    const match = FENCE.exec(line);
    if (!match) continue;
    const marker = match[1]!;
    if (!open) open = marker;
    else if (marker[0] === open[0] && marker.length >= open.length && line.trim() === marker) open = null;
  }
  return open !== null;
}

// ---- inline wraps: bold, italic, inline code ----

/** Wrap or unwrap the selection with `marker` (`**`, `_` or a backtick).
 * Spaces at the ends of the selection stay outside the markers. A caret
 * inserts the markers around `placeholder` and selects it. */
export function toggleWrap(state: TextSelection, marker: string, placeholder: string): TextSelection {
  const { doc } = state;
  let from = state.from;
  let to = state.to;
  while (from < to && /\s/.test(doc[from]!)) from += 1;
  while (to > from && /\s/.test(doc[to - 1]!)) to -= 1;
  const m = marker.length;
  // markers just outside the selection: unwrap
  if (doc.slice(from - m, from) === marker && doc.slice(to, to + m) === marker && from - m >= 0) {
    const next = doc.slice(0, from - m) + doc.slice(from, to) + doc.slice(to + m);
    return { doc: next, from: from - m, to: to - m };
  }
  const selected = doc.slice(from, to);
  // markers inside the selection: unwrap
  if (selected.length >= 2 * m + 1 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, selected.length - m);
    return { doc: doc.slice(0, from) + inner + doc.slice(to), from, to: from + inner.length };
  }
  if (from === to) {
    const next = doc.slice(0, from) + marker + placeholder + marker + doc.slice(to);
    return { doc: next, from: from + m, to: from + m + placeholder.length };
  }
  const next = doc.slice(0, from) + marker + selected + marker + doc.slice(to);
  return { doc: next, from: from + m, to: to + m };
}

/** Inline code for a selection on one line, a fenced block for several. */
export function toggleCode(state: TextSelection, placeholder: string): TextSelection {
  const selected = state.doc.slice(state.from, state.to);
  if (!selected.includes("\n")) return toggleWrap(state, "`", placeholder);
  const { doc } = state;
  const start = lineStartAt(doc, state.from);
  const end = lineEndAt(doc, state.to);
  const body = doc.slice(start, end);
  const lines = body.split("\n");
  if (lines.length >= 2 && FENCE.test(lines[0]!) && FENCE.test(lines[lines.length - 1]!)) {
    const inner = lines.slice(1, -1).join("\n");
    return { doc: doc.slice(0, start) + inner + doc.slice(end), from: start, to: start + inner.length };
  }
  const block = "```\n" + body + "\n```";
  return { doc: doc.slice(0, start) + block + doc.slice(end), from: start + 4, to: start + 4 + body.length };
}

// ---- line prefixes: lists, quote, heading ----

export type LineKind = "bullet" | "numbered" | "task" | "quote";

interface ParsedLine {
  indent: string;
  /** the list or quote marker including its trailing space, "" when none */
  marker: string;
  kind: LineKind | null;
  rest: string;
}

function parseLine(line: string): ParsedLine {
  let match = TASK.exec(line);
  if (match) return { indent: match[1]!, marker: match[0].slice(match[1]!.length), kind: "task", rest: line.slice(match[0].length) };
  match = ORDERED.exec(line);
  if (match) return { indent: match[1]!, marker: match[0].slice(match[1]!.length), kind: "numbered", rest: line.slice(match[0].length) };
  if (!THEMATIC_BREAK.test(line)) {
    match = BULLET.exec(line);
    if (match) return { indent: match[1]!, marker: match[0].slice(match[1]!.length), kind: "bullet", rest: line.slice(match[0].length) };
  }
  match = QUOTE.exec(line);
  if (match) return { indent: match[1]!, marker: match[0].slice(match[1]!.length), kind: "quote", rest: line.slice(match[0].length) };
  const indent = /^\s*/.exec(line)![0];
  return { indent, marker: "", kind: null, rest: line.slice(indent.length) };
}

function markerFor(kind: LineKind, index: number): string {
  if (kind === "bullet") return "- ";
  if (kind === "numbered") return `${index + 1}. `;
  if (kind === "task") return "- [ ] ";
  return "> ";
}

/** Map an offset inside the old block to the new one, line by line. */
function selectionAfterLineEdit(
  oldLines: string[],
  newLines: string[],
  blockStart: number,
  state: TextSelection,
): { from: number; to: number } {
  const map = (pos: number): number => {
    let oldOffset = blockStart;
    let newOffset = blockStart;
    for (let i = 0; i < oldLines.length; i += 1) {
      const oldLine = oldLines[i]!;
      const newLine = newLines[i]!;
      if (pos <= oldOffset + oldLine.length) {
        const column = pos - oldOffset;
        const delta = newLine.length - oldLine.length;
        // a caret in the marker area moves with the text after it
        return newOffset + clamp(column + delta, Math.min(column, newLine.length), newLine.length);
      }
      oldOffset += oldLine.length + 1;
      newOffset += newLine.length + 1;
    }
    return newOffset - 1;
  };
  return { from: map(state.from), to: map(state.to) };
}

/** Make every line of the selection a bullet, numbered, task or quote line,
 * or remove that marker when every non-empty line already has it. */
export function toggleLinePrefix(state: TextSelection, kind: LineKind): TextSelection {
  const { doc } = state;
  const start = lineStartAt(doc, state.from);
  const end = lineEndAt(doc, Math.max(state.from, state.to - (state.to > state.from && doc[state.to - 1] === "\n" ? 1 : 0)));
  const oldLines = doc.slice(start, end).split("\n");
  const parsed = oldLines.map(parseLine);
  const content = parsed.filter((line) => line.rest.trim() !== "" || line.marker !== "");
  const all = content.length > 0 && content.every((line) => line.kind === kind);
  let counter = 0;
  const newLines = oldLines.map((line, index) => {
    const info = parsed[index]!;
    const empty = info.rest.trim() === "" && info.marker === "";
    if (empty && oldLines.length > 1) return line;
    if (all) return info.indent + info.rest;
    if (kind === "quote") return info.indent + "> " + info.marker + info.rest;
    const marker = markerFor(kind, counter);
    counter += 1;
    // a quote marker stays; another list marker is replaced
    if (info.kind === "quote") return info.indent + info.marker + marker + info.rest;
    return info.indent + marker + info.rest;
  });
  const next = doc.slice(0, start) + newLines.join("\n") + doc.slice(end);
  const selection = selectionAfterLineEdit(oldLines, newLines, start, state);
  return { doc: next, ...selection };
}

/** Set the heading level of the selected lines; the same level again
 * removes it. Level 0 removes any heading. */
export function setHeading(state: TextSelection, level: number): TextSelection {
  const { doc } = state;
  const start = lineStartAt(doc, state.from);
  const end = lineEndAt(doc, state.to);
  const oldLines = doc.slice(start, end).split("\n");
  const levels = oldLines.map((line) => HEADING.exec(line)?.[1]!.length ?? 0);
  const same = levels.every((value) => value === level);
  const newLines = oldLines.map((line) => {
    const bare = line.replace(HEADING, "");
    if (same || level === 0) return bare;
    return "#".repeat(level) + " " + bare;
  });
  const next = doc.slice(0, start) + newLines.join("\n") + doc.slice(end);
  return { doc: next, ...selectionAfterLineEdit(oldLines, newLines, start, state) };
}

/** The toolbar's heading button: none, H1, H2, H3, then none again. */
export function cycleHeading(state: TextSelection): TextSelection {
  const line = state.doc.slice(lineStartAt(state.doc, state.from), lineEndAt(state.doc, state.from));
  const level = HEADING.exec(line)?.[1]!.length ?? 0;
  const next = level >= 3 ? 0 : level + 1;
  return setHeading(state, next === 0 ? level : next);
}

// ---- link, table, horizontal rule ----

const URL_ONLY = /^(?:https?:\/\/|mailto:)[^\s<>()]+$/i;

export function isUrl(text: string): boolean {
  return URL_ONLY.test(text.trim());
}

/** The toolbar's link button: the selection becomes the link text (or the
 * address when it is one) and the part left to fill is selected. */
export function insertLink(state: TextSelection, textPlaceholder: string): TextSelection {
  const { doc, from, to } = state;
  const selected = doc.slice(from, to);
  if (isUrl(selected)) {
    const url = selected.trim();
    const next = `${doc.slice(0, from)}[${textPlaceholder}](${url})${doc.slice(to)}`;
    return { doc: next, from: from + 1, to: from + 1 + textPlaceholder.length };
  }
  const text = selected || textPlaceholder;
  const url = "https://";
  const next = `${doc.slice(0, from)}[${text}](${url})${doc.slice(to)}`;
  if (!selected) return { doc: next, from: from + 1, to: from + 1 + text.length };
  const urlStart = from + text.length + 3;
  return { doc: next, from: urlStart, to: urlStart + url.length };
}

/** Insert `block` on its own lines at the caret, with a blank line before
 * and after unless the text already has one. */
function insertBlock(state: TextSelection, block: string, selectFrom: number, selectTo: number): TextSelection {
  const { doc } = state;
  const at = state.to;
  const lineStart = lineStartAt(doc, at);
  const lineEnd = lineEndAt(doc, at);
  const lineEmpty = doc.slice(lineStart, lineEnd).trim() === "";
  const insertAt = lineEmpty ? lineStart : lineEnd;
  const before = doc.slice(0, insertAt);
  const after = doc.slice(lineEmpty ? lineEnd : insertAt);
  let prefix = "";
  if (before.length > 0 && !before.endsWith("\n\n")) prefix = before.endsWith("\n") ? "\n" : "\n\n";
  let suffix = "";
  if (after.length === 0) suffix = "\n";
  else if (!after.startsWith("\n\n")) suffix = after.startsWith("\n") ? "\n" : "\n\n";
  const next = before + prefix + block + suffix + after;
  const base = before.length + prefix.length;
  return { doc: next, from: base + selectFrom, to: base + selectTo };
}

export function insertTable(state: TextSelection, labels: { column: (n: number) => string }): TextSelection {
  const a = labels.column(1);
  const b = labels.column(2);
  const header = `| ${a} | ${b} |`;
  const block = `${header}\n| --- | --- |\n|  |  |`;
  return insertBlock(state, block, 2, 2 + a.length);
}

export function insertRule(state: TextSelection): TextSelection {
  return insertBlock(state, "---", 3, 3);
}

// ---- Enter, Tab, Shift+Tab in lists ----

/** Enter inside a list or a quote: the next line gets the same marker (the
 * next number, an unchecked box). Enter on an empty item ends the list (or
 * moves a nested item one level out). Null when Enter should do its usual
 * thing: not in a list, inside a code block, or a caret inside the marker. */
export function continueList(state: TextSelection): TextSelection | null {
  const { doc, from, to } = state;
  if (from !== to) return null;
  if (insideFence(doc, from)) return null;
  const start = lineStartAt(doc, from);
  const end = lineEndAt(doc, from);
  const line = doc.slice(start, end);
  const info = parseLine(line);
  if (!info.kind) return null;
  const markerEnd = start + info.indent.length + info.marker.length;
  if (from < markerEnd) return null;
  if (info.rest.trim() === "" && from === end) {
    if (info.indent.length > 0 && info.kind !== "quote") return indentList(state, -1);
    // an empty item ends the list: the marker goes, the line stays
    const next = doc.slice(0, start) + doc.slice(end);
    return { doc: next, from: start, to: start };
  }
  let marker = info.marker;
  if (info.kind === "numbered") {
    const match = ORDERED.exec(line)!;
    marker = `${Number(match[2]) + 1}${match[3]}${match[4]!.includes("\t") ? match[4] : " "}`;
  } else if (info.kind === "task") {
    const match = TASK.exec(line)!;
    marker = `${match[2]}${match[3]}[ ] `;
  }
  const insert = "\n" + info.indent + marker;
  const after = doc.slice(to).replace(/^[ \t]+/, "");
  const next = doc.slice(0, from).replace(/[ \t]+$/, "") + insert + after;
  const caret = doc.slice(0, from).replace(/[ \t]+$/, "").length + insert.length;
  return { doc: next, from: caret, to: caret };
}

/** Tab (direction 1) or Shift+Tab (-1) on list lines: nest under the item
 * above (its content column) or move one level out. Null when the caret is
 * not on a list line, so Tab still moves focus out of the editor there. */
export function indentList(state: TextSelection, direction: 1 | -1): TextSelection | null {
  const { doc } = state;
  if (insideFence(doc, state.from)) return null;
  const start = lineStartAt(doc, state.from);
  const end = lineEndAt(doc, state.to);
  const oldLines = doc.slice(start, end).split("\n");
  const parsed = oldLines.map(parseLine);
  if (!parsed.some((line) => line.kind && line.kind !== "quote")) return null;
  // list lines above the block, nearest first, for the parent's columns
  const above = doc.slice(0, Math.max(0, start - 1)).split("\n").reverse();
  const parentFor = (indent: number, deeper: boolean): ParsedLine | null => {
    for (const text of above) {
      if (text.trim() === "") continue;
      const line = parseLine(text);
      if (!line.kind || line.kind === "quote") {
        if (line.indent.length === 0) return null;
        continue;
      }
      if (deeper ? line.indent.length <= indent : line.indent.length < indent) return line;
    }
    return null;
  };
  const newLines = oldLines.map((line, index) => {
    const info = parsed[index]!;
    if (!info.kind || info.kind === "quote") return line;
    const width = info.indent.replace(/\t/g, "    ").length;
    let target: number;
    if (direction === 1) {
      const parent = parentFor(width, true);
      target = parent ? parent.indent.length + parent.marker.length : width + 2;
      if (target <= width) target = width + 2;
    } else {
      if (width === 0) return line;
      const parent = parentFor(width, false);
      target = parent ? parent.indent.length : 0;
    }
    return " ".repeat(target) + info.marker + info.rest;
  });
  if (newLines.every((line, index) => line === oldLines[index])) return direction === -1 ? state : null;
  const next = doc.slice(0, start) + newLines.join("\n") + doc.slice(end);
  return { doc: next, ...selectionAfterLineEdit(oldLines, newLines, start, state) };
}

// ---- paste ----

/** A URL pasted over selected text on one line becomes a link. */
export function linkFromPaste(selected: string, pasted: string): string | null {
  if (!selected.trim() || selected.includes("\n") || isUrl(selected)) return null;
  if (!isUrl(pasted)) return null;
  return `[${selected}](${pasted.trim()})`;
}

function tableCell(value: string): string {
  // Backslashes first, so a cell ending in "\" cannot escape the pipe added
  // after it and split the row.
  return value.trim().replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/** Tab-separated text (a spreadsheet copy) becomes a markdown table, its
 * first row the header. Null for anything else. */
export function tableFromTsv(pasted: string): string | null {
  const text = pasted.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const rows = text.split("\n");
  if (rows.length < 2 || !rows.every((row) => row.includes("\t"))) return null;
  const cells = rows.map((row) => row.split("\t").map(tableCell));
  const columns = Math.max(...cells.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array.from({ length: columns - row.length }, () => "")];
  const line = (row: string[]) => `| ${pad(row).join(" | ")} |`;
  const [header, ...body] = cells;
  return [line(header!), `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`, ...body.map(line)].join("\n");
}

// ---- counts ----

/** Words with at least one letter or digit, so list dashes, heading marks
 * and other bare markup are not counted. */
export function countWords(text: string): number {
  let count = 0;
  for (const word of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(word)) count += 1;
  return count;
}

/** Characters as a person counts them (user-perceived, so an emoji is 1). */
export function countCharacters(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

// ---- Format ----

/** Normalise spacing without changing what the markdown renders:
 * - one blank line around headings and fenced code blocks, and before a
 *   list that follows a paragraph;
 * - "* " and "+ " bullets become "- ";
 * - "#   Title  " becomes "# Title";
 * - trailing spaces go, except the two that mark a line break;
 * - runs of blank lines become one, none at the start or end.
 * Fenced code blocks and front matter stay byte for byte. */
export function formatMarkdown(text: string): string {
  const source = text.replace(/\r\n?/g, "\n");
  const endsWithNewline = source.endsWith("\n");
  const lines = source.split("\n");
  if (endsWithNewline) lines.pop();
  const out: string[] = [];
  const blank = () => out.length > 0 && out[out.length - 1] !== "";
  const pushBlank = () => { if (blank()) out.push(""); };

  let index = 0;
  // front matter
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close > 0) {
      out.push(...lines.slice(0, close + 1));
      index = close + 1;
    }
  }
  let fence: string | null = null;
  let inList = false;
  let pendingBlankAfter = false;
  for (; index < lines.length; index += 1) {
    const raw = lines[index]!;
    if (fence) {
      out.push(raw);
      const match = FENCE.exec(raw);
      if (match && match[1]![0] === fence[0] && match[1]!.length >= fence.length && raw.trim() === match[1]) {
        fence = null;
        pendingBlankAfter = true;
      }
      continue;
    }
    const fenceMatch = FENCE.exec(raw);
    if (fenceMatch && !(inList && /^\s/.test(raw))) {
      pushBlank();
      out.push(raw.replace(/[ \t]+$/, ""));
      fence = fenceMatch[1]!;
      pendingBlankAfter = false;
      inList = false;
      continue;
    }
    if (fenceMatch) {
      // a fence nested in a list item: keep it verbatim, inside the list
      out.push(raw);
      fence = fenceMatch[1]!;
      continue;
    }
    // trailing spaces: keep a hard break ("  ") before a line that carries
    // on the same paragraph; before a new block it means nothing
    const next = lines[index + 1];
    const continues = next !== undefined && next.trim() !== "" && !parseLine(next).kind && !/^#{1,6}(\s|$)/.test(next) && !FENCE.test(next) && !THEMATIC_BREAK.test(next);
    const hardBreak = /\S {2,}$/.test(raw) && continues;
    let line = hardBreak ? raw.replace(/ {2,}$/, "  ") : raw.replace(/[ \t]+$/, "");
    if (line === "") {
      pendingBlankAfter = false;
      if (blank()) out.push("");
      continue;
    }
    if (pendingBlankAfter) {
      pushBlank();
      pendingBlankAfter = false;
    }
    const heading = /^(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading || /^#{1,6}$/.test(line)) {
      line = heading ? `${heading[1]} ${heading[2]}` : line;
      pushBlank();
      out.push(line);
      pendingBlankAfter = true;
      inList = false;
      continue;
    }
    if (!THEMATIC_BREAK.test(line)) line = line.replace(/^(\s*)[*+](\s+)(?=\S)/, "$1-$2");
    const info = parseLine(line);
    const isItem = info.kind === "bullet" || info.kind === "task" || info.kind === "numbered";
    if (isItem && !inList && info.indent.length === 0) {
      // only a bullet or a list starting at 1 may follow a paragraph line
      // directly, so only those get the blank line (anything else is still
      // the paragraph and must stay one)
      const ordered = ORDERED.exec(line);
      const canInterrupt = !ordered || Number(ordered[2]) === 1;
      if (canInterrupt) pushBlank();
    }
    if (isItem) inList = true;
    else if (!/^\s/.test(line) && out[out.length - 1] === "") inList = false;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  const result = out.join("\n");
  return endsWithNewline && result ? result + "\n" : result;
}

// ---- the auto-pair rule ----

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "`": "`", "*": "*", "_": "_" };

/** What typing `char` does with the text around the caret: wrap the
 * selection, insert a pair, step over a closing character, or nothing
 * special (null). `*` and `_` pair only where they can open emphasis: not
 * at the start of a line (a bullet) and not inside a word (snake_case). */
export function autoPair(state: TextSelection, char: string): TextSelection | null {
  const close = PAIRS[char] ?? (char === ")" || char === "]" ? char : null);
  if (!close) return null;
  const { doc, from, to } = state;
  if (insideFence(doc, from)) return null;
  const nextChar = doc[to] ?? "";
  const prevChar = doc[from - 1] ?? "";
  if (from === to && (char === ")" || char === "]" || char === "`" || char === "*" || char === "_") && nextChar === char) {
    return { doc, from: from + 1, to: from + 1 };
  }
  if (!(char in PAIRS)) return null;
  if (from !== to) {
    const selected = doc.slice(from, to);
    if (selected.includes("\n") && char !== "`") return null;
    const next = doc.slice(0, from) + char + selected + close + doc.slice(to);
    return { doc: next, from: from + 1, to: to + 1 };
  }
  if (nextChar && !/[\s)\]}.,;:!?]/.test(nextChar)) return null;
  if (char === "*" || char === "_" || char === "`") {
    const lineStart = lineStartAt(doc, from);
    if (doc.slice(lineStart, from).trim() === "") return null;
    if (/[\p{L}\p{N}]/u.test(prevChar)) return null;
  }
  const next = doc.slice(0, from) + char + close + doc.slice(to);
  return { doc: next, from: from + 1, to: from + 1 };
}

/** Backspace between an empty pair removes both characters. */
export function deletePair(state: TextSelection): TextSelection | null {
  const { doc, from, to } = state;
  if (from !== to || from === 0) return null;
  const open = doc[from - 1]!;
  if (PAIRS[open] && doc[from] === PAIRS[open]) {
    return { doc: doc.slice(0, from - 1) + doc.slice(from + 1), from: from - 1, to: from - 1 };
  }
  return null;
}

/** Toggle a task box `[ ]` / `[x]` on the line holding `pos`. */
export function toggleTask(doc: string, pos: number): string | null {
  const start = lineStartAt(doc, pos);
  const end = lineEndAt(doc, pos);
  const line = doc.slice(start, end);
  const match = TASK.exec(line);
  if (!match) return null;
  const boxAt = start + match[1]!.length + match[2]!.length + match[3]!.length + 1;
  const checked = match[4] !== " ";
  return doc.slice(0, boxAt) + (checked ? " " : "x") + doc.slice(boxAt + 1);
}

/** The smallest single replacement turning `before` into `after`. */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}
