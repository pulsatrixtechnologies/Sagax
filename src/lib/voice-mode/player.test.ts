// What the person heard of an answer, from the player's audio clock: whole
// sentences that played, the share of the one playing (cut at a word), and
// everything queued behind it (docs/voice-mode-xai.md, barge-in). How a cut
// stops the voice, and the jitter buffer.
import { afterEach, describe, expect, it, vi } from "vitest";

import { BASE_LEAD_S, DUCK_LEVEL, DUCK_SOFT, FADE_MS, GAP_FADE_MS, PcmPlayer, PREBUFFER_S, splitAtShare, type Sentence } from "./player";

class FakeParam {
  value: number;
  events: Array<{ type: "cancel" | "set" | "ramp" | "exp"; value: number; time: number }> = [];
  constructor(value: number) {
    this.value = value;
  }
  cancelScheduledValues(time: number) { this.events.push({ type: "cancel", value: Number.NaN, time }); }
  setValueAtTime(value: number, time: number) { this.events.push({ type: "set", value, time }); }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ type: "ramp", value, time }); }
  exponentialRampToValueAtTime(value: number, time: number) { this.events.push({ type: "exp", value, time }); }
  ramps() { return this.events.filter((event) => event.type === "ramp"); }
}

class FakeGain {
  gain = new FakeParam(1);
  connected = false;
  target: FakeGain | null = null;
  connect(node?: FakeGain) {
    this.connected = true;
    if (node instanceof FakeGain) this.target = node;
  }
  disconnect() { this.connected = false; }
}

class FakeSource {
  buffer: { duration: number } | null = null;
  /** the chunk's own gain, and the answer's bus behind it */
  gain: FakeGain | null = null;
  bus: FakeGain | null = null;
  startAt?: number;
  stopAt?: number;
  onended: (() => void) | null = null;
  connect(node: FakeGain) {
    this.gain = node;
    this.bus = node.target ?? node;
  }
  disconnect() { this.bus = null; }
  start(at: number) { this.startAt = at; }
  stop(at = 0) { this.stopAt = at; }
}

class FakeContext {
  time = 0;
  /** an audio clock that runs on its own (fake timers' Date) */
  clock?: () => number;
  state = "running";
  destination = {};
  sources: FakeSource[] = [];
  get currentTime() { return this.clock ? this.clock() : this.time; }
  set currentTime(value: number) { this.time = value; }
  createGain() { return new FakeGain(); }
  createAnalyser() { return { fftSize: 0, connect() {}, disconnect() {}, getFloatTimeDomainData() {} }; }
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createOscillator() { return { type: "", frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
  async resume() {}
  async close() {}
}

function pcm(seconds: number): Uint8Array {
  return new Uint8Array(Math.round(seconds * 24_000) * 2);
}

/** One sentence whose audio is `seconds` long at 24 kHz, all of it at once,
 * or only its first part (`partial`: the stream stays open). */
function sentence(text: string, seconds: number, partial = false): Sentence {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(pcm(seconds));
      if (!partial) controller.close();
    },
  });
  return { text, audio: Promise.resolve({ body, sampleRate: 24_000 }), abort() {} };
}

/** A sentence whose chunks the test hands over one by one. */
function live(text: string) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const state = { cancelled: false, aborted: false };
  const body = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    cancel() { state.cancelled = true; },
  });
  return {
    state,
    sentence: { text, audio: Promise.resolve({ body, sampleRate: 24_000 }), abort() { state.aborted = true; } } as Sentence,
    push(seconds: number) { controller.enqueue(pcm(seconds)); },
    end() { controller.close(); },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const settle = async (ticks = 10) => { for (let i = 0; i < ticks; i++) await tick(); };

function setup() {
  const context = new FakeContext();
  const player = new PcmPlayer(() => context as unknown as AudioContext);
  return { context, player };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PcmPlayer playback", () => {
  it("knows which sentences were heard, and where in the playing one it was cut", async () => {
    const { context, player } = setup();
    player.enqueue(sentence("It is sunny in Montreal today.", 2));
    player.enqueue(sentence("Tomorrow it will rain all day long.", 2));
    player.enqueue(sentence("Bring an umbrella.", 1));
    await settle();
    // nothing played yet
    expect(player.playback()).toEqual({ heard: "", unheard: "It is sunny in Montreal today. Tomorrow it will rain all day long. Bring an umbrella." });
    // the first sentence whole, then about half of the second
    context.currentTime = PREBUFFER_S + 2 + 1;
    expect(player.playback()).toEqual({ heard: "It is sunny in Montreal today. Tomorrow it will", unheard: "rain all day long. Bring an umbrella." });
    player.resetLedger();
    expect(player.playback()).toEqual({ heard: "", unheard: "" });
  });

  it("places the cut by speaking rate while a sentence's audio still arrives", async () => {
    const { context, player } = setup();
    // 0.2 s arrived of a sentence that takes about 3 s to say
    player.enqueue(sentence("The meeting moved to Thursday at three in the afternoon.", 0.2, true));
    await settle();
    context.currentTime = PREBUFFER_S + 1;
    const cut = player.playback();
    expect(cut.heard.length).toBeGreaterThan(0);
    expect(cut.heard.length).toBeLessThan(30);
    expect(`${cut.heard} ${cut.unheard}`).toBe("The meeting moved to Thursday at three in the afternoon.");
  });
});

