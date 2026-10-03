// When the person starts and stops talking, from one voice probability per
// 32 ms frame (Silero VAD, vad.ts) and the frame's level. Pure: no browser
// API, so the unit tests drive every rule with a fake clock.
//
// - Speech starts after `startMs` of voiced frames (hysteresis: a frame is
//   voiced above `positive`, unvoiced below `negative`).
// - While the bot is audible the bar is higher (`bargeIn*`): Chromium's echo
//   canceller leaves a residue of the bot's own voice, and the echo guard
//   (echo.ts) says whether the microphone is louder than that residue.
// - A turn ends after `endpointMs` of silence. The endpoint adapts to the
//   person: a pause that almost ended a turn, then went on, stretches it
//   (up to `maxEndpointMs`); turns that end cleanly shrink it back toward
//   `minEndpointMs`. Fast talkers get fast answers, slow talkers are not cut.
// - Too short to be a sentence (a cough, a click): `cancel`, never a turn.
// - A level gate keeps far-field sound (a TV across the room) out: a voiced
//   frame must be over the room's noise floor, and once the person's own
//   level is known (`nearLevel`, from enrollment or past turns), over a share
//   of it.

// - What was said so far moves the endpoint too (`hint`, the streaming
//   transcript's words): a clause that is not finished (no final
//   punctuation and a trailing "and", "to", "the", "de", "pour"..., a
//   trailing comma or filler, or a fragment of one or two words) waits
//   `incompleteMs` longer, so "give me a good prompt to" is not sent as is.
// - The person's pace preference (`pause`: short, normal, patient) sets the
//   range; the adaptation works inside it.
// - A sentence that is clearly over ends sooner (`completeMs`): the words so
//   far close with final punctuation ("what time is it?"), and the silence
//   after them is confident (the VAD is sure nobody speaks, not just under
//   its threshold). A pause inside a sentence never ends it early, and a
//   person who goes on after it is joined back (call.ts CONTINUATION_MS).

export const FRAME_MS = 32;

/** The endpoint range for each pause preference (the call's settings). */
export const PAUSE_PRESETS = {
  short: { minEndpointMs: 420, endpointMs: 520, maxEndpointMs: 800, incompleteMs: 500, completeMs: 288 },
  normal: { minEndpointMs: 560, endpointMs: 700, maxEndpointMs: 1_100, incompleteMs: 750, completeMs: 352 },
  patient: { minEndpointMs: 800, endpointMs: 1_000, maxEndpointMs: 1_500, incompleteMs: 1_000, completeMs: 576 },
} as const;

/** Under this voice probability a silent frame is a confident one. */
export const QUIET_PROBABILITY = 0.15;

export type PausePreset = keyof typeof PAUSE_PRESETS;

/** Words a sentence does not end on (English and French): a clause that
 * stops on one is still going. */
const CONTINUING_WORDS = new Set([
  // English
  "and", "or", "but", "so", "because", "to", "the", "a", "an", "of", "in", "on", "at", "for", "with", "from", "about",
  "my", "your", "our", "their", "his", "her", "its", "if", "that", "when", "which", "who", "is", "are", "was", "be",
  "into", "like", "than", "then", "as", "by", "me", "uh", "um", "erm", "hmm", "please",
  // French
  "et", "ou", "mais", "donc", "parce", "que", "qu", "qui", "de", "du", "des", "le", "la", "les", "l", "un", "une",
  "au", "aux", "pour", "avec", "dans", "sur", "en", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
  "notre", "votre", "leur", "si", "quand", "est", "c", "ce", "cette", "comme", "euh", "ben", "puis",
]);

/** The words so far are a finished sentence: closed by final punctuation
 * (the recognizer's own judgment: "what my next meeting is?" ends on "is")
 * and at least two words. The turn may end on a shorter, confident silence. */
