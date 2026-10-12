// The bot's voice in a live call: raw PCM sentences streamed from the server
// (the call's speech socket or POST /voice/stream), scheduled back to back
// on Web Audio as their chunks arrive, so a sentence starts playing before
// xAI has finished it and the next one is already fetched while this one
// plays. The voice goes through a gain node of its own (a bus) per answer:
// duck at once when the person starts talking; on a barge-in the bus fades
// out within FADE_MS, every source on it is stopped on the audio clock and
// its downloads are cancelled, and what is queued after the cut plays on a
// fresh bus at full level. Earcons go beside the buses. An analyser on the
// output feeds the waveform and the echo guard.
//
// The first chunk of a sentence starts a little ahead of the audio clock (a
// jitter buffer of `lead` seconds). A later chunk of the same sentence that
// arrives after the audio before it ran out is an underrun (a gap in the
// middle of a word): the lead grows by how late it was, and sentences that
// play through give it back slowly, so a steady network pays BASE_LEAD_S
// and a jittery one stops stuttering.

export interface Sentence {
  /** the speech of one sentence; resolves null when there is nothing to say */
  audio: Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number } | null>;
  text: string;
  /** abort its download */
  abort(): void;
  /** local tool filler: must not stamp firstAudioAt */
  filler?: boolean;
}

export interface PlayerEvents {
  /** the first sample of a sentence is audible now */
  onSentenceStart?(text: string, info?: { filler?: boolean }): void;
  /** everything queued has been heard, or was cut */
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

export const DUCK_LEVEL = 0.12;
const DUCK_MS = 10;
const UNDUCK_MS = 120;
/** A barge-in's fade: silent well inside the 150 ms the person waits from
 * their first word, long enough not to click. */
export const FADE_MS = 12;
/** The jitter buffer: where the lead starts and the most it grows to. */
export const BASE_LEAD_S = 0.015;
export const MAX_LEAD_S = 0.12;
/** Added on top of how late an underrun's chunk was. */
const LEAD_MARGIN_S = 0.01;
/** Given back by each sentence that plays through without a gap. */
const LEAD_RELAX_S = 0.005;
/** A chunk scheduled with less than this left of the audio before it can
 * no longer join it seamlessly (render quantum and thread hop). */
const JOIN_S = 0.005;

export interface PlayerStats {
  /** the current start lead (ms) */
  leadMs: number;
  /** chunks that arrived after the audio before them ran out, this call */
  underruns: number;
}

export class PcmPlayer {
  private context: AudioContext | null = null;
  /** the current answer's gain node (a cut fades it and starts another) */
  private bus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private queue: Sentence[] = [];
  private sources = new Set<AudioBufferSourceNode>();
  private readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  private nextTime = 0;
  private generation = 0;
  /** the generation whose pump runs (-1: none); a cut one never blocks the next */
  private pumpGeneration = -1;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly samples = new Float32Array(1024);
  private ducked = false;
  private lead = BASE_LEAD_S;
  private underruns = 0;
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
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.connect(context.destination);
    this.context = context;
    this.analyser = analyser;
    this.bus = this.newBus();
    if (context.state === "suspended") void context.resume().catch(() => {});
    return context;
  }

  /** The output's analyser (the waveform's bot side). */
  get output(): AnalyserNode | null {
    return this.analyser;
  }

  /** Something is queued or audible. */
  get busy(): boolean {
    return this.queue.length > 0 || this.pumpGeneration === this.generation || (this.context !== null && this.context.currentTime < this.nextTime);
  }

  /** The jitter buffer's state (diagnostics, the latency bench). */
  get stats(): PlayerStats {
    return { leadMs: Math.round(this.lead * 1000), underruns: this.underruns };
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
    if (this.pumpGeneration !== this.generation) void this.pump();
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
    if (!this.bus || !this.context || this.ducked) return;
    this.ducked = true;
    this.rampBus(this.bus, DUCK_LEVEL, DUCK_MS);
  }

  unduck(): void {
    if (!this.bus || !this.context || !this.ducked) return;
    this.ducked = false;
    this.rampBus(this.bus, 1, UNDUCK_MS);
  }

