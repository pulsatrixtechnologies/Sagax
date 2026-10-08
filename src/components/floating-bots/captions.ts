// Captions beside the desktop mascot during a call, as pure rules (tested in
// captions.test.ts): the live line of the current sentence, the person's
// words as the speech to text hears them and the bot's sentence revealed word
// by word while its voice says it, three lines at most (older lines scroll
// up and out). The window keeps one CaptionState and asks these.
import type { CallPhase } from "@/lib/voice-mode/call-machine";

/** At most this many lines show; older ones scroll away. */
export const CAPTION_LINES = 3;
/** About this many characters fit a line of the caption (12.5 px type, 196 px wide). */
export const CAPTION_CHARS = 30;
/** The bot's words appear at about speaking pace (times the voice's speed setting). */
export const WORDS_PER_SECOND = 2.6;

export interface CaptionState {
  who: "you" | "bot";
  /** The whole sentence (the person's words so far, or the bot's sentence now audible). */
  text: string;
  /** When this sentence began to show (its words are revealed from then). */
  since: number;
}

export interface CaptionInput {
  phase: CallPhase;
  /** FloatingCall.line: the person's words while heard, the bot's sentence while it speaks. */
  line: string;
  /** The call's last finished line, shown whole while nothing is live (a new caption starts from it). */
  last?: { who: "you" | "bot"; text: string } | null;
  now: number;
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** The caption after a new snapshot of the call: what is said now, or the last thing said. */
export function captionFeed(state: CaptionState | null, { phase, line, last, now }: CaptionInput): CaptionState | null {
  if (phase === "connecting" || phase === "ended") return null;
  const text = tidy(line);
  if (text && (phase === "hearing" || phase === "interrupted")) {
    // the person's words grow as they are heard: the same caption, shown whole
    return state?.who === "you" && state.text === text ? state : { who: "you", text, since: state?.who === "you" ? state.since : now };
  }
  if (text && phase === "speaking") {
    // a new sentence of the bot's answer starts revealing from now
    return state?.who === "bot" && state.text === text ? state : { who: "bot", text, since: now };
  }
  // listening, thinking, on hold: the last sentence stays, whole
  if (state) return state;
  const done = last ? tidy(last.text) : "";
  return done ? { who: last!.who, text: done, since: -Infinity } : null;
}

/** How many of the bot's words show at `now`: one at once, then at speaking pace; the person's all at once. */
export function revealedWords(state: CaptionState, now: number, wordsPerSecond = WORDS_PER_SECOND): number {
  const words = state.text ? state.text.split(" ").length : 0;
  if (state.who === "you" || !Number.isFinite(state.since)) return words;
  const pace = Math.max(0.5, wordsPerSecond);
  return Math.min(words, 1 + Math.floor((Math.max(0, now - state.since) / 1000) * pace));
}

/** The caption's text at `now`. */
export function captionText(state: CaptionState | null, now: number, wordsPerSecond = WORDS_PER_SECOND): string {
  if (!state) return "";
  return state.text.split(" ").slice(0, revealedWords(state, now, wordsPerSecond)).join(" ");
}

/** In how many ms the next word shows (null: all shown). */
export function nextWordIn(state: CaptionState | null, now: number, wordsPerSecond = WORDS_PER_SECOND): number | null {
  if (!state || state.who === "you" || !Number.isFinite(state.since)) return null;
  const words = state.text.split(" ").length;
  const shown = revealedWords(state, now, wordsPerSecond);
  if (shown >= words) return null;
  const pace = Math.max(0.5, wordsPerSecond);
  return Math.max(16, Math.ceil(state.since + (shown * 1000) / pace - now));
}

/** The text wrapped to lines of `chars` (a longer word gets a line of its own, cut), keeping the last `max` lines. */
export function captionLines(text: string, chars = CAPTION_CHARS, max = CAPTION_LINES): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of tidy(text).split(" ").filter(Boolean)) {
    const piece = word.length > chars ? `${word.slice(0, chars - 1)}…` : word;
    if (!current) current = piece;
    else if (current.length + 1 + piece.length <= chars) current += ` ${piece}`;
    else {
      lines.push(current);
      current = piece;
    }
  }
  if (current) lines.push(current);
  return lines.slice(-Math.max(1, max));
}