export function completeClause(text: string): boolean {
  const trimmed = text.trim();
  if (!/[.!?\u2026]["')\]]*$/.test(trimmed)) return false;
  const words = trimmed.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? [];
  // "Mr." alone, or a lone word: not a sentence to answer yet
  return words.length >= 2;
}

/** The words so far do not finish a sentence: wait longer before ending
 * the turn. Unknown words (no transcript yet) are not judged. */
export function incompleteClause(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // a sentence the recognizer closed is complete
  if (/[.!?\u2026]["')\]]*$/.test(trimmed)) return false;
  if (/[,;:\u2013-]$/.test(trimmed)) return true;
  const words = trimmed.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? [];
  if (!words.length) return false;
  if (CONTINUING_WORDS.has(words.at(-1)!)) return true;
  // one or two words with no closing punctuation: a fragment
  return words.length <= 2;
}

export interface TurnOptions {
  positive?: number;
  negative?: number;
  startMs?: number;
  /** while the bot is audible */
  bargeInPositive?: number;
  bargeInStartMs?: number;
  minEndpointMs?: number;
  maxEndpointMs?: number;
  endpointMs?: number;
  /** shorter than this, a turn is a noise */
  minTurnMs?: number;
  maxTurnMs?: number;
  /** the person's usual speaking level (RMS), when known */
  nearLevel?: number;
  /** added to the endpoint while the words so far are an unfinished clause */
  incompleteMs?: number;
  /** share of nearLevel a voiced frame needs (far-field rejection) */
  nearShare?: number;
  /** the endpoint once the words so far are a finished sentence and the
   * silence is confident (0: never early) */
  completeMs?: number;
}

export interface FrameInput {
  /** Silero voice probability, 0..1 */
  probability: number;
  /** RMS of the frame, 0..1 */
  level: number;
  /** the bot's voice is playing now */
  botAudible?: boolean;
  /** the echo guard says the microphone is only the bot's echo */
  echo?: boolean;
}

export type TurnEvent =
  /** voiced frames began (a candidate: duck the bot, start streaming audio) */
  | { type: "candidate"; bargeIn: boolean }
  /** it is speech: a turn has begun (confirm a barge-in) */
  | { type: "start"; bargeIn: boolean }
  /** the candidate died out before `start`, or the turn was too short */
  | { type: "cancel" }
  /** the person stopped talking */
  | { type: "end"; speechMs: number; endpointMs: number; early?: boolean };

type State = "idle" | "candidate" | "speaking";

export class TurnDetector {
  private readonly o: Required<Omit<TurnOptions, "nearLevel">> & { nearLevel?: number };
  private state: State = "idle";
  private voicedMs = 0;
  private silenceMs = 0;
  private speechMs = 0;
  private turnMs = 0;
  private longestPauseMs = 0;
  private bargeIn = false;
  private floor = 0.002;
  private endpoint: number;
  /** the current turn's words so far do not finish a sentence */
  private unfinished = false;
  /** the current turn's words so far are a finished sentence */
  private complete = false;
  /** consecutive confidently silent frames (ms) */
  private quietMs = 0;

  constructor(options: TurnOptions = {}) {
    this.o = {
      positive: 0.5,
      negative: 0.35,
      startMs: 192,
      bargeInPositive: 0.7,
      bargeInStartMs: 160,
      minEndpointMs: 480,
      maxEndpointMs: 900,
      endpointMs: 600,
      minTurnMs: 250,
      maxTurnMs: 45_000,
      nearShare: 0.22,
      incompleteMs: 0,
      completeMs: 0,
      ...options,
    };
    this.endpoint = this.o.endpointMs;
  }

  /** The current silence that ends a turn (adaptive). */
  get endpointMs(): number {
    return this.endpoint;
  }

  /** The silence that ends the current turn: the endpoint, longer while
   * the words so far are an unfinished clause. */
  get effectiveEndpointMs(): number {
    return this.endpoint + (this.unfinished ? this.o.incompleteMs : 0);
  }

  /** The pause preference changed: a new range, the learned place kept in it. */
  setPause(preset: PausePreset): void {
    const range = PAUSE_PRESETS[preset];
    if (this.o.minEndpointMs === range.minEndpointMs && this.o.maxEndpointMs === range.maxEndpointMs) return;
    const share = (this.endpoint - this.o.minEndpointMs) / Math.max(1, this.o.maxEndpointMs - this.o.minEndpointMs);
    Object.assign(this.o, range);
    this.endpoint = Math.round(range.minEndpointMs + Math.min(1, Math.max(0, share)) * (range.maxEndpointMs - range.minEndpointMs));
  }

  /** The words recognized so far in this turn (the streaming transcript). */
  hint(text: string): void {
    this.unfinished = this.state === "idle" ? false : incompleteClause(text);
    this.complete = this.state === "idle" ? false : completeClause(text);
  }

  /** The silence that ends the current turn early, when its words are a
   * finished sentence (else null). */
  get earlyEndpointMs(): number | null {
    if (!this.complete || !this.o.completeMs) return null;
    return Math.min(this.endpoint, this.o.completeMs);
  }

  get speaking(): boolean {
    return this.state === "speaking";
  }

  get active(): boolean {
    return this.state !== "idle";
  }

  /** The person's usual level, learned from enrollment or accepted turns. */
  set nearLevel(level: number | undefined) {
    this.o.nearLevel = level && level > 0 ? level : undefined;
  }

  get nearLevel(): number | undefined {
    return this.o.nearLevel;
  }

  /** Forget the current turn (mute, hold, push-to-talk release handled elsewhere). */
  reset(): void {
    this.state = "idle";
    this.voicedMs = 0;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.turnMs = 0;
    this.longestPauseMs = 0;
    this.bargeIn = false;
    this.unfinished = false;
    this.complete = false;
    this.quietMs = 0;
  }

  private voiced(frame: FrameInput): boolean {
    const bar = frame.botAudible ? this.o.bargeInPositive : this.state === "speaking" ? this.o.negative : this.o.positive;
    if (frame.probability < bar) return false;
    if (frame.botAudible && frame.echo) return false;
    // over the room, and (when known) close to the person's own level
    if (frame.level < this.floor * 2) return false;
    if (this.o.nearLevel && frame.level < this.o.nearLevel * this.o.nearShare) return false;
    return true;
  }

  feed(frame: FrameInput, frameMs = FRAME_MS): TurnEvent | null {
    const voiced = this.voiced(frame);
    if (this.state === "idle") {
      // follow the room while nobody speaks
      if (frame.probability < this.o.negative) this.floor = this.floor * 0.97 + Math.min(frame.level, 0.05) * 0.03;
      if (!voiced) return null;
      this.state = "candidate";
      this.voicedMs = frameMs;
      this.silenceMs = 0;
      this.bargeIn = Boolean(frame.botAudible);
      return { type: "candidate", bargeIn: this.bargeIn };
    }
    if (this.state === "candidate") {
      if (voiced) {
        this.voicedMs += frameMs;
        this.silenceMs = 0;
        const need = this.bargeIn ? this.o.bargeInStartMs : this.o.startMs;
        if (this.voicedMs >= need) {
          this.state = "speaking";
          this.speechMs = this.voicedMs;
          this.turnMs = this.voicedMs;
          this.longestPauseMs = 0;
          return { type: "start", bargeIn: this.bargeIn };
        }
        return null;
      }
      this.silenceMs += frameMs;
      // a voiced run must be (almost) continuous to become speech
      if (this.silenceMs >= 96) {
        this.reset();
        return { type: "cancel" };
      }
      return null;
    }
    // speaking
    this.turnMs += frameMs;
    if (voiced) {
      if (this.silenceMs > 0) this.longestPauseMs = Math.max(this.longestPauseMs, this.silenceMs);
      this.silenceMs = 0;
      this.quietMs = 0;
      this.speechMs += frameMs;
    } else {
      this.silenceMs += frameMs;
      this.quietMs = frame.probability < QUIET_PROBABILITY ? this.quietMs + frameMs : 0;
    }
    const early = this.earlyEndpointMs;
    const endsEarly = early !== null && this.quietMs >= early && this.silenceMs < this.effectiveEndpointMs;
    if (endsEarly || this.silenceMs >= this.effectiveEndpointMs || this.turnMs >= this.o.maxTurnMs) {
      const speechMs = this.speechMs;
      const endpointMs = endsEarly ? early : this.effectiveEndpointMs;
      const longest = this.longestPauseMs;
      this.reset();
      if (speechMs < this.o.minTurnMs) return { type: "cancel" };
      // an early end says nothing about the person's pauses: no adaptation
      if (!endsEarly) this.adapt(longest);
      return { type: "end", speechMs, endpointMs, ...(endsEarly ? { early: true } : {}) };
    }
    return null;
  }

  /** A pause close to the endpoint inside a turn means this person thinks
   * between phrases: give them more room. A turn without one: tighten. */
  private adapt(longestPauseMs: number): void {
    if (longestPauseMs >= this.endpoint * 0.6) {
      this.endpoint = Math.min(this.o.maxEndpointMs, Math.max(this.endpoint, longestPauseMs + 160));
    } else {
      this.endpoint = Math.max(this.o.minEndpointMs, this.endpoint - 24);
    }
  }
}
