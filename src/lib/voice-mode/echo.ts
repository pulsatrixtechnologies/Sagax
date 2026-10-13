// Is the microphone hearing the person, or only the bot's own voice coming
// back from the speakers? Chromium's echo canceller (getUserMedia
// echoCancellation) removes most of it; this guard handles the residue, so
// the bot never interrupts itself. Pure: one call per 32 ms frame with the
// microphone's level and the level of what the call is playing.
//
// A speakerphone, and a Bluetooth speaker in particular, returns the bot's
// voice 150 to 300 ms late. The guard keeps 512 ms of playback, lines the
// microphone up with that history by cross-correlation, and treats a frame
// as echo when it is no louder than the delayed playback times the learned
// coupling. For the first second the coupling stays at least at its prior,
// which is conservative until the canceller has converged. The person
// barging in lifts the microphone far above that level at once, long before
// their voice could move the estimate.

export interface EchoGuardOptions {
  /** how much louder than the expected echo the person must be */
  marginDb?: number;
  /** below this playback level the bot is silent: nothing to guard */
  playbackFloor?: number;
  /** a starting coupling (after echo cancellation the residue is small) */
  coupling?: number;
}

/** Playback remembered per frame: 16 × 32 ms = 512 ms. */
export const ECHO_HISTORY = 16;
/** The longest delay lined up: 12 × 32 ms = 384 ms (Bluetooth sits inside it). */
export const ECHO_MAX_LAG = 12;
/** Frames that keep the prior coupling: the canceller has not converged. */
export const ECHO_PRIOR_FRAMES = 32;
/** Frames of smear kept after the aligned playback sample. */
const ECHO_SMEAR = 3;

export class EchoGuard {
  private readonly margin: number;
  private readonly playbackFloor: number;
  private readonly prior: number;
  private playback: number[] = [];
  private mic: number[] = [];
  private ratios: number[] = [];
  private lag = 0;
  private frames = 0;
  /** the playback level the latest frame was compared with */
  private bound = 0;

  constructor(options: EchoGuardOptions = {}) {
    this.prior = options.coupling ?? 0.1;
    this.margin = 10 ** ((options.marginDb ?? 9) / 20);
    this.playbackFloor = options.playbackFloor ?? 0.004;
  }

  /** The learned coupling (for tests and diagnostics). */
  get estimate(): number {
    if (this.ratios.length < 8) return this.prior;
    const sorted = [...this.ratios].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  /** Delay, in frames, between playback and the microphone. */
  get lagFrames(): number {
    return this.lag;
  }

  /** Delayed playback can still be in the microphone. */
  get lingering(): boolean {
    return this.bound >= this.playbackFloor;
  }

  /** Feed one frame; true when the microphone is only echo. */
  update(micLevel: number, playbackLevel: number): boolean {
    this.frames += 1;
    this.playback.push(playbackLevel);
    this.mic.push(micLevel);
    if (this.playback.length > ECHO_HISTORY) {
      this.playback.shift();
      this.mic.shift();
    }
    if (this.playback.length >= 8 && this.frames % 4 === 0) this.lag = this.estimateLag();
    const span = Math.min(this.playback.length, this.lag + ECHO_SMEAR + 1);
    let peak = 0;
    for (let i = this.playback.length - span; i < this.playback.length; i++) {
      const level = this.playback[i]!;
      if (level > peak) peak = level;
    }
    const alignedAt = this.playback.length - 1 - this.lag;
    const aligned = alignedAt >= 0 ? this.playback[alignedAt]! : playbackLevel;
    const playback = Math.max(aligned, peak);
    this.bound = playback;
    if (playback < this.playbackFloor) return false;
    const coupling = this.couplingNow();
    const echo = micLevel < playback * coupling * this.margin;
    // learn from the aligned playback; a ratio far over the estimate (the
    // person speaking over the bot) counts only as twice the estimate, so a
    // louder room is learned within seconds but a barge-in cannot teach it
    const learnFrom = aligned >= this.playbackFloor ? aligned : playback;
    if (learnFrom >= playback * 0.5) {
      const cap = Math.max(0.01, this.estimate) * 2;
      this.ratios.push(Math.min(micLevel / learnFrom, cap));
      if (this.ratios.length > 64) this.ratios.shift();
    }
    return echo;
  }

  reset(): void {
    this.playback = [];
    this.mic = [];
    this.lag = 0;
    this.bound = 0;
  }

  /** Prior until the first second has passed and a coupling is learned. */
  private couplingNow(): number {
    const learned = Math.max(0.01, this.estimate);
    if (this.frames < ECHO_PRIOR_FRAMES) return Math.max(learned, this.prior);
    return learned;
  }

  /** Lag whose delayed playback best matches the microphone. Lag 0 wins
   * unless another lag is clearly closer, so a steady tone does not wander.
   * The winner is the best lag, not the first one to clear the bar: a delay
   * of eight frames must not lose to seven. */
  private estimateLag(): number {
    const n = this.playback.length;
    const limit = Math.min(ECHO_MAX_LAG, n - 4);
    let lag0 = -Infinity;
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = 0; lag <= limit; lag++) {
      let dot = 0;
      let energy = 0;
      for (let i = lag; i < n; i++) {
        const played = this.playback[i - lag]!;
        energy += played * played;
        dot += this.mic[i]! * played;
      }
      if (energy < 1e-8) continue;
      const score = dot / Math.sqrt(energy);
      if (lag === 0) lag0 = score;
      if (score > bestScore) {
        bestScore = score;
        best = lag;
      }
    }
    if (bestScore === -Infinity || best === 0) return 0;
    // no positive match, or not clearly better than lining up with now
    if (bestScore <= 0) return 0;
    if (lag0 > 0 && bestScore <= lag0 * 1.15) return 0;
    return best;
  }
}
