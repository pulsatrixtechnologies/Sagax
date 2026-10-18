// French a voice should say. Deterministic, no model and no xAI text
// normalization: times ("14 h 30", "14:30"), ISO dates ("2026-10-18" as
// "18 octobre 2026"), prices, percentages, decimals, short ordinals and
// titles. A sentence that
// is already words is unchanged. Applied when the call's language is French
// (`fr` or `fr-*`), or automatic and the text looks French (an accent, or
// more French function words than English ones), on the streaming speech
// paths.

/** True when this call should be read as French. */
export function readsFrench(language: string): boolean {
  return language.toLowerCase().split("-")[0] === "fr";
}

/** French function words that are not English words. */
const FRENCH_WORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "est", "pas", "je", "tu", "il", "elle", "nous", "vous", "ils",
  "elles", "que", "qui", "quoi", "pour", "avec", "dans", "sur", "mais", "ou", "oui", "non", "merci", "bonjour",
  "ce", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "son", "sa", "ses", "au", "aux", "c'est", "j'ai",
  "votre", "notre", "leur", "très", "bien", "aussi", "demain", "aujourd'hui", "heures", "rendez-vous",
]);
const ENGLISH_WORDS = new Set([
  "the", "and", "is", "are", "was", "you", "your", "we", "it", "this", "that", "with", "for", "from", "have", "has",
  "not", "but", "can", "will", "what", "which", "who", "when", "where", "how", "of", "to", "in", "at", "be", "do", "yes",
  "thanks", "hello", "today", "tomorrow", "my",
]);

/** The text reads as French: an accented letter, or more French function
 * words than English ones (at least two). Unsure: false. */
export function looksFrench(text: string): boolean {
  if (/[àâçéèêëîïôûùüÿœ]/i.test(text)) return true;
  let fr = 0;
  let en = 0;
  for (const word of text.toLowerCase().match(/[a-zà-ÿœ'-]+/g) ?? []) {
    if (FRENCH_WORDS.has(word)) fr += 1;
    if (ENGLISH_WORDS.has(word)) en += 1;
  }
  return fr >= 2 && fr > en;
}

/** Read this text as French: a French call, or an automatic one whose text
 * looks French. */
export function readsFrenchText(language: string, text: string): boolean {
  if (readsFrench(language)) return true;
  return language.toLowerCase() === "auto" && looksFrench(text);
}

const ORDINALS: Readonly<Record<string, string>> = {
  "1er": "premier",
  "1re": "première",
  "2e": "deuxième",
  "3e": "troisième",
  "4e": "quatrième",
  "5e": "cinquième",
  "6e": "sixième",
  "7e": "septième",
  "8e": "huitième",
  "9e": "neuvième",
  "10e": "dixième",
};

function heure(hour: string): string {
  const n = Number(hour);
  if (n === 0) return "minuit";
  return n === 1 ? "1 heure" : `${n} heures`;
}

/** "14 heures 30", "9 heures" (no "00"), "minuit 5". */
function heureMinutes(hour: string, minutes: string): string {
  const m = Number(minutes);
  return m === 0 ? heure(hour) : `${heure(hour)} ${m}`;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** An ISO date ("2026-10-18", time and zone optional) as a person says it,
 * or null when it is not a real date. */
function dateFrancaise(year: string, month: string, day: string, hour?: string, minutes?: string, zone?: string): string | null {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = `${d === 1 ? "1er" : d} ${MOIS[m - 1]} ${year}`;
  if (hour === undefined || minutes === undefined) return date;
  if (Number(hour) > 23 || Number(minutes) > 59) return null;
  return `${date} à ${heureMinutes(hour, minutes)}${zone === "Z" || zone === "z" ? " UTC" : ""}`;
}

function money(amount: string, unit: "dollar" | "euro"): string {
  return `${amount} ${unit}${amount === "1" ? "" : "s"}`;
}

/** An ISO date, optionally with a time ("T" or a space) and a zone. */
export const ISO_DATE = /(^|[^\p{L}\p{N}_-])(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?(?![\p{L}\p{N}_:-])/gu;
/** A clock time: H:MM or HH:MM, seconds optional, not part of a longer run. */
export const CLOCK = /(^|[^\p{L}\p{N}_:.])(\d{1,2}):(\d{2})(?::\d{2})?(?![\p{N}_:]|\.\d)/gu;

/** Expand the French notations a voice stumbles on. Other text stays. */
export function readFrench(input: string): string {
  let text = input;
  text = text.replace(/\bSte-/g, "Sainte-");
  text = text.replace(/\bSt-/g, "Saint-");
  text = text.replace(/\bMlle\b/g, "Mademoiselle");
  text = text.replace(/\bMme\b/g, "Madame");
  text = text.replace(/\bM\.(?=\s+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇ])/g, "Monsieur");
  text = text.replace(/\bDr\.?(?=\s+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇ])/g, "Docteur");
  // ISO dates first (their "1er" is read below), with a time and zone when given
  text = text.replace(ISO_DATE, (whole, pre: string, year: string, month: string, day: string, hour?: string, minutes?: string, zone?: string) => {
    const read = dateFrancaise(year, month, day, hour, minutes, zone);
    return read === null ? whole : `${pre}${read}`;
  });
  text = text.replace(/\b(1er|1re|[2-9]e|10e)\b/gi, (token) => ORDINALS[token.toLowerCase()] ?? token);
  // "14:30", "09:05:12": a 24 hour clock, seconds left out
  text = text.replace(CLOCK, (whole, pre: string, hour: string, minutes: string) =>
    Number(hour) > 23 || Number(minutes) > 59 ? whole : `${pre}${heureMinutes(hour, minutes)}`);
  text = text.replace(/(^|[^\p{L}\p{N}_])(\d{1,2})\s*h\s*(\d{1,2})(?![\p{L}\p{N}_])/giu, (_m, pre: string, hour: string, minutes: string) => `${pre}${heureMinutes(hour, minutes)}`);
  text = text.replace(/(^|[^\p{L}\p{N}_])(\d{1,2})\s*h(?![\p{L}\p{N}_])/giu, (_m, pre: string, hour: string) => `${pre}${heure(hour)}`);
  text = text.replace(/\$\s*(\d+(?:[.,]\d+)?)/g, (_m, amount: string) => money(amount, "dollar"));
  text = text.replace(/(\d+(?:[.,]\d+)?)\s*\$/g, (_m, amount: string) => money(amount, "dollar"));
  text = text.replace(/€\s*(\d+(?:[.,]\d+)?)/g, (_m, amount: string) => money(amount, "euro"));
  text = text.replace(/(\d+(?:[.,]\d+)?)\s*€/g, (_m, amount: string) => money(amount, "euro"));
  text = text.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, amount: string) => `${amount} pour cent`);
  // a decimal point is a comma in French ("3.5" as "3,5"); a version or an
  // address with more dots stays
  text = text.replace(/(?<![\d.,])(\d+)\.(\d+)(?![\d]|\.\d)/g, "$1,$2");
  return text;
}
