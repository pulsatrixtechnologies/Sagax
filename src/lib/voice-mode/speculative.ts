// When a streaming STT partial is stable enough to start the LLM before
// the person has stopped talking (issue #292). Pure. The in-flight send is
// discarded if the next partial says something else.

import { materiallyDifferent } from "./latency";
import { completeClause, incompleteClause } from "./turns";

const MIN_WORDS_SILENCE = 4;

/** Wait this long after a revised partial before replacing the guess.
 * STT restates a long question several times; each replace restarts grok
 * TTFB (real19 turn 18: four continues, firstToken 12250). */
export const SPECULATIVE_REVISE_MS = 320;

/** The revised partial has been unchanged long enough to replace the guess. */
export function mayReviseSpeculation(changedAt: number, now: number, reviseMs = SPECULATIVE_REVISE_MS): boolean {
  return now - changedAt >= reviseMs;
}

function wordCount(text: string): number {
  return (text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? []).length;
}

/** Only once the person has paused: four stable words that are not an
 * unfinished clause, or a closed clause. Never while they are still
 * talking: a mid-speech guess ("Say hello." before "in French") restarted
 * the bot on every new word. Three words ("What is two", "What is 2 +")
 * is still unfinished. A guess never shortens the turn's end (turns.ts). */
export function maySpeculate(text: string, inSilence = false): boolean {
  if (!inSilence) return false;
  if (completeClause(text)) return true;
  return wordCount(text) >= MIN_WORDS_SILENCE && !incompleteClause(text);
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
