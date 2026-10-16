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
// The playback context runs at 24 kHz (xAI's PCM rate) when the browser
// allows it, so the audio is resampled once, by the browser, at the output.
//
// The first chunk of an answer starts PREBUFFER_S ahead of the audio clock;
// later chunks start a little ahead of it (a jitter buffer of `lead`
// seconds). A chunk that arrives after the audio before it ran out (a gap
// in the middle of a word, or between two clauses of one answer) is an
// underrun: the lead grows by how late it was, and audio that plays through
// gives it back slowly, so a steady network pays BASE_LEAD_S and a jittery
// one stops stuttering. A gap longer than MAX_JITTER_S is the bot still
// writing, not the network: it changes nothing. Each chunk has a gain of its
// own: it fades out over its last GAP_FADE_MS unless the next chunk joins it
// in time, and the chunk after a gap fades in, so a gap never clicks.
//
// One answer on the streaming voice is one sentence whose text grows
// (`extend`) while it plays; its clauses are captioned when the voice should
// reach them (by speaking rate, then by the audio's real length once it is
// all there). While the answer's audio has run dry and more is coming (the
// bot is writing or working), `onStarved` says the bot is silent and
// `onResume` says it speaks again.

export interface Sentence {
  /** the speech of one sentence; resolves null when there is nothing to say */
  audio: Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number } | null>;
  /** its words (an open utterance's grow with `extend`) */
  text: string;
  /** its clauses for the captions, where each starts in `text` */
  captions?: Array<{ text: string; at: number }>;
  /** true while it may still grow (an answer's open utterance): its audio
   * is never timed out, the bot may be thinking */
  open?: () => boolean;
  /** abort its download */
  abort(): void;
  /** local tool filler: must not stamp firstAudioAt */
  filler?: boolean;
}

export interface PlayerEvents {
  /** the first sample of a sentence is audible now */
  onSentenceStart?(text: string, info?: { filler?: boolean }): void;
  /** a later clause of the playing utterance is audible now */
  onCaption?(text: string): void;
  /** the playing utterance ran out of audio and more is coming: silent */
  onStarved?(): void;
  /** audio of a starved utterance arrived: audible again */
  onResume?(): void;
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
export const SPOKEN_CHARS_PER_SECOND = 14;

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
  sentence: Sentence;
  /** the words sent for it so far */
  text: string;
  /** its clauses for the captions: where each starts in `text` */
  captions: Array<{ at: number; text: string; shown: boolean }>;
  /** context time its first sample plays, once scheduled */
  start?: number;
  /** context time its last scheduled sample ends */
  end?: number;
  /** all its audio has arrived */
  complete: boolean;
}

/** A confirmed barge-in: the bot drops to 12%. */
export const DUCK_LEVEL = 0.12;
/** A first voiced frame that may still be a cough: about -6 dB. */
export const DUCK_SOFT = 0.5;
const DUCK_MS = 10;
const UNDUCK_MS = 120;
/** A barge-in's fade: silent well inside the 150 ms the person waits from
 * their first word, long enough not to click. */
export const FADE_MS = 12;
/** The jitter buffer: where the lead starts and the most it grows to. */
export const BASE_LEAD_S = 0.015;
export const MAX_LEAD_S = 0.12;
/** The first chunk of an answer starts this far ahead: room for the next
 * chunks to arrive without a gap in its first word. */
export const PREBUFFER_S = 0.07;
/** A gap longer than this is the bot writing, not network jitter. */
export const MAX_JITTER_S = 0.5;
/** The fade around a gap: no click, too short to hear. */
export const GAP_FADE_MS = 3;
/** Added on top of how late an underrun's chunk was. */
const LEAD_MARGIN_S = 0.01;
/** Given back for every RELAX_EVERY_S of audio played without a gap. */
const LEAD_RELAX_S = 0.005;
const RELAX_EVERY_S = 2;
/** An utterance whose audio ran out this long ago, with more coming, is
 * starved: the bot is silent until its next chunk. */
