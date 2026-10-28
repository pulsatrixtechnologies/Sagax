// A vault value used to fill a page is not key-shaped, so the pattern scrub
// leaves it in a prompt or a journal. This list is memory of the process
// only: it is never written down, and it is gone when the process stops.
// The browser session redactor still covers that session's own results.
import { REDACTED_CREDENTIAL, variants } from "./credential-fill.ts";

const MAX_SECRETS = 32;
const noted: string[] = [];

/** Remember a value that was just used to fill. Short values are skipped:
 * they are ordinary words, and the session redactor already hides a code. */
export function noteFilledSecret(value: string): void {
  if (typeof value !== "string" || value.length < 4) return;
  const at = noted.indexOf(value);
  if (at >= 0) noted.splice(at, 1);
  noted.push(value);
  if (noted.length > MAX_SECRETS) noted.shift();
}

/** Replace a filled value, and the encodings a page or a log would show, with
 * the same marker the browser result uses. */
export function redactFilledSecrets(text: string): string {
  if (!text || noted.length === 0) return text;
  let out = text;
  for (const value of noted) {
    for (const variant of variants(value)) {
      if (!variant || !out.includes(variant)) continue;
      out = out.split(variant).join(REDACTED_CREDENTIAL);
    }
  }
  return out;
}

/** Tests only. */
export function resetFilledSecrets(): void {
  noted.length = 0;
}