describe("PcmPlayer barge-in", () => {
  it("silences the cut answer on the audio clock within the fade", async () => {
    const { context, player } = setup();
    const playing = live("A long first sentence.");
    player.enqueue(playing.sentence);
    playing.push(0.4);
    playing.push(0.4);
    await settle();
    context.currentTime = 0.3;
    void player.cancel();
    const cutAt = 0.3 + FADE_MS / 1000;
    expect(context.sources).toHaveLength(2);
    for (const source of context.sources) expect(source.stopAt).toBeCloseTo(cutAt, 6);
    // the second chunk was scheduled after the fade: it never plays at all
    expect(context.sources[1]!.startAt!).toBeGreaterThan(cutAt);
    const bus = context.sources[0]!.bus!;
    expect(bus.gain.ramps().at(-1)).toEqual({ type: "ramp", value: 0, time: cutAt });
  });

  it("plays what is queued after a cut on a fresh bus at full level", async () => {
    const { context, player } = setup();
    player.enqueue(sentence("The answer the person cut.", 1));
    await settle();
    const cutBus = context.sources[0]!.bus!;
    const faded = player.cancel();
    player.enqueue(sentence("The next answer.", 0.5));
    await settle();
    expect(context.sources).toHaveLength(2);
    const nextBus = context.sources[1]!.bus!;
    expect(nextBus).not.toBe(cutBus);
    expect(nextBus.gain.ramps()).toEqual([]);
    expect(nextBus.gain.value).toBe(1);
    expect(context.sources[1]!.stopAt).toBeUndefined();
    await faded;
    expect(cutBus.connected).toBe(false);
    expect(nextBus.connected).toBe(true);
  });

  it("is idle at once when cut, and the cut answer never reports idle again", async () => {
    vi.useFakeTimers();
    const { context, player } = setup();
    const origin = Date.now();
    context.clock = () => (Date.now() - origin) / 1000;
    let idles = 0;
    const started: string[] = [];
    player.events.onIdle = () => { idles += 1; };
    player.events.onSentenceStart = (text) => started.push(text);
    player.enqueue(sentence("The answer the person cut.", 2));
    await vi.advanceTimersByTimeAsync(100);
    expect(started).toEqual(["The answer the person cut."]);
    void player.cancel();
    expect(idles).toBe(1);
    expect(player.busy).toBe(false);
    player.enqueue(sentence("The next answer.", 0.2));
    // the next answer plays for 200 ms: no idle from the cut meanwhile
    await vi.advanceTimersByTimeAsync(150);
    expect(started).toEqual(["The answer the person cut.", "The next answer."]);
    expect(idles).toBe(1);
    expect(player.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(idles).toBe(2);
    expect(player.busy).toBe(false);
  });

  it("does not report idle before the audio clock has played the last sample", async () => {
    vi.useFakeTimers();
    const { context, player } = setup();
    let idles = 0;
    player.events.onIdle = () => { idles += 1; };
    // the device starts late: its clock runs 60 ms behind the wall clock
    const origin = Date.now();
    context.clock = () => Math.max(0, (Date.now() - origin - 60) / 1000);
    player.enqueue(sentence("Short.", 0.1));
    await vi.advanceTimersByTimeAsync(200);
    expect(idles).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(idles).toBe(1);
  });

  it("reports idle when the audio device stopped, rather than never", async () => {
    vi.useFakeTimers();
    const { player } = setup();
    let idles = 0;
    player.events.onIdle = () => { idles += 1; };
    // the clock stays at 0: a suspended device
    player.enqueue(sentence("Short.", 0.1));
    await vi.advanceTimersByTimeAsync(400);
    expect(idles).toBe(1);
  });

  it("cancels the download of the playing sentence and aborts the queued ones", async () => {
    const { player } = setup();
    const playing = live("Playing.");
    const queued = live("Queued.");
    player.enqueue(playing.sentence);
    player.enqueue(queued.sentence);
    playing.push(0.2);
    await settle();
    void player.cancel();
    await settle(2);
    expect(playing.state.cancelled).toBe(true);
    expect(playing.state.aborted).toBe(true);
    expect(queued.state.aborted).toBe(true);
  });

  it("cancels a cut sentence's audio that arrives after the cut, and plays none of it", async () => {
    const { context, player } = setup();
    const state = { cancelled: false };
    let resolve: (value: Awaited<Sentence["audio"]>) => void = () => {};
    const audio = new Promise<Awaited<Sentence["audio"]>>((done) => { resolve = done; });
    player.enqueue({ text: "late", audio, abort() {} });
    await settle(2);
    void player.cancel();
    resolve({ body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(pcm(0.2)); }, cancel() { state.cancelled = true; } }), sampleRate: 24_000 });
    await settle(4);
    expect(state.cancelled).toBe(true);
    expect(context.sources).toHaveLength(0);
  });

  it("plays a sentence enqueued after cancel while pump still awaits the previous audio", async () => {
    const { player } = setup();
    const started: string[] = [];
    player.events.onSentenceStart = (text) => started.push(text);
    let resolveOld: (value: Awaited<Sentence["audio"]>) => void = () => {};
    const oldAudio = new Promise<Awaited<Sentence["audio"]>>((resolve) => {
      resolveOld = resolve;
    });
    player.enqueue({ text: "old", audio: oldAudio, abort() {} });
    await settle();
    await player.cancel();
    player.enqueue(sentence("new", 0.05));
    resolveOld(null);
    for (let i = 0; i < 20 && started.length === 0; i++) await tick();
    expect(started).toEqual(["new"]);
  });

  it("does not wait for a cut sentence whose audio never comes", async () => {
    const { player } = setup();
    const started: string[] = [];
    player.events.onSentenceStart = (text) => started.push(text);
    player.enqueue({ text: "stuck", audio: new Promise(() => {}), abort() {} });
    await settle(2);
    void player.cancel();
    player.enqueue(sentence("new", 0.05));
    for (let i = 0; i < 20 && started.length === 0; i++) await tick();
    expect(started).toEqual(["new"]);
  });

  it("ducks within 10 ms and comes back up slowly", async () => {
    const { context, player } = setup();
    player.enqueue(sentence("Talking.", 1));
    await settle();
    const bus = context.sources[0]!.bus!;
    context.currentTime = 0.2;
    player.duck();
    expect(bus.gain.ramps().at(-1)!.value).toBe(DUCK_LEVEL);
    expect(bus.gain.ramps().at(-1)!.time).toBeCloseTo(0.21, 6);
    player.unduck();
    expect(bus.gain.ramps().at(-1)!.value).toBe(1);
    expect(bus.gain.ramps().at(-1)!.time).toBeCloseTo(0.32, 6);
  });
});

