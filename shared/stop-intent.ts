/** A message that only asks the running turn to stop ("stop", "arrête",
 * "attends", "wait", "laisse tomber"...). Whole-message intents only, at most
 * a few words, so a sentence that mentions stopping something ("stop the
 * server when done", "arrête de répondre en anglais", "attends que le build
 * finisse") is an ordinary message. 2026-10-28: "attends" and "wait" stop
 * too; before, they were read after the running tool, so the bot finished
 * first. */

const STOP_PHRASES = new Set([
  // English
  "stop",
  "stop it",
  "stop now",
  "stop that",
  "stop stop",
  "stop right now",
  "stop right there",
  "cancel",
  "cancel it",
  "cancel that",
  "halt",
  "abort",
  "wait",
  "wait wait",
  "wait a sec",
  "wait a second",
  "wait a minute",
  "hold on",
  "hold it",
  "hang on",
  "pause",
  "never mind",
  "nevermind",
  "forget it",
  "enough",
  // French (accents are folded first)
  "arrete",
  "arrete ca",
  "arrete tout",
  "arrete toi",
  "arretez",
  "arretez ca",
  "arretez tout",
  "arrete arrete",
  "stoppe",
  "stoppe ca",
  "annule",
  "annule ca",
  "annule tout",
  "annuler",
  "attends",
  "attend",
  "attendez",
  "attends attends",
  "attends une minute",
  "attends une seconde",
  "une minute",
  "une seconde",
  "minute",
  "laisse tomber",
  "laisse faire",
  "oublie ca",
  "oublie",
  "ca suffit",
  "assez",
  // Spanish and German, the other shipped languages
  "para",
  "espera",
  "cancela",
  "stopp",
  "warte",
  "abbrechen",
]);

/** A stop sign typed or pasted on its own. */
const STOP_SIGNS = new Set(["🛑", "✋", "⏹", "⏹️", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"]);

const POLITE = new Set(["please", "pls", "svp", "stp", "ok", "okay"]);

const MAX_WORDS = 4;

export function normalizeStopText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[!.…?,;:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isStopIntent(text: string): boolean {
  if (typeof text !== "string" || text.length > 64) return false;
  if (STOP_SIGNS.has(text.trim())) return true;
  const words = normalizeStopText(text).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return false;
  // a polite word may lead or close, once each: "ok stop", "stop svp"
  let start = 0;
  let end = words.length;
  if (POLITE.has(words[start]!) && end - start > 1) start += 1;
  if (POLITE.has(words[end - 1]!) && end - start > 1) end -= 1;
  return STOP_PHRASES.has(words.slice(start, end).join(" "));
}
