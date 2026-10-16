// French a voice should say. Deterministic, no model and no xAI text
// normalization: times, prices, short ordinals and titles. A sentence that
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
  return n === 1 ? "1 heure" : `${n} heures`;
}

function money(amount: string, unit: "dollar" | "euro"): string {
  return `${amount} ${unit}${amount === "1" ? "" : "s"}`;
}

/** Expand the French notations a voice stumbles on. Other text stays. */
export function readFrench(input: string): string {
  let text = input;
  text = text.replace(/\bSte-/g, "Sainte-");
  text = text.replace(/\bSt-/g, "Saint-");
  text = text.replace(/\bMlle\b/g, "Mademoiselle");
  text = text.replace(/\bMme\b/g, "Madame");
  text = text.replace(/\bM\.(?=\s+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇ])/g, "Monsieur");
  text = text.replace(/\bDr\.?(?=\s+[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇ])/g, "Docteur");
  text = text.replace(/\b(1er|1re|[2-9]e|10e)\b/gi, (token) => ORDINALS[token.toLowerCase()] ?? token);
  text = text.replace(/(^|[^\p{L}\p{N}_])(\d{1,2})\s*h\s*(\d{1,2})(?![\p{L}\p{N}_])/giu, (_m, pre: string, hour: string, minutes: string) => `${pre}${heure(hour)} ${minutes}`);
  text = text.replace(/(^|[^\p{L}\p{N}_])(\d{1,2})\s*h(?![\p{L}\p{N}_])/giu, (_m, pre: string, hour: string) => `${pre}${heure(hour)}`);
  text = text.replace(/\$\s*(\d+(?:[.,]\d+)?)/g, (_m, amount: string) => money(amount, "dollar"));
  text = text.replace(/(\d+(?:[.,]\d+)?)\s*\$/g, (_m, amount: string) => money(amount, "dollar"));
  text = text.replace(/€\s*(\d+(?:[.,]\d+)?)/g, (_m, amount: string) => money(amount, "euro"));
  text = text.replace(/(\d+(?:[.,]\d+)?)\s*€/g, (_m, amount: string) => money(amount, "euro"));
  return text;
}
