// Bot replies without em dashes or en dashes (#1208). Some models, small
// local ones above all, put them in their answers even when the voice
// instructions forbid them, so the final text of a reply is cleaned here
// after the fact. Only prose is touched: fenced code, inline code and links
// are kept as they are, and so are tool calls and reasoning (the caller only
// hands in the final assistant text).
//
// - a dash between two times, two dates or two tight numbers is a range:
//   "09:30 - 10:30" becomes "09:30 à 10:30", "5-10" becomes "5 à 10";
// - a dash after a list item label becomes a colon;
// - a dash at the start of a line is a list marker;
// - any other dash is an aside, so it becomes a comma.
// A dash with spaces between two numbers that are not times or dates
// ("Projet 801 - 17 phases") is an aside, never a range.
//
// The setting is per person (USER_PREFERENCE_KEYS, "sagax.voiceDashes.v1"):
// "on" or "off", and when the person never chose, on for French only.

/** One of the person's preferences (shared/user-preferences.ts). */
export const VOICE_DASHES_PREFERENCE = "sagax.voiceDashes.v1";

/** The setting as it applies: the person's choice, else on for French. */
export function voiceDashesEnabled(preference: string | undefined, language: string | undefined): boolean {
  if (preference === "on") return true;
  if (preference === "off") return false;
  return typeof language === "string" && language.trim().toLowerCase().startsWith("fr");
}

const DASH = "[\\u2013\\u2014]";
const MONTHS = "janvier|janv|f[ée]vrier|f[ée]vr|mars|avril|avr|mai|juin|juillet|juil|ao[uû]t|septembre|sept|octobre|oct|novembre|nov|d[ée]cembre|d[ée]c|january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|november|december|dec";
const WEEKDAYS = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const TIME = "\\d{1,2}(?::\\d{2}(?::\\d{2})?|\\s?h(?:\\d{2})?)(?:\\s?[AaPp]\\.?[Mm]\\.?)?";
const DATE = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|\\d{1,2}(?:er)?\\s+(?:${MONTHS})\\b\\.?(?:\\s+\\d{4})?)`;
const POINT = `(?:${DATE}|${TIME}|(?:${WEEKDAYS}))`;
const POINT_RANGE = new RegExp(`(?<![\\w:/.-])(${POINT})\\s*${DASH}\\s*(${POINT})(?![\\w:])`, "giu");
const TIGHT_NUMBERS = new RegExp(`(?<=[\\d%$€])${DASH}(?=[$€]?\\d)`, "gu");

const OPEN = "\uE000";
const CLOSE = "\uE001";
const DIGIT_BASE = 0xe100;

function protect(text: string, saved: string[]): string {
  const keep = (segment: string) => {
    const id = [...String(saved.push(segment) - 1)].map((digit) => String.fromCharCode(DIGIT_BASE + Number(digit))).join("");
    return `${OPEN}${id}${CLOSE}`;
  };
  // fenced blocks (``` or ~~~, closed or open to the end), inline code, links and bare URLs
  const pattern = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?(?:\n[ \t]{0,3}\1[`~]*[ \t]*(?=\n|$)|$)|$)|(`+)[\s\S]*?[^`]\2(?!`)|\]\([^)\s]*\)|https?:\/\/[^\s)<>]+/gm;
  return text.replace(pattern, (segment) => keep(segment));
}

function restore(text: string, saved: string[]): string {
  const pattern = new RegExp(`${OPEN}([\\uE100-\\uE109]+)${CLOSE}`, "g");
  return text.replace(pattern, (_all, id: string) => saved[Number([...id].map((c) => c.charCodeAt(0) - DIGIT_BASE).join(""))] ?? "");
}

function rangeWord(language: string | undefined): string {
  const base = (language ?? "").trim().toLowerCase();
  if (base.startsWith("fr")) return " à ";
  if (base.startsWith("en")) return " to ";
  return "-";
}

function cleanLine(line: string, language: string | undefined): string {
  if (!/[\u2013\u2014]/.test(line)) return line;
  const french = (language ?? "").trim().toLowerCase().startsWith("fr");
  const word = rangeWord(language);
  let out = line;
  // an empty table cell
  out = out.replace(new RegExp(`(?<=\\|)\\s*${DASH}\\s*(?=\\|)`, "gu"), " - ");
  // a list item label: "- **Name** - what it does"
  out = out.replace(
    new RegExp(`^(\\s*(?:[-*+\\u2022]|\\d+[.)])\\s+)([^\\u2013\\u2014.!?;:\\n]{1,60}?)\\s*${DASH}\\s+(?=\\S)`, "u"),
    (_all, marker: string, label: string) => `${marker}${label}${french ? " : " : ": "}`,
  );
  // a dash opening a line is a list marker
  out = out.replace(new RegExp(`^(\\s*)${DASH}\\s*(?=\\S)`, "u"), "$1- ");
  // two times, dates or weekdays
  out = out.replace(POINT_RANGE, (_all, left: string, right: string) => `${left}${word === "-" ? "-" : word}${right}`);
  // two numbers stuck to the dash
  out = out.replace(TIGHT_NUMBERS, word);
  // the rest: a dash before punctuation or at the end of the line disappears
  out = out.replace(new RegExp(`\\s*${DASH}\\s*(?=[.,;:!?)\\]]|$)`, "gu"), "");
  // an aside: a comma, once
  out = out.replace(new RegExp(`\\s*,?\\s*${DASH}\\s*`, "gu"), ", ");
  return out;
}

/** The text of a reply with its em and en dashes replaced (see the top of
 * this file). `language` is the person's (a BCP-47 tag or "fr"/"en"). */
export function replaceDashes(text: string, language?: string): string {
  if (!/[\u2013\u2014]/.test(text)) return text;
  const saved: string[] = [];
  const guarded = protect(text, saved);
  const cleaned = guarded.split("\n").map((line) => cleanLine(line, language)).join("\n");
  return restore(cleaned, saved);
}
