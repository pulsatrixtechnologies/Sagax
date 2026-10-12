// When a streaming STT partial is stable enough to start the LLM before
// the person has stopped talking (issue #292). Pure. The in-flight send is
// discarded if the next partial says something else.

import { materiallyDifferent } from "./latency";
import { completeClause, incompleteClause } from "./turns";

const MIN_WORDS = 4;
const MIN_WORDS_SILENCE = 4;

function wordCount(text: string): number {
  return (text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? []).length;
}

/** Four stable words, or a closed clause once the person has paused.
 * A mid-speech "Say hello." from STT is not the whole question: wait.
 * Three words ("What is two", "What is 2 +") is still unfinished. */
export function maySpeculate(text: string, inSilence = false): boolean {
  if (inSilence && completeClause(text)) return true;
  const min = inSilence ? MIN_WORDS_SILENCE : MIN_WORDS;
  return wordCount(text) >= min && !incompleteClause(text);
}

/** The person kept talking and the question changed: cancel that send. */
export function discardSpeculation(sent: string, nextPartial: string): boolean {
  return materiallyDifferent(sent, nextPartial);
}

/** Speculative LLM/TTS may run during the endpoint wait. Playback waits
 * until the turn actually ended, and is dropped if they keep talking. */
export function holdSpeculativePlayback(input: {
  speculative: boolean;
  endpointConfirmed: boolean;
}): boolean {
  return input.speculative && !input.endpointConfirmed;
}
