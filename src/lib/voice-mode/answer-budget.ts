// How much of an answer a call says aloud. Pure.
//
// The bot is told the voice output contract (server/voice-call-prompt.ts:
// the verdict first, one to four short spoken sentences, at most one
// question and only for a real decision). A model still runs long or asks
// two things at once; on a phone that is a monologue the person cannot
// skim. This is the deterministic cap on the page's side:
//
// - At most SPOKEN_SENTENCES_MAX sentences are said. A line break after
//   words counts as a sentence end too (a list the bot slipped in is one
//   line per item). The words after the cap stay in the chat, and the call
//   says once that the rest is there (`voiceMode.restInChat`).
// - A question ends what is said: the person answers it. A second
//   question, or anything after the first one, stays in the chat.
//
// The cap applies to the whole text so far and keeps a prefix of it: once
// the cut is reached nothing after it is ever kept, so an answer still being
// written is cut at the same place once it is complete.
// The written follow-up below `---` is never spoken (spokenPart).

import { isAbbreviationDot } from "./sentences";
import { speakableSentence, spokenPart } from "./spoken";

/** The most sentences a call says of one answer. */
export const SPOKEN_SENTENCES_MAX = 4;

/** Why the spoken answer stops before the written one: `length` (the
 * sentence cap: the call says the rest is in the chat), `question` (the
 * first question ends it: the person answers), or null (said whole). */
export type SpokenAnswerCut = "length" | "question" | null;

/** A sentence end: ., !, ?, … (closing quotes kept) before a space or the
 * end, or a line break. */
const END = /([.!?…]+)["'»)\]]*(?=\s|$)|\n/g;

/** The part of an answer a call says aloud, and why it stops early. */
export function spokenAnswer(text: string, max = SPOKEN_SENTENCES_MAX): { text: string; cut: SpokenAnswerCut } {
  const spoken = spokenPart(text);
  let count = 0;
  let from = 0;
  END.lastIndex = 0;
  for (let match = END.exec(spoken); match; match = END.exec(spoken)) {
    const marks = match[1];
    const end = match.index + match[0].length;
    // an abbreviation, an initial or a list number ("1.") ends nothing
    if (marks === "." && isAbbreviationDot(spoken, match.index)) continue;
    // a sentence needs words: a lone "1." or an empty line is not one
    if (!/\p{L}/u.test(spoken.slice(from, match.index))) {
      from = end;
      continue;
    }
    from = end;
    count += 1;
    const question = Boolean(marks?.includes("?"));
    if (!question && count < max) continue;
    // the cut keeps the space after it: the text so far only ever grows,
    // so a sentence stream fed with it never starts over
    const rest = spoken.slice(end);
    const kept = spoken.slice(0, end + (/^\s*/.exec(rest)?.[0].length ?? 0));
    return { text: kept, cut: speakableSentence(rest) ? (question ? "question" : "length") : null };
  }
  return { text: spoken, cut: null };
}

/** A settled answer said whole at once (the older call, a room): what
 * spokenAnswer keeps, then `restInChat` when the sentence cap cut it (null:
 * the call's language has no such words, so nothing is added). */
export function spokenReply(text: string, restInChat: string | null): string {
  const answer = spokenAnswer(text);
  const said = answer.text.trim();
  return answer.cut === "length" && said && restInChat ? `${said} ${restInChat}` : said;
}
