// Is the microphone hearing the person, or only the bot's own voice coming
// back from the speakers? Chromium's echo canceller (getUserMedia
// echoCancellation) removes most of it; this guard handles the residue, so
// the bot never interrupts itself. Pure: one call per 32 ms frame with the
// microphone's level and the level of what the call is playing.
//
// It learns the echo path's coupling (microphone level / playback level)
// while the bot speaks: the median ratio of the last two seconds of the bot's
// voiced frames. The person barging in lifts the microphone far above that
// median at once, long before their voice could move the median itself. A
// frame is echo when the microphone is not clearly louder (`marginDb`) than
// the bot's recent voice times that coupling.

export interface EchoGuardOptions {
  /** how much louder than the expected echo the person must be */
  marginDb?: number;
  /** below this playback level the bot is silent: nothing to guard */
  playbackFloor?: number;
  /** a starting coupling (after echo cancellation the residue is small) */
  coupling?: number;
}

export class EchoGuard {
  private readonly margin: number;
  private readonly playbackFloor: number;
  private readonly prior: number;
  /** a few frames of playback history: the echo arrives a little late */
  private recent: number[] = [];
  /** recent coupling ratios, measured on the bot's voiced frames */
  private ratios: number[] = [];

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

  /** Feed one frame; true when the microphone is only echo. */
  update(micLevel: number, playbackLevel: number): boolean {
    this.recent.push(playbackLevel);
    if (this.recent.length > 8) this.recent.shift();
    // the loudest playback of the last ~250 ms bounds what can come back now
    const playback = Math.max(...this.recent);
    if (playback < this.playbackFloor) return false;
    const coupling = Math.max(0.01, this.estimate);
    const echo = micLevel < playback * coupling * this.margin;
    // learn from the bot's voiced frames; a ratio far over the estimate (the
    // person speaking over the bot) counts only as twice the estimate, so a
    // louder room is learned within seconds but a barge-in cannot teach it
    if (playbackLevel >= playback * 0.5) {
      this.ratios.push(Math.min(micLevel / playback, coupling * 2));
      if (this.ratios.length > 64) this.ratios.shift();
    }
    return echo;
  }

  reset(): void {
    this.recent = [];
  }
}
