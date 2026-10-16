// One xAI utterance per answer on the streaming voice, so its intonation
// runs on from clause to clause like one person talking (issue #292).
// xAI's websocket starts audio on `text.delta` and waits for `text.done` at
// the end of the utterance. The answer opens one utterance (`begin`) with its
// first words, often a single grok token, so TTS starts while the rest is
// written; every later clause grows it (`append`); it ends (`finish`) only
// when the answer is done, or, past ROLL_CHARS, at the end of a sentence (a
// new utterance takes the next one). Over POST each clause is its own
// request (`speak`). Pure.
//
// The words still being written (the lead) are cleaned like a clause
// (spoken.ts) before they are sent, and nothing opens until they hold a
// letter: "**Oui**" never opens on a lone "*". A lead stops before a link,
// code or a table (their cleaning depends on what follows) and before a
// last word with a digit ("14h30", "25 $" are read whole on the server).

import { speakableSentence } from "./spoken";

/** Past this many characters an utterance ends at the next sentence end. */
export const ROLL_CHARS = 1_500;

export type TtsLeadAction =
  | { action: "speak"; text: string }
  | { action: "begin"; text: string; caption?: TtsCaption }
  | { action: "append"; text: string; caption?: TtsCaption }
  | { action: "finish" };

/** A clause for the captions: its words and where they start in the
 * utterance's text (characters). */
export interface TtsCaption {
  text: string;
  at: number;
}

export interface TtsLeadState {
  /** characters sent in the open utterance, null when none is open */
  open: number | null;
  /** the words of the clause being written already sent, "" when none */
  lead: string;
  /** where that clause starts in the utterance */
  clauseAt: number;
}

export const NO_LEAD: TtsLeadState = { open: null, lead: "", clauseAt: 0 };

/** A sentence ends here: an utterance may roll over after it. */
const SENTENCE_END = /[.!?…]["'»)\]]*$/;

export function ttsLeadStep(input: {
  streaming: boolean;
  state: TtsLeadState;
  /** clauses the sentence stream completed since the last step */
  emitted: string[];
  /** the text written after them (raw) */
  unconsumed: string;
  /** the answer is complete: end the utterance */
  done?: boolean;
}): { actions: TtsLeadAction[]; state: TtsLeadState } {
  const emitted = input.emitted.filter((text) => text.trim());
  const actions: TtsLeadAction[] = [];
  let { open, lead, clauseAt } = input.state;

  if (!input.streaming) {
    // the socket gave up mid-answer: it said (or POSTed) the open part
    if (open !== null) actions.push({ action: "finish" });
    open = null;
    for (const text of emitted) {
      let rest = text;
      if (lead) {
        rest = text.startsWith(lead) ? text.slice(lead.length).trim() : text;
        lead = "";
      }
      if (rest) actions.push({ action: "speak", text: rest });
    }
    return { actions, state: { open: null, lead, clauseAt: 0 } };
  }

  for (const text of emitted) {
    if (open === null) {
      actions.push({ action: "begin", text, caption: { text, at: 0 } });
      open = text.length;
      lead = "";
    } else if (lead) {
      if (lead.startsWith(text)) {
        // the lead ran past this clause: the rest of it opens the next one
        actions.push({ action: "append", text: "", caption: { text, at: clauseAt } });
        const rest = lead.slice(text.length);
        const next = rest.trimStart();
        clauseAt += text.length + (rest.length - next.length);
        lead = next;
        continue;
      }
      const tail = continuation(lead, text);
      actions.push({ action: "append", text: tail, caption: { text, at: clauseAt } });
      open += tail.length;
      lead = "";
    } else {
      const piece = ` ${text}`;
      actions.push({ action: "append", text: piece, caption: { text, at: open + 1 } });
      open += piece.length;
    }
    if (open >= ROLL_CHARS && SENTENCE_END.test(text)) {
      actions.push({ action: "finish" });
      open = null;
    }
  }

  const words = input.done ? "" : leadText(input.unconsumed);
  if (words) {
    if (open === null) {
      actions.push({ action: "begin", text: words });
      open = words.length;
      clauseAt = 0;
      lead = words;
    } else if (!lead) {
      const piece = ` ${words}`;
      actions.push({ action: "append", text: piece });
      clauseAt = open + 1;
      open += piece.length;
      lead = words;
    } else if (words.length > lead.length && words.startsWith(lead)) {
      const piece = words.slice(lead.length);
      actions.push({ action: "append", text: piece });
      open += piece.length;
      lead = words;
    }
  }

  if (input.done && open !== null) {
    actions.push({ action: "finish" });
    open = null;
    lead = "";
  }
  return { actions, state: { open, lead, clauseAt } };
}

/** The words of an unfinished clause that may go to the voice now. */
export function leadText(raw: string): string {
  // a link, code, a table or HTML: wait for the clause
  const stop = raw.search(/[[<`|]|https?:|www\./i);
  const safe = stop >= 0 ? raw.slice(0, stop) : raw;
  let text = speakableSentence(safe).replace(/(^|\s)[_~]+(?=\S)/g, "$1");
  // last words with a digit or a currency may still change how they read
  for (;;) {
    const last = /\S+$/.exec(text)?.[0] ?? "";
    if (!last || !/[\p{N}$€%]/u.test(last)) break;
    text = text.slice(0, text.length - last.length).trimEnd();
  }
  return /\p{L}/u.test(text) ? text : "";
}

/** What of a finished clause the voice has not said yet: after the lead,
 * or, when the clause was rewritten, from the last word they share (a word
 * may be said twice, never lost). */
function continuation(lead: string, clause: string): string {
  if (clause.startsWith(lead)) return clause.slice(lead.length);
  let shared = 0;
  while (shared < lead.length && shared < clause.length && lead[shared] === clause[shared]) shared += 1;
  const space = clause.lastIndexOf(" ", shared);
  return space > 0 ? clause.slice(space) : ` ${clause}`;
}
