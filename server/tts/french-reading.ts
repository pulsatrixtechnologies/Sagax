// French a voice should say. Deterministic, no model and no xAI text
// normalization: times, prices, short ordinals and titles. A sentence that
// is already words is unchanged. Applied only when the call's language is
// French (`fr` or `fr-*`), on the streaming speech paths.

/** True when this call should be read as French. */
export function readsFrench(language: string): boolean {
  return language.toLowerCase().split("-")[0] === "fr";
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
