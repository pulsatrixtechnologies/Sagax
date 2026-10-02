// The bot's voice in a live call: raw PCM sentences streamed from the server
// (POST /voice/stream), scheduled back to back on Web Audio as their chunks
// arrive, so a sentence starts playing before xAI has finished it and the
// next one is already fetched while this one plays. One gain node does the
// phone things: duck at once when the person starts talking, fade out and
// drop everything on a barge-in, earcons on the side. An analyser on the
// output feeds the waveform and the echo guard.

export interface Sentence {
  /** the speech of one sentence; resolves null when there is nothing to say */
  audio: Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number } | null>;
  text: string;
  /** abort its download */
  abort(): void;
}

export interface PlayerEvents {
  /** the first sample of a sentence is audible now */
  onSentenceStart?(text: string): void;
  /** everything queued has been heard */
  onIdle?(): void;
  onError?(error: unknown): void;
}

/** What the person heard of the answer that was playing when it was cut. */
export interface PlaybackCut {
  /** the words heard: whole sentences, then the start of the one cut */
  heard: string;
  /** the words not heard: the rest of the cut sentence and every queued one */
  unheard: string;
}

/** About how fast the voice speaks at 1x (characters per second), to place
 * the cut inside a sentence whose audio is still arriving. */
const SPOKEN_CHARS_PER_SECOND = 14;

/** The first `share` of a sentence, cut at a word boundary. */
export function splitAtShare(text: string, share: number): [string, string] {
  if (share <= 0) return ["", text.trim()];
  if (share >= 1) return [text.trim(), ""];
  const target = Math.round(text.length * share);
  // the nearest word boundary at or before the point reached
  let cut = text.lastIndexOf(" ", target);
  if (cut <= 0) cut = text.indexOf(" ", target);
  if (cut <= 0) return share >= 0.5 ? [text.trim(), ""] : ["", text.trim()];
  return [text.slice(0, cut).trim(), text.slice(cut).trim()];
}

interface LedgerEntry {
  text: string;
  /** context time its first sample plays, once scheduled */
  start?: number;
  /** context time its last scheduled sample ends */
  end?: number;
  /** all its audio has arrived */
  complete: boolean;
}

const DUCK_LEVEL = 0.12;
const DUCK_MS = 30;
const FADE_MS = 60;