describe("PcmPlayer jitter buffer", () => {
  it("starts an answer's first chunk PREBUFFER_S ahead, then joins a chunk that arrives in time with no gap", async () => {
    const { context, player } = setup();
    const speech = live("Steady.");
    player.enqueue(speech.sentence);
    speech.push(0.1);
    await settle();
    expect(context.sources[0]!.startAt).toBeCloseTo(PREBUFFER_S, 6);
    // 10 ms of audio left when the next chunk comes
    context.currentTime = PREBUFFER_S + 0.09;
    speech.push(0.1);
    await settle(2);
    expect(context.sources[1]!.startAt).toBeCloseTo(PREBUFFER_S + 0.1, 6);
    expect(player.stats).toEqual({ leadMs: 15, underruns: 0 });
    // the first chunk's fade-out was called off: it joins the next one
    const gain = context.sources[0]!.gain!.gain;
    expect(gain.events.at(-1)).toEqual({ type: "cancel", value: Number.NaN, time: PREBUFFER_S + 0.1 - GAP_FADE_MS / 1000 });
  });

  it("grows the lead after an underrun, fades around the gap, and gives the lead back on audio that plays through", async () => {
    const { context, player } = setup();
    const jittery = live("Jittery.");
    player.enqueue(jittery.sentence);
    jittery.push(0.05);
    await settle();
    // the first chunk ran out at 0.12; the next one comes at 0.155
    context.currentTime = 0.155;
    jittery.push(0.1);
    await settle(2);
    expect(player.stats.underruns).toBe(1);
    // 40 ms late (with the 5 ms join margin), plus 10 ms
    expect(player.stats.leadMs).toBe(65);
    expect(context.sources[1]!.startAt).toBeCloseTo(0.155 + 0.065, 6);
    // the chunk before the gap faded out over its last 3 ms, the one after fades in
    const before = context.sources[0]!.gain!.gain;
    expect(before.ramps().at(-1)).toEqual({ type: "ramp", value: 0, time: PREBUFFER_S + 0.05 });
    expect(before.events.some((event) => event.type === "cancel")).toBe(false);
    const after = context.sources[1]!.gain!.gain;
    expect(after.events[0]!.type).toBe("set");
    expect(after.events[0]!.value).toBe(0);
    expect(after.events[0]!.time).toBeCloseTo(0.155 + 0.065, 6);
    expect(after.events[1]!.type).toBe("ramp");
    expect(after.events[1]!.value).toBe(1);
    expect(after.events[1]!.time).toBeCloseTo(0.155 + 0.065 + GAP_FADE_MS / 1000, 6);
    // two seconds of audio without a gap give 5 ms back
    context.currentTime = 0.3;
    jittery.push(2);
    await settle(2);
    expect(player.stats.leadMs).toBe(60);
  });

  it("a later clause whose first chunk comes late is an underrun too", async () => {
    const { context, player } = setup();
    const first = live("First clause,");
    const second = live("second clause.");
    player.enqueue(first.sentence);
    player.enqueue(second.sentence);
    first.push(0.1);
    first.end();
    await settle(2);
    // the first clause ran out at 0.17; the second's audio comes at 0.2
    context.currentTime = 0.2;
    second.push(0.1);
    await settle(2);
    expect(player.stats.underruns).toBe(1);
    expect(context.sources[1]!.startAt).toBeGreaterThan(0.2);
  });

  it("a long silence in an open answer (the bot writing) is not an underrun", async () => {
    const { context, player } = setup();
    const answer = live("Thinking aloud.");
    player.enqueue(answer.sentence);
    answer.push(0.1);
    await settle();
    context.currentTime = 3;
    answer.push(0.1);
    await settle(2);
    expect(player.stats).toEqual({ leadMs: 15, underruns: 0 });
    expect(context.sources[1]!.startAt).toBeCloseTo(3 + BASE_LEAD_S, 6);
  });
});

