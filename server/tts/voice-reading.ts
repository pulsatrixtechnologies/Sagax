// Numbers, times and dates the way a person says them, in the language the
// text is in (docs/voice-mode-xai.md, "The bot knows it is on the phone").
// The bot is asked to write them that way already; this is the
// deterministic net on the streaming speech paths. French text gets
// readFrench, English text readEnglish, anything else stays as written.
// `context` is the utterance said so far, when the text is appended to it.
import { readEnglish, readsEnglishText } from "./english-reading.ts";
import { readFrench, readsFrenchText } from "./french-reading.ts";

export function readForVoice(language: string, text: string, context = ""): string {
  if (!text) return text;
  const judged = `${context}${text}`;
  if (readsFrenchText(language, judged)) return readFrench(text);
  if (readsEnglishText(language, judged)) return readEnglish(text);
  return text;
}