const STARVED_MS = 250;
/** A chunk scheduled with less than this left of the audio before it can
 * no longer join it seamlessly (render quantum and thread hop). */
const JOIN_S = 0.005;

/** A sentence whose audio stops coming for this long is given up, so the
 * next one plays and the call is never stuck busy (POST bodies time out at
 * 8 s in api.ts; this is the player's own backstop). */
export const READ_TIMEOUT_MS = 10_000;

/** The promise, or a rejection once `ms` passed without it settling. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the voice stalled")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

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
  private ducked: number | null = null;
  private lead = BASE_LEAD_S;
  private underruns = 0;
  /** seconds of audio scheduled since the last underrun or relax */
  private clean = 0;
  /** nothing of the current answer has been scheduled yet */
  private fresh = true;
  private starved = false;
  private starveTimer: ReturnType<typeof setTimeout> | null = null;
  private captionTimer: ReturnType<typeof setTimeout> | null = null;
  /** the gain of the last chunk scheduled, with when its fade-out starts */
  private lastChunk: { gain: GainNode; fadeAt: number } | null = null;
  private chunkGains = new Map<AudioBufferSourceNode, GainNode>();
  /** the voice's speaking rate (the captions' estimate) */
  speed = 1;
  /** the sentences of the current answer, in order, with when they play */
  private ledger: LedgerEntry[] = [];
  private readonly createContext: () => AudioContext;
  events: PlayerEvents = {};
  /** see READ_TIMEOUT_MS (tests shorten it) */
  readTimeoutMs = READ_TIMEOUT_MS;

  constructor(createContext: () => AudioContext = playbackContext) {
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
    // a device change, a sleep or another app can suspend (or, on iOS
    // Safari, interrupt) the output: resume it, or the voice goes silent
    const wake = () => {
      if (this.context === context && (context.state === "suspended" || (context.state as string) === "interrupted")) void context.resume().catch(() => {});
    };
    context.addEventListener?.("statechange", wake);
    wake();
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
    this.ledger.push({ sentence, text: sentence.text, captions: (sentence.captions ?? []).map((mark) => ({ ...mark, shown: false })), complete: false });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.pumpGeneration !== this.generation) void this.pump();
  }

  /** More words of an open utterance (`sentence`, by default the last one
   * enqueued), with the clause they belong to for the captions (`at`: where
   * it starts in the utterance, by default where this text does). A
   * sentence not enqueued yet (held) keeps them until it is. */
  extend(text: string, caption?: { text: string; at?: number }, sentence?: Sentence): void {
    const entry = sentence ? this.ledger.find((candidate) => candidate.sentence === sentence) : this.ledger.at(-1);
    const target = entry?.sentence ?? sentence;
    if (!target || entry?.complete) return;
    const at = caption?.at ?? target.text.length + (text.length - text.trimStart().length);
    target.text += text;
    if (caption?.text) (target.captions ??= []).push({ text: caption.text, at });
    if (!entry) return;
    entry.text = target.text;
    if (caption?.text) {
      entry.captions.push({ at, text: caption.text, shown: false });
      this.scheduleCaptions();
    }
  }

  /** A new answer begins: forget what the last one played. */
  resetLedger(): void {
    this.ledger = [];
    this.fresh = true;
    if (this.captionTimer) clearTimeout(this.captionTimer);
    this.captionTimer = null;
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

  /** Lower the bot within DUCK_MS: DUCK_LEVEL (12%, the default) once the
   * person is talking over it, DUCK_SOFT (about -6 dB) on a first voiced
   * frame that may still be a cough. A duck never raises the level: a soft
   * duck after a deep one changes nothing. */
  duck(level = DUCK_LEVEL): void {
    if (!this.bus || !this.context) return;
    if (this.ducked !== null && this.ducked <= level) return;
    this.ducked = level;
    this.rampBus(this.bus, level, DUCK_MS);
  }

  /** The level of the current duck, null when not ducked. */
  get duckLevel(): number | null {
    return this.ducked;
  }

  unduck(): void {
    if (!this.bus || !this.context || this.ducked === null) return;
    this.ducked = null;
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
    const gains = sources.map((source) => this.chunkGains.get(source));
    this.sources.clear();
    this.chunkGains.clear();
    this.lastChunk = null;
    this.nextTime = 0;
    this.ducked = null;
    this.fresh = true;
    this.starved = false;
    if (this.starveTimer) clearTimeout(this.starveTimer);
    this.starveTimer = null;
    if (this.captionTimer) clearTimeout(this.captionTimer);
    this.captionTimer = null;
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
          for (const gain of gains) gain?.disconnect();
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
      // a stopped clock: what was scheduled will not play; the next answer
      // starts from the clock as it is, and `busy` does not stay true
      if (now < this.nextTime) this.nextTime = now;
      this.fresh = true;
      this.lastChunk = null;
      this.events.onIdle?.();
    }, wait + 20);
  }

  private async playOne(sentence: Sentence, mine: number): Promise<void> {
    const context = this.context!;
    let audio: Awaited<Sentence["audio"]>;
    try {
      audio = await within(sentence.audio, this.readTimeoutMs);
    } catch (error) {
      sentence.abort();
      if (mine === this.generation) this.events.onError?.(error);
      return;
    }
    const entry = this.ledger.find((candidate) => candidate.sentence === sentence && candidate.start === undefined && !candidate.complete);
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
    try {
      for (;;) {
        this.watchStarve(entry, mine);
        const { done, value } = await this.read(reader, sentence);
        this.unwatchStarve();
        if (done && entry && mine === this.generation) {
          entry.complete = true;
          this.scheduleCaptions();
        }
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
        const start = this.startOf(context.currentTime);
        this.schedule(context, buffer, start);
        if (entry) {
          entry.start ??= start;
          entry.end = this.nextTime;
        }
        if (chunks === 0) {
          const delay = Math.max(0, (start - context.currentTime) * 1000);
          const caption = entry?.captions.find((mark) => mark.at === 0);
          if (caption) caption.shown = true;
          setTimeout(() => {
            if (mine === this.generation) this.events.onSentenceStart?.(caption?.text ?? sentence.text, sentence.filler ? { filler: true } : undefined);
          }, delay);
        } else if (this.starved) {
          this.starved = false;
          const delay = Math.max(0, (start - context.currentTime) * 1000);
          setTimeout(() => {
            if (mine === this.generation) this.events.onResume?.();
          }, delay);
        }
        this.scheduleCaptions();
        chunks += 1;
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      if (mine === this.generation) this.events.onError?.(error);
    } finally {
      this.unwatchStarve();
      this.readers.delete(reader);
      if (mine !== this.generation) await reader.cancel().catch(() => {});
    }
  }

  /** The next chunk, given up after readTimeoutMs. An open utterance waits
   * for the bot's next words as long as they take: it is checked again every
   * readTimeoutMs, and times out once it is no longer open (a half-dead
   * speech socket is caught by its own ping, speech-stream.ts). */
  private async read(reader: ReadableStreamDefaultReader<Uint8Array>, sentence: Sentence): Promise<ReadableStreamReadResult<Uint8Array>> {
    const next = reader.read();
    for (;;) {
      try {
        return await within(next, this.readTimeoutMs);
      } catch (error) {
        if (!sentence.open?.()) throw error;
      }
    }
  }

  /** When a chunk arriving now starts: the prebuffer for an answer's first
   * chunk, right after the audio before it when it joins, else after a gap
   * (an underrun when it was network jitter: the lead grows). */
  private startOf(now: number): number {
    if (this.fresh) {
      this.fresh = false;
      return Math.max(now + Math.max(PREBUFFER_S, this.lead), this.nextTime);
    }
    if (this.nextTime >= now + JOIN_S) return this.nextTime;
    const late = now + JOIN_S - this.nextTime;
    if (this.nextTime > 0 && late <= MAX_JITTER_S) {
      // the audio before it already ran out: grow the buffer and refill it
      this.lead = Math.min(MAX_LEAD_S, this.lead + late + LEAD_MARGIN_S);
      this.underruns += 1;
      this.clean = 0;
    }
    return now + this.lead;
  }

  /** One chunk on its own gain: joined to the last one (whose fade-out is
   * called off), or after a gap (faded in; the last one faded out). */
  private schedule(context: AudioContext, buffer: AudioBuffer, start: number): void {
    const fade = GAP_FADE_MS / 1000;
    const joins = this.lastChunk !== null && Math.abs(start - this.nextTime) < 1e-6;
    if (joins) this.lastChunk!.gain.gain.cancelScheduledValues(this.lastChunk!.fadeAt);
    const gain = context.createGain();
    gain.connect(this.bus!);
    if (!joins) {
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(1, start + Math.min(fade, buffer.duration / 2));
    }
    const end = start + buffer.duration;
    const fadeAt = Math.max(start, end - fade);
    gain.gain.setValueAtTime(1, fadeAt);
    gain.gain.linearRampToValueAtTime(0, end);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(start);
    this.nextTime = end;
    this.lastChunk = { gain, fadeAt };
    this.sources.add(source);
    this.chunkGains.set(source, gain);
    source.onended = () => {
      this.sources.delete(source);
      this.chunkGains.delete(source);
    };
    this.clean += buffer.duration;
    while (this.clean >= RELAX_EVERY_S) {
      this.clean -= RELAX_EVERY_S;
      this.lead = Math.max(BASE_LEAD_S, this.lead - LEAD_RELAX_S);
    }
  }

  /** While waiting for an open utterance's next chunk: once its audio has
   * run out for STARVED_MS, the bot is silent. */
  private watchStarve(entry: LedgerEntry | undefined, mine: number): void {
    this.unwatchStarve();
    if (!entry || this.starved || !this.context || this.nextTime <= 0) return;
    const wait = Math.max(0, (this.nextTime - this.context.currentTime) * 1000) + STARVED_MS;
    this.starveTimer = setTimeout(() => {
      this.starveTimer = null;
      if (mine !== this.generation || entry.complete || this.queue[0] !== entry.sentence) return;
      if ((this.context?.currentTime ?? 0) < this.nextTime) return;
      this.starved = true;
      this.events.onStarved?.();
    }, wait);
  }

  private unwatchStarve(): void {
    if (this.starveTimer) clearTimeout(this.starveTimer);
    this.starveTimer = null;
  }

  /** The next clause's caption, when the voice should reach it: by speaking
   * rate while the audio still arrives, by its share of the audio once it
   * is all there. Waits while that point is past the audio received. */
  private scheduleCaptions(): void {
    if (this.captionTimer || !this.context) return;
    const entry = this.ledger.find((candidate) => candidate.start !== undefined && candidate.captions.some((mark) => !mark.shown));
    if (!entry || entry.start === undefined) return;
    const mark = entry.captions.find((candidate) => !candidate.shown)!;
    const length = (entry.end ?? entry.start) - entry.start;
    const due = entry.complete && entry.text.length > 0
      ? entry.start + length * Math.min(1, mark.at / entry.text.length)
      : entry.start + mark.at / (SPOKEN_CHARS_PER_SECOND * Math.max(0.5, this.speed));
    if (!entry.complete && due > (entry.end ?? entry.start)) return;
    const mine = this.generation;
    this.captionTimer = setTimeout(() => {
      this.captionTimer = null;
      if (mine !== this.generation) return;
      mark.shown = true;
      this.events.onCaption?.(mark.text);
      this.scheduleCaptions();
    }, Math.max(0, (due - this.context.currentTime) * 1000));
  }
}

/** The playback context at xAI's 24 kHz (resampled once, at the output),
 * or the device's own rate when the browser refuses it. */
function playbackContext(): AudioContext {
  try {
    return new AudioContext({ latencyHint: "interactive", sampleRate: 24_000 });
  } catch {
    return new AudioContext({ latencyHint: "interactive" });
  }
}