describe("PcmPlayer open utterance", () => {
  it("grows the playing sentence's words, and the cut is placed in the whole text", async () => {
    const { context, player } = setup();
    const answer = live("Bonjour,");
    player.enqueue(answer.sentence);
    answer.push(0.5);
    await settle();
    player.extend(" il fait beau.", { text: "il fait beau." });
    player.extend(" Autre chose?", { text: "Autre chose?" });
    answer.push(2);
    answer.end();
    await settle(2);
    context.currentTime = PREBUFFER_S + 2.6;
    expect(player.playback()).toEqual({ heard: "Bonjour, il fait beau. Autre chose?", unheard: "" });
    context.currentTime = PREBUFFER_S + 0.5;
    const cut = player.playback();
    expect(`${cut.heard} ${cut.unheard}`).toBe("Bonjour, il fait beau. Autre chose?");
    expect(cut.heard.length).toBeLessThan(15);
  });

  it("captions each clause when the voice reaches it", async () => {
    vi.useFakeTimers();
    const { context, player } = setup();
    const origin = Date.now();
    context.clock = () => (Date.now() - origin) / 1000;
    const captions: string[] = [];
    player.events.onSentenceStart = (text) => captions.push(`start:${text}`);
    player.events.onCaption = (text) => captions.push(text);
    const answer = live("Bien sûr,");
    player.enqueue(answer.sentence);
    answer.push(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(captions).toEqual(["start:Bien sûr,"]);
    // starts at 10 characters: about 0.7 s in at 14 characters a second
    player.extend(" il fait beau aujourd'hui.", { text: "il fait beau aujourd'hui." });
    await vi.advanceTimersByTimeAsync(400);
    expect(captions).toEqual(["start:Bien sûr,"]);
    await vi.advanceTimersByTimeAsync(400);
    expect(captions).toEqual(["start:Bien sûr,", "il fait beau aujourd'hui."]);
  });

  it("says when an open utterance runs dry and when it speaks again", async () => {
    vi.useFakeTimers();
    const { context, player } = setup();
    const origin = Date.now();
    context.clock = () => (Date.now() - origin) / 1000;
    const events: string[] = [];
    player.events.onStarved = () => events.push("starved");
    player.events.onResume = () => events.push("resume");
    player.events.onIdle = () => events.push("idle");
    const answer = live("Un instant,");
    player.enqueue(answer.sentence);
    answer.push(0.2);
    await vi.advanceTimersByTimeAsync(800);
    expect(events).toEqual(["starved"]);
    expect(player.busy).toBe(true);
    answer.push(0.2);
    await vi.advanceTimersByTimeAsync(100);
    expect(events).toEqual(["starved", "resume"]);
    answer.end();
    await vi.advanceTimersByTimeAsync(400);
    expect(events).toEqual(["starved", "resume", "idle"]);
  });
});

describe("PcmPlayer ducking", () => {
  it("ducks softly on a first voiced frame, deeper on a barge-in, never back up by a soft duck", async () => {
    const { context, player } = setup();
    player.enqueue(sentence("Talking.", 1));
    await settle();
    const bus = context.sources[0]!.bus!;
    player.duck(DUCK_SOFT);
    expect(bus.gain.ramps().at(-1)!.value).toBe(DUCK_SOFT);
    expect(player.duckLevel).toBe(DUCK_SOFT);
    player.duck();
    expect(bus.gain.ramps().at(-1)!.value).toBe(DUCK_LEVEL);
    const ramps = bus.gain.ramps().length;
    player.duck(DUCK_SOFT);
    expect(bus.gain.ramps()).toHaveLength(ramps);
    player.unduck();
    expect(bus.gain.ramps().at(-1)!.value).toBe(1);
    expect(player.duckLevel).toBeNull();
  });
});

describe("PcmPlayer playback context", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs at xAI's 24 kHz, or the device's rate when the browser refuses it", () => {
    const made: Array<Record<string, unknown>> = [];
    let refuse = false;
    vi.stubGlobal("AudioContext", class extends FakeContext {
      constructor(options: Record<string, unknown>) {
        if (refuse && options.sampleRate) throw new DOMException("not supported", "NotSupportedError");
        super();
        made.push(options);
      }
    });
    new PcmPlayer().open();
    expect(made.at(-1)).toEqual({ latencyHint: "interactive", sampleRate: 24_000 });
    refuse = true;
    new PcmPlayer().open();
    expect(made.at(-1)).toEqual({ latencyHint: "interactive" });
  });
});