export class PcmPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private queue: Sentence[] = [];
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private generation = 0;
  private pumping = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly samples = new Float32Array(1024);
  private ducked = false;
  /** the sentences of the current answer, in order, with when they play */
  private ledger: LedgerEntry[] = [];
  private readonly createContext: () => AudioContext;
  events: PlayerEvents = {};

  constructor(createContext: () => AudioContext = () => new AudioContext({ latencyHint: "interactive" })) {
    this.createContext = createContext;
  }

  /** Create the audio graph (call from the click that starts the call). */
  open(): AudioContext {
    if (this.context) return this.context;
    const context = this.createContext();
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    gain.connect(analyser);
    analyser.connect(context.destination);
    this.context = context;
    this.gain = gain;
    this.analyser = analyser;
    if (context.state === "suspended") void context.resume().catch(() => {});
    return context;
  }

  /** The output's analyser (the waveform's bot side). */
  get output(): AnalyserNode | null {
    return this.analyser;
  }

  /** Something is queued or audible. */
  get busy(): boolean {
    return this.queue.length > 0 || this.pumping || (this.context !== null && this.context.currentTime < this.nextTime);
  }

  /** RMS of what is playing now, 0..1. */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += this.samples[i]! * this.samples[i]!;
    return Math.sqrt(sum / this.samples.length);
  }

  enqueue(sentence: Sentence): void {
    this.open();
    this.queue.push(sentence);
    this.ledger.push({ text: sentence.text, complete: false });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!this.pumping) void this.pump();
  }

  /** A new answer begins: forget what the last one played. */
  resetLedger(): void {
    this.ledger = [];
  }

  /** What has been heard of the current answer so far, from what played
   * by the audio clock: whole sentences, and the share of the one playing
   * (by its scheduled audio, or by speaking rate while it still arrives). */
  playback(speed = 1): PlaybackCut {
    const now = this.context?.currentTime ?? 0;
    const heard: string[] = [];
    const unheard: string[] = [];
    for (const entry of this.ledger) {
      if (entry.start === undefined || entry.start > now) {
        unheard.push(entry.text);
        continue;
      }
      const played = now - entry.start;
      const known = (entry.end ?? entry.start) - entry.start;
      const estimate = entry.text.length / (SPOKEN_CHARS_PER_SECOND * Math.max(0.5, speed));
      const length = entry.complete ? known : Math.max(known, estimate);
      if (length <= 0 || played >= length) {
        heard.push(entry.text);
        continue;
      }
      const [said, rest] = splitAtShare(entry.text, played / length);
      if (said) heard.push(said);
      if (rest) unheard.push(rest);
    }
    return { heard: heard.join(" ").trim(), unheard: unheard.join(" ").trim() };
  }

  /** Lower the bot at once (the person may be talking). */
  duck(): void {
    if (!this.gain || !this.context || this.ducked) return;
    this.ducked = true;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_MS / 1000);
  }

  unduck(): void {
    if (!this.gain || !this.context || !this.ducked) return;
    this.ducked = false;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(1, now + 0.12);
  }

  /** Fade out within FADE_MS and drop every queued sentence. Resolves once silent. */
  cancel(): Promise<void> {
    this.generation += 1;
    for (const sentence of this.queue) sentence.abort();
    this.queue = [];
    const context = this.context;
    const gain = this.gain;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const wasBusy = context !== null && (context.currentTime < this.nextTime || this.sources.size > 0);
    this.nextTime = 0;
    this.ducked = false;
    if (!context || !gain) return Promise.resolve();
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + FADE_MS / 1000);
    const sources = [...this.sources];
    this.sources.clear();
    return new Promise((resolve) => {
      setTimeout(() => {
        for (const source of sources) {
          try { source.stop(); } catch { /* not started */ }
          source.disconnect();
        }
        const at = context.currentTime;
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueAtTime(1, at);
        if (wasBusy) this.events.onIdle?.();
        resolve();
      }, FADE_MS);
    });
  }

  /** A short tone or two (earcons), beside the bot's voice. */
  tone(notes: Array<{ hz: number; ms: number }>, volume = 0.06): void {
    const context = this.open();
    if (!this.analyser) return;
    let at = context.currentTime + 0.01;
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = note.hz;
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(volume, at + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + note.ms / 1000);
      oscillator.connect(envelope);
      envelope.connect(this.analyser);
      oscillator.start(at);
      oscillator.stop(at + note.ms / 1000 + 0.02);
      at += note.ms / 1000;
    }
  }

  async close(): Promise<void> {
    await this.cancel();
    const context = this.context;
    this.context = null;
    this.gain = null;
    this.analyser = null;
    await context?.close().catch(() => {});
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const mine = this.generation;
        const sentence = this.queue[0]!;
        await this.playOne(sentence, mine);
        // a cancel emptied the queue meanwhile: what is there now is new
        if (this.queue[0] === sentence) this.queue.shift();
      }
    } finally {
      this.pumping = false;
    }
    this.scheduleIdle();
  }

  private scheduleIdle(): void {
    const context = this.context;
    if (!context) return;
    const wait = Math.max(0, (this.nextTime - context.currentTime) * 1000);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const mine = this.generation;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (mine === this.generation && !this.queue.length && !this.pumping) this.events.onIdle?.();
    }, wait + 20);
  }

  private async playOne(sentence: Sentence, mine: number): Promise<void> {
    const context = this.context!;
    let audio: Awaited<Sentence["audio"]>;
    try {
      audio = await sentence.audio;
    } catch (error) {
      if (mine === this.generation) this.events.onError?.(error);
      return;
    }
    const entry = this.ledger.find((candidate) => candidate.text === sentence.text && candidate.start === undefined && !candidate.complete);
    if (!audio || mine !== this.generation) {
      // nothing to say (a code block, a link): it takes no time
      if (entry && mine === this.generation) entry.complete = true;
      return;
    }
    const reader = audio.body.getReader();
    let carry: number | null = null;
    let first = true;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done && entry && mine === this.generation) entry.complete = true;
        if (done || mine !== this.generation) break;
        if (!value?.byteLength) continue;
        // 16-bit little-endian; a chunk may end mid-sample
        let bytes = value;
        if (carry !== null) {
          const joined = new Uint8Array(bytes.byteLength + 1);
          joined[0] = carry;
          joined.set(bytes, 1);
          bytes = joined;
          carry = null;
        }
        if (bytes.byteLength % 2) {
          carry = bytes[bytes.byteLength - 1]!;
          bytes = bytes.subarray(0, bytes.byteLength - 1);
        }
        const count = bytes.byteLength / 2;
        if (!count) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const buffer = context.createBuffer(1, count, audio.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < count; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gain!);
        const start = Math.max(context.currentTime + 0.015, this.nextTime);
        source.start(start);
        this.nextTime = start + buffer.duration;
        if (entry) {
          entry.start ??= start;
          entry.end = this.nextTime;
        }
        this.sources.add(source);
        source.onended = () => this.sources.delete(source);
        if (first) {
          first = false;
          const delay = Math.max(0, (start - context.currentTime) * 1000);
          setTimeout(() => {
            if (mine === this.generation) this.events.onSentenceStart?.(sentence.text);
          }, delay);
        }
      }
    } catch (error) {
      if (mine === this.generation) this.events.onError?.(error);
    } finally {
      if (mine !== this.generation) await reader.cancel().catch(() => {});
    }
  }
}