  /** Cut everything: the playing answer fades out within FADE_MS and its
   * sources stop on the audio clock, queued sentences and their downloads
   * are dropped, and the player is idle at once (anything enqueued from
   * now on plays on a fresh bus). Resolves once the fade has ended. */
  cancel(): Promise<void> {
    const wasBusy = this.busy;
    this.generation += 1;
    for (const sentence of this.queue) sentence.abort();
    this.queue = [];
    for (const reader of this.readers) void reader.cancel().catch(() => {});
    this.readers.clear();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const context = this.context;
    const bus = this.bus;
    const sources = [...this.sources];
    this.sources.clear();
    this.nextTime = 0;
    this.ducked = false;
    let faded: Promise<void> = Promise.resolve();
    if (context && bus) {
      const end = context.currentTime + FADE_MS / 1000;
      this.rampBus(bus, 0, FADE_MS);
      for (const source of sources) {
        source.onended = null;
        // a chunk scheduled to start after `end` never plays at all
        try { source.stop(end); } catch { /* never started */ }
      }
      this.bus = this.newBus();
      faded = new Promise((resolve) => {
        setTimeout(() => {
          for (const source of sources) source.disconnect();
          bus.disconnect();
          resolve();
        }, FADE_MS + 8);
      });
    }
    if (wasBusy) this.events.onIdle?.();
    return faded;
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
    this.bus = null;
    this.analyser = null;
    await context?.close().catch(() => {});
  }

  private newBus(): GainNode {
    const bus = this.context!.createGain();
    bus.connect(this.analyser!);
    return bus;
  }

  private rampBus(bus: GainNode, value: number, ms: number): void {
    const now = this.context!.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(value, now + ms / 1000);
  }

  private async pump(): Promise<void> {
    const mine = this.generation;
    if (this.pumpGeneration === mine) return;
    this.pumpGeneration = mine;
    try {
      while (mine === this.generation && this.queue.length) {
        const sentence = this.queue[0]!;
        await this.playOne(sentence, mine);
        if (mine === this.generation && this.queue[0] === sentence) this.queue.shift();
      }
    } finally {
      if (this.pumpGeneration === mine) this.pumpGeneration = -1;
    }
    // a cut meanwhile: the queue is the next generation's
    if (mine === this.generation) this.scheduleIdle();
  }

  private scheduleIdle(clock = -1): void {
    const context = this.context;
    if (!context) return;
    const wait = Math.max(0, (this.nextTime - context.currentTime) * 1000);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const mine = this.generation;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (mine !== this.generation || this.queue.length || this.pumpGeneration === mine) return;
      // The audio clock runs behind the wall clock (a device starting, large
      // output buffers): wait for it. A clock that stopped is a suspended
      // device, which will not play the rest.
      const now = this.context?.currentTime ?? 0;
      if (now < this.nextTime && now > clock) return this.scheduleIdle(now);
      this.events.onIdle?.();
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
      if (audio && mine !== this.generation) void audio.body.cancel().catch(() => {});
      return;
    }
    const reader = audio.body.getReader();
    this.readers.add(reader);
    let carry: number | null = null;
    let chunks = 0;
    let gapped = false;
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
        const now = context.currentTime;
        let start: number;
        if (chunks === 0) {
          start = Math.max(now + this.lead, this.nextTime);
        } else if (this.nextTime >= now + JOIN_S) {
          start = this.nextTime;
        } else {
          // the audio before it already ran out: grow the buffer and refill it
          const late = now + JOIN_S - this.nextTime;
          this.lead = Math.min(MAX_LEAD_S, this.lead + late + LEAD_MARGIN_S);
          this.underruns += 1;
          gapped = true;
          start = now + this.lead;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.bus!);
        source.start(start);
        this.nextTime = start + buffer.duration;
        if (entry) {
          entry.start ??= start;
          entry.end = this.nextTime;
        }
        this.sources.add(source);
        source.onended = () => this.sources.delete(source);
        if (chunks === 0) {
          const delay = Math.max(0, (start - now) * 1000);
          setTimeout(() => {
            if (mine === this.generation) this.events.onSentenceStart?.(sentence.text, sentence.filler ? { filler: true } : undefined);
          }, delay);
        }
        chunks += 1;
      }
      if (mine === this.generation && chunks > 1 && !gapped) this.lead = Math.max(BASE_LEAD_S, this.lead - LEAD_RELAX_S);
    } catch (error) {
      if (mine === this.generation) this.events.onError?.(error);
    } finally {
      this.readers.delete(reader);
      if (mine !== this.generation) await reader.cancel().catch(() => {});
    }
  }
}