describe("splitAtShare", () => {
  it("cuts at a word boundary", () => {
    expect(splitAtShare("one two three four", 0.5)).toEqual(["one two", "three four"]);
    expect(splitAtShare("one two", 0)).toEqual(["", "one two"]);
    expect(splitAtShare("one two", 1)).toEqual(["one two", ""]);
    expect(splitAtShare("word", 0.3)).toEqual(["", "word"]);
  });
});

describe("PcmPlayer stability", () => {
  it("a stalled sentence (no bytes for the read timeout) errors, and the next sentence plays", async () => {
    vi.useFakeTimers();
    const { context, player } = setup();
    const origin = Date.now();
    context.clock = () => (Date.now() - origin) / 1000;
    player.readTimeoutMs = 8_000;
    const errors: unknown[] = [];
    const started: string[] = [];
    let idles = 0;
    player.events.onError = (error) => errors.push(error);
    player.events.onSentenceStart = (text) => started.push(text);
    player.events.onIdle = () => { idles += 1; };
    const stalled = live("A clause whose POST stalls.");
    player.enqueue(stalled.sentence);
    stalled.push(0.1);
    player.enqueue(sentence("The next clause.", 0.2));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(errors).toEqual([]);
    expect(player.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(errors).toHaveLength(1);
    expect(stalled.state.cancelled).toBe(true);
    expect(started).toEqual(["A clause whose POST stalls.", "The next clause."]);
    await vi.advanceTimersByTimeAsync(400);
    expect(idles).toBe(1);
    expect(player.busy).toBe(false);
  });

  it("an open utterance (the bot still thinking) is never given up; once closed it is", async () => {
    vi.useFakeTimers();
    const { context, player } = setup();
    const origin = Date.now();
    context.clock = () => (Date.now() - origin) / 1000;
    player.readTimeoutMs = 8_000;
    const errors: unknown[] = [];
    player.events.onError = (error) => errors.push(error);
    const answer = live("Un instant, je regarde.");
    let open = true;
    answer.sentence.open = () => open;
    player.enqueue(answer.sentence);
    answer.push(0.1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(errors).toEqual([]);
    expect(answer.state.cancelled).toBe(false);
    answer.push(0.1);
    open = false;
    await vi.advanceTimersByTimeAsync(8_100);
    expect(errors).toHaveLength(1);
  });

  it("an open utterance closed while its read waits is given up within one more period", async () => {
    vi.useFakeTimers();
    const { context, player } = setup();
    const origin = Date.now();
    context.clock = () => (Date.now() - origin) / 1000;
    player.readTimeoutMs = 8_000;
    const errors: unknown[] = [];
    player.events.onError = (error) => errors.push(error);
    const answer = live("Un instant.");
    let open = true;
    answer.sentence.open = () => open;
    player.enqueue(answer.sentence);
    answer.push(0.1);
    await vi.advanceTimersByTimeAsync(20_000);
    // the same read is still pending: closing it bounds it again
    open = false;
    await vi.advanceTimersByTimeAsync(8_100);
    expect(errors).toHaveLength(1);
  });

  it("an audio promise that never settles is given up too", async () => {
    vi.useFakeTimers();
    const { player } = setup();
    player.readTimeoutMs = 8_000;
    let aborted = false;
    const errors: unknown[] = [];
    player.events.onError = (error) => errors.push(error);
    player.enqueue({ text: "Never answered.", audio: new Promise(() => {}), abort() { aborted = true; } });
    await vi.advanceTimersByTimeAsync(8_100);
    expect(errors).toHaveLength(1);
    expect(aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(player.busy).toBe(false);
  });

  it("resumes an output context the system suspended or interrupted", async () => {
    const listeners: Array<() => void> = [];
    const context = Object.assign(new FakeContext(), {
      addEventListener: (type: string, cb: () => void) => { if (type === "statechange") listeners.push(cb); },
      resume: vi.fn(async () => {}),
    });
    const player = new PcmPlayer(() => context as unknown as AudioContext);
    player.open();
    context.resume.mockClear();
    context.state = "suspended";
    for (const cb of listeners) cb();
    expect(context.resume).toHaveBeenCalledTimes(1);
    context.state = "interrupted";
    for (const cb of listeners) cb();
    expect(context.resume).toHaveBeenCalledTimes(2);
    context.state = "running";
    for (const cb of listeners) cb();
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it("a clock that stopped is not busy forever: idle resets the schedule", async () => {
    vi.useFakeTimers();
    const { context, player } = setup();
    let idles = 0;
    player.events.onIdle = () => { idles += 1; };
    // the device stopped: currentTime stays at 0 while 1 s is scheduled
    player.enqueue(sentence("Scheduled on a stopped clock.", 1));
    await vi.advanceTimersByTimeAsync(2_500);
    expect(idles).toBe(1);
    expect(player.busy).toBe(false);
    // the next answer starts from the clock as it is, not a second later
    player.enqueue(sentence("Next.", 0.1));
    await vi.advanceTimersByTimeAsync(50);
    expect(context.sources.at(-1)!.startAt!).toBeLessThan(0.2);
  });
});
