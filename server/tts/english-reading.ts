// English a voice should say. Deterministic, no model: ISO dates
// ("2026-10-18" as "October 18, 2026") and 24 hour clock times ("15:30" as
// "3:30 PM"). A time that already says AM or PM, or a 12 hour time that
// could be either ("3:30"), stays as written. Applied when the call's
// language is English, or automatic and the text looks English (more
// English function words than French ones, at least two), on the streaming
// speech paths (server/tts/voice-reading.ts).
import { CLOCK, ISO_DATE, isTimeOfDay } from "./french-reading.ts";

const ENGLISH_WORDS = new Set([
  "the", "and", "is", "are", "was", "you", "your", "we", "it", "this", "that", "with", "for", "from", "have", "has",
  "not", "but", "can", "will", "what", "which", "who", "when", "where", "how", "of", "to", "in", "at", "be", "do", "yes",
  "thanks", "hello", "today", "tomorrow", "my", "on", "i", "it's", "i'm", "there", "its",
]);
const FRENCH_WORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "est", "pas", "je", "tu", "il", "elle", "nous", "vous",
  "que", "qui", "pour", "avec", "dans", "sur", "mais", "oui", "non", "c'est", "j'ai", "à",
]);

/** The text reads as English: at least two English function words, more
 * than French ones, and no accented letter. Unsure: false. */
export function looksEnglish(text: string): boolean {
  if (/[àâçéèêëîïôûùüÿœ]/i.test(text)) return false;
  let en = 0;
  let fr = 0;
  for (const word of text.toLowerCase().match(/[a-z'-]+/g) ?? []) {
    if (ENGLISH_WORDS.has(word)) en += 1;
    if (FRENCH_WORDS.has(word)) fr += 1;
  }
  return en >= 2 && en > fr;
}

/** Read this text as English: an English call, or an automatic one whose
 * text looks English. */
export function readsEnglishText(language: string, text: string): boolean {
  const lang = language.toLowerCase();
  if (lang.split("-")[0] === "en") return true;
  return lang === "auto" && looksEnglish(text);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "3:30 PM", "9 AM", "noon", "midnight"; null for a time that is no time. */
function clock(hour: string, minutes: string): string | null {
  const h = Number(hour);
  const m = Number(minutes);
  if (h > 23 || m > 59) return null;
  if (m === 0 && h === 12) return "noon";
  if (m === 0 && h === 0) return "midnight";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${m === 0 ? twelve : `${twelve}:${minutes}`} ${h < 12 ? "AM" : "PM"}`;
}

/** Expand the notations an English voice reads as digits. Other text stays. */
export function readEnglish(input: string): string {
  let text = input;
  text = text.replace(ISO_DATE, (whole, pre: string, year: string, month: string, day: string, hour?: string, minutes?: string, zone?: string) => {
    const mo = Number(month);
    const d = Number(day);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return whole;
    const date = `${MONTHS[mo - 1]} ${d}, ${year}`;
    if (hour === undefined || minutes === undefined) return `${pre}${date}`;
    const time = clock(hour, minutes);
    if (time === null) return whole;
    return `${pre}${date} at ${time}${zone === "Z" || zone === "z" ? " UTC" : ""}`;
  });
  // a 24 hour time: past noon, midnight's hour, or written with a leading
  // zero; "3:30" (morning or afternoon?) and "3:30 PM" stay
  text = text.replace(CLOCK, (whole, pre: string, hour: string, minutes: string, seconds: string | undefined, offset: number, all: string) => {
    // a duration ("uptime 00:45:12", "took 03:12") or an AM/PM time stays
    if (!isTimeOfDay(all, offset, whole, pre, hour, seconds)) return whole;
    const h = Number(hour);
    if (!(h >= 13 || h === 0 || (hour.length === 2 && hour.startsWith("0")) || (h === 12 && minutes === "00"))) return whole;
    const time = clock(hour, minutes);
    return time === null ? whole : `${pre}${time}`;
  });
  return text;
}
