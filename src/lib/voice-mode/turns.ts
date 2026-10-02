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

export const FRAME_MS = 32;

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
  /** share of nearLevel a voiced frame needs (far-field rejection) */
  nearShare?: number;
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
  | { type: "end"; speechMs: number; endpointMs: number };

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
      ...options,
    };
    this.endpoint = this.o.endpointMs;
  }

  /** The current silence that ends a turn (adaptive). */
  get endpointMs(): number {
    return this.endpoint;
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
      this.speechMs += frameMs;
    } else {
      this.silenceMs += frameMs;
    }
    if (this.silenceMs >= this.endpoint || this.turnMs >= this.o.maxTurnMs) {
      const speechMs = this.speechMs;
      const endpointMs = this.endpoint;
      const longest = this.longestPauseMs;
      this.reset();
      if (speechMs < this.o.minTurnMs) return { type: "cancel" };
      this.adapt(longest);
      return { type: "end", speechMs, endpointMs };
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
