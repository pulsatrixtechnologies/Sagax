// What the published npm package must not carry: the name of the company
// that runs this project's production servers, personal names, initials and
// handles, internal bot names and tracker ids, and the name of the reference
// design product. Every packed text file is scanned; a hit fails the build
// unless its surroundings match an entry of scripts/npm-package-allowlist.json,
// each of which says why it must stay (a third-party format, URL scheme or
// legacy folder the code reads, or a minifier's variable name).
//
// The repository is public, so the private words are kept here only as
// truncated SHA-256 digests of a word (or of two words in a row, joined by
// one space), never in clear. Add one with:
//   node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0,16))' "word"
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const digest = (word) => createHash("sha256").update(word).digest("hex").slice(0, 16);

/** Words compared in lower case: digest of the lower-cased word -> term. */
export const LOWER_CASE_WORDS = {
  "95b1f0ce16eec5ba": "company",
  "4013f3f63adf789c": "personal",
  "0d1e0a13c7935528": "personal",
  "5d73a46da19b81d4": "personal",
  "d4343d5772372939": "personal",
  "d4d0195bcb7a7433": "personal", // two words
  "c6530c42a4f21811": "personal", // two words
  "30a8f22d1f57fda8": "personal",
  "6236954eb0980f3a": "bot-name",
  "8e4325e6f8910469": "tracker", // followed by -NNN
};

/** Words compared exactly as written, for those that are also ordinary
 * words or letters in another case. */
export const EXACT_WORDS = {
  a767e517e7eb77fd: "initials",
  b3a70b7ccfdbfae8: "bot-name",
  "6f1a2ccc7674d380": "bot-name",
  bec3edacc0089f86: "bot-name",
  b37e689205876888: "bot-name",
};

/** Public names, kept as patterns: the reference design product, also across
 * a line break, including an escaped one inside JSON. */
export const PATTERN_TERMS = [{ id: "grok-bot", pattern: /grok(?:[\s_-]|\\n)*bot/gi }];

const CONTEXT = 48;
const WORD = /[\p{L}\p{N}_]+/gu;
const BETWEEN_PAIR = /^(?:[\s-]|\\n)+$/;

/** The allowlist: { term, context (a regex source), reason } entries, with
 * an optional `files` regex source limiting the files an entry covers. */
export function loadAllowlist(file) {
  const entries = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(entries)) throw new Error(`${file} must be a JSON array`);
  return entries.map((entry, index) => {
    if (!entry || typeof entry.term !== "string" || typeof entry.context !== "string" || typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new Error(`${file} entry ${index} needs term, context and a reason`);
    }
    if (entry.files !== undefined && typeof entry.files !== "string") throw new Error(`${file} entry ${index}: files must be a regex source`);
    return { term: entry.term, context: new RegExp(entry.context, "g"), files: entry.files === undefined ? null : new RegExp(entry.files), reason: entry.reason };
  });
}

// The allowlisted text must overlap the hit itself, so an allowed name nearby
// never covers a different one.
function covers(pattern, context, from, to) {
  for (const found of context.matchAll(pattern)) {
    if (found.index < to && found.index + found[0].length > from) return true;
  }
  return false;
}

function wordHits(text) {
  const words = [...text.matchAll(WORD)];
  const hits = [];
  words.forEach((word, i) => {
    const value = word[0];
    const term = EXACT_WORDS[digest(value)] ?? LOWER_CASE_WORDS[digest(value.toLowerCase())];
    if (term && (term !== "tracker" || /^-\d/.test(text.slice(word.index + value.length)))) {
      hits.push({ term, index: word.index, length: value.length });
    }
    const next = words[i + 1];
    if (next && BETWEEN_PAIR.test(text.slice(word.index + value.length, next.index))) {
      const pair = LOWER_CASE_WORDS[digest(`${value} ${next[0]}`.toLowerCase())];
      if (pair) hits.push({ term: pair, index: word.index, length: next.index + next[0].length - word.index });
    }
  });
  return hits;
}

/** Every forbidden hit in `text` (from `file`, relative to the package),
 * with the allowlist entry that covers it, if any. The matched word is
 * masked, so a log of the hits does not spell it out either. */
export function scanText(text, allowlist = [], file = "") {
  const found = wordHits(text);
  for (const term of PATTERN_TERMS) {
    for (const match of text.matchAll(term.pattern)) found.push({ term: term.id, index: match.index, length: match[0].length });
  }
  return found
    .sort((a, b) => a.index - b.index)
    .map(({ term, index, length }) => {
      const start = Math.max(0, index - CONTEXT);
      const context = text.slice(start, index + length + CONTEXT);
      const at = index - start;
      const allowedBy = allowlist.find((entry) => entry.term === term && (!entry.files || entry.files.test(file)) && covers(entry.context, context, at, at + length));
      const masked = `${context.slice(0, at)}${text[index]}${"*".repeat(length - 1)}${context.slice(at + length)}`;
      return { term, index, context: masked, allowedBy };
    });
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Scan a package folder: { blocked, allowed } hits, each with its file. */
export function scanPackage(dir, allowlist = []) {
  const blocked = [];
  const allowed = [];
  for (const path of walk(dir)) {
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue; // binary (images, models): no text to name anyone
    const file = relative(dir, path).replaceAll("\\", "/");
    for (const hit of scanText(bytes.toString("utf8"), allowlist, file)) {
      (hit.allowedBy ? allowed : blocked).push({ file, ...hit });
    }
  }
  return { blocked, allowed };
}
