// VoiceCall with fake devices: the frames of a turn become one message, the
// person talking over the bot ducks it on the first voiced frame and cancels
// it within 160 ms, the bot's echo does not, another voice is ignored once
// enrolled, push-to-talk, mute, and the whole-turn upload when the streaming
// socket cannot open.
import { describe, expect, it, vi } from "vitest";

import { VoiceCall, callAudioConstraints, isNoiseFragment, resampler, type BargeInMetrics, type TurnMetrics } from "./call";
import { DEFAULT_CALL_SETTINGS, type CallSettings } from "./call-settings";
import type { PcmPlayer, Sentence } from "./player";
import type { SpeakerEmbedder } from "./speaker-id";
import { voiceprintOf } from "./speaker-id";
import { LiveTranscriber } from "./stt-stream";
import { VAD_FRAME, type VoiceProbability } from "./vad";

/** The page's view of the listen socket, answering like the server. */
class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = "blob";
  sent: Array<string | ArrayBuffer> = [];
  audioBytes = 0;
  finalizes = 0;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  constructor(readonly url: string, private readonly transcripts: string[], private readonly fail = false) {
    FakeSocket.last = this;
    setTimeout(() => {
      if (this.fail) return this.fire("error", {});
      this.readyState = 1;
      this.fire("message", { data: JSON.stringify({ type: "ready" }) });
    }, 1);
  }
  addEventListener(type: string, cb: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  fire(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
    if (typeof data !== "string") {
      this.audioBytes += data.byteLength;
      return;
    }
    if (JSON.parse(data).type === "finalize") {
      this.finalizes += 1;
      const text = this.transcripts.shift() ?? "";
      setTimeout(() => this.fire("message", { data: JSON.stringify({ type: "transcript", text, final: true, speechFinal: true }) }), 2);
    }
  }
  close() {
    this.readyState = 3;
  }
}

/** A player that "plays" at once: busy while sentences are queued, loud then. */
class FakePlayer {
  events: PcmPlayer["events"] = {};
  queued: Sentence[] = [];
  ducks = 0;
  unducks = 0;
  cancels = 0;
  tones = 0;
  playing = false;
  open() { return {} as AudioContext; }
  get output() { return null; }
  get busy() { return this.playing; }
  level() { return this.playing ? 0.1 : 0; }
  enqueue(sentence: Sentence) {
    this.queued.push(sentence);
    if (!this.playing) {
      this.playing = true;
      this.events.onSentenceStart?.(sentence.text);
    }
  }
  /** everything heard */
  drain() {
    this.playing = false;
    this.queued = [];
    this.events.onIdle?.();
  }
  duck() { this.ducks += 1; }
  unduck() { this.unducks += 1; }
  async cancel() {
    this.cancels += 1;
    for (const s of this.queued) s.abort();
    this.queued = [];
    if (this.playing) {
      this.playing = false;
      this.events.onIdle?.();
    }
  }
  tone() { this.tones += 1; }
  async close() {}
  /** what the person heard when the answer is cut (set by a test) */
  heard = "";
  resetLedger() {}
  playback() {
    const all = this.queued.map((s) => s.text).join(" ");
    return { heard: this.heard, unheard: all.startsWith(this.heard) ? all.slice(this.heard.length).trim() : all };
  }
}

/** VAD from a script: the frame's first sample carries its probability
 * (scaled down so it does not change the frame's level). */
const scriptedVad: VoiceProbability = { probability: async (frame) => Math.round(frame[0]! * 1e4) / 10, reset() {} };

function frame(probability: number, level: number): Float32Array {
  const out = new Float32Array(VAD_FRAME).fill(level);
  out[0] = probability / 1000;
  return out;
}

interface Setup {
  language?: { value: string };
  transcripts?: string[];
  settings?: Partial<CallSettings>;
  socketFails?: boolean;
  embedder?: SpeakerEmbedder | null;
  voiceprint?: ReturnType<typeof voiceprintOf> | null;
  transcribe?: LiveTranscriber["uploadError"];
}

async function setup(options: Setup = {}) {
  let clock = 0;
  const player = new FakePlayer();
  const upload = vi.fn(async () => "uploaded words");
  const transcriber = new LiveTranscriber({
    botId: "b-1",
    language: () => options.language?.value ?? "fr",
    threadId: () => "t-1",
    socket: (url) => new FakeSocket(url, [...(options.transcripts ?? ["hello bot"])], options.socketFails) as unknown as WebSocket,
    transcribe: upload,
    finalTimeoutMs: 200,
  });
  const speech = vi.fn(async (_botId: string, _text: string, _voice: unknown) => ({ body: new ReadableStream<Uint8Array>(), sampleRate: 24_000 }));
  const settings: CallSettings = { ...DEFAULT_CALL_SETTINGS, earcons: true, ...options.settings };
  const track = { enabled: true, stop: vi.fn() };
  const call = new VoiceCall({
    botId: "b-1",
    threadId: () => "t-1",
    voice: () => ({ voice: "ara", speed: 1, language: "fr" }),
    settings: () => settings,
    getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) as unknown as MediaStream),
    createCaptureContext: () => ({
      sampleRate: 16_000,
      state: "running",
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      createAnalyser: () => ({ fftSize: 0, disconnect() {} }),
      createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
      destination: {},
      close: async () => {},
      resume: async () => {},
    }) as unknown as AudioContext,
    player: player as unknown as PcmPlayer,
    transcriber,
    models: async () => ({ vad: scriptedVad, embedder: options.embedder ?? null }),
    speech,
    voiceprint: options.voiceprint ?? null,
    now: () => clock,
  });
  const utterances: Array<{ text: string; metrics: TurnMetrics; interrupted: boolean; cut?: { heard: string; unheard: string } }> = [];
  const interrupts: number[] = [];
  const metrics: Array<{ turn: TurnMetrics | null; bargeIn: BargeInMetrics | null }> = [];
  const rejected: string[] = [];
  call.on("utterance", (text, m, turn) => utterances.push({ text, metrics: { ...m }, interrupted: turn.interrupted, ...(turn.cut ? { cut: turn.cut } : {}) }));
  call.on("interrupt-bot", () => interrupts.push(clock));
  call.on("metrics", (turn, bargeIn) => metrics.push({ turn: turn && { ...turn }, bargeIn: bargeIn && { ...bargeIn } }));
  call.on("rejected", (reason) => rejected.push(reason));
  await call.start();
  const feed = async (probability: number, level: number, count: number) => {
    for (let i = 0; i < count; i++) {
      clock += 32;
      call.frame(frame(probability, level));
      await call.settled();
    }
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { call, player, feed, settle, utterances, interrupts, metrics, rejected, speech, track, upload, clock: () => clock, socket: () => FakeSocket.last! };
}

describe("noise fragments", () => {
  it("drops a lone short token no one says alone, keeps real short answers and numbers", () => {
    for (const text of ["dwad", "Hm.", "a", "...", "zz"]) expect(isNoiseFragment(text), text).toBe(true);
    for (const text of ["yes", "Non.", "OK", "42", "merci", "stop", "call Max", "Trois-Rivieres"]) expect(isNoiseFragment(text), text).toBe(false);
    // a word or two xAI itself doubts
    expect(isNoiseFragment("call Max", 0.2)).toBe(true);
    expect(isNoiseFragment("call Max now please", 0.2)).toBe(false);
  });
});

describe("VoiceCall", () => {
  it("asks the microphone for echo cancellation, noise suppression, auto gain, and voice isolation when offered", () => {
    expect(callAudioConstraints(undefined, { voiceIsolation: true })).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, voiceIsolation: true });
    expect(callAudioConstraints("mic-2", {})).not.toHaveProperty("voiceIsolation");
    expect(callAudioConstraints("mic-2", {})).toMatchObject({ deviceId: { exact: "mic-2" } });
  });

  it("connects, hears a turn and sends its words once, streaming only the turn's audio", async () => {
    const t = await setup();
    expect(t.call.current.phase).toBe("listening");
    await t.feed(0.02, 0.001, 20); // a quiet room: nothing streamed
    expect(t.socket().audioBytes).toBe(0);
    await t.feed(0.95, 0.05, 40); // 1.3 s of speech
    await t.feed(0.02, 0.001, 25); // 800 ms of silence
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["hello bot"]);
    // nothing was cut: the bot is not told it was interrupted
    expect(t.utterances[0]!.interrupted).toBe(false);
    expect(t.socket().finalizes).toBe(1);
    // the turn's frames (plus a short preroll), not the quiet room before it
    expect(t.socket().audioBytes).toBeGreaterThan(40 * VAD_FRAME * 2);
    // (the endpoint's silence is streamed too: xAI hears the turn end)
    expect(t.socket().audioBytes).toBeLessThan(72 * VAD_FRAME * 2);
    const turn = t.utterances[0]!.metrics;
    // ended about one endpoint (the normal pause) after the last voiced frame
    expect(turn.endedAt - turn.stoppedAt).toBeGreaterThanOrEqual(700);
    expect(turn.endedAt - turn.stoppedAt).toBeLessThan(800);
    expect(t.call.current.phase).toBe("thinking");
  });

  it("barge-in: ducks the bot on the first voiced frame, cancels it within 160 ms, interrupts its running turn", async () => {
    const t = await setup({ transcripts: ["wait, stop"] });
    t.call.setBotBusy(true);
    void t.call.say("Here is a long answer. It goes on and on for a while.");
    expect(t.call.current.phase).toBe("speaking");
    // the bot's own echo, below the guard: nothing happens
    await t.feed(0.9, 0.004, 20);
    expect(t.player.ducks).toBe(0);
    const onset = t.clock();
    await t.feed(0.95, 0.06, 1);
    expect(t.player.ducks).toBe(1);
    await t.feed(0.95, 0.06, 4);
    expect(t.player.cancels).toBe(1);
    expect(t.interrupts).toHaveLength(1);
    const barge = t.metrics.at(-1)!.bargeIn!;
    expect(barge.duckedAt! - onset).toBeLessThanOrEqual(32);
    expect(barge.cancelledAt! - onset).toBeLessThanOrEqual(160);
    expect(t.call.current.phase).toBe("interrupted");
    // the new words become the next turn
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["wait, stop"]);
    // the turn that cut the bot says so (Message.voiceCall.interrupted)
    expect(t.utterances[0]!.interrupted).toBe(true);
  });

  it("barge-in: the turn that cut the bot says what the person heard and what they did not", async () => {
    const t = await setup({ transcripts: ["no, the other one"] });
    t.call.setBotBusy(true);
    t.call.replyProgress("It is sunny in Montreal today. Tomorrow it will rain all day. ");
    // the first sentence played, then the person talked over the second
    t.player.heard = "It is sunny in Montreal today.";
    t.call.replyProgress("It is sunny in Montreal today. Tomorrow it will rain all day. Bring an umbrella");
    const cuts: Array<{ heard: string; unheard: string }> = [];
    t.call.on("speech-cancelled", (cut) => cuts.push(cut));
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(cuts[0]).toEqual({ heard: "It is sunny in Montreal today.", unheard: "Tomorrow it will rain all day. Bring an umbrella" });
    expect(t.utterances[0]).toMatchObject({ text: "no, the other one", interrupted: true, cut: cuts[0] });
    // the next turn cut nothing
    t.call.setBotBusy(false);
  });

  it("a turn that starts right after the last one, before the bot spoke, is the same utterance", async () => {
    const t = await setup({ transcripts: ["the weather right now in", "Trois-Rivieres please"] });
    await t.feed(0.95, 0.06, 30);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["the weather right now in"]);
    t.call.setBotBusy(true);
    // the person goes on 600 ms later: the fragment's turn is cancelled
    await t.feed(0.02, 0.001, 18);
    await t.feed(0.95, 0.06, 30);
    expect(t.interrupts).toHaveLength(1);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["the weather right now in", "the weather right now in Trois-Rivieres please"]);
    const utterances: Array<{ continues?: boolean }> = [];
    t.call.on("utterance", (_text, _m, turn) => utterances.push(turn));
    // once the bot has spoken, the next turn is a new one
    void t.call.say("It is sunny.");
    t.player.drain();
    await t.feed(0.95, 0.06, 30);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(utterances.at(-1)?.continues).toBeUndefined();
  });

  it("a sound the recognizer spelled is no turn", async () => {
    const t = await setup({ transcripts: ["dwad", "yes"] });
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances).toEqual([]);
    expect(t.call.current.phase).toBe("listening");
    await t.feed(0.02, 0.001, 50);
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["yes"]);
  });

  it("only the turn that cut the bot is marked interrupted", async () => {
    const t = await setup({ transcripts: ["wait, stop", "and another thing"] });
    void t.call.say("Here is a long answer. It goes on and on for a while.");
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    t.call.setBotBusy(false);
    // a real pause first: a turn right after the last one would continue it
    await t.feed(0.02, 0.001, 50);
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => [u.text, u.interrupted])).toEqual([["wait, stop", true], ["and another thing", false]]);
  });

  it("the interrupt button marks the next turn interrupted", async () => {
    const t = await setup({ transcripts: ["go on"] });
    void t.call.say("Here is a long answer. It goes on and on for a while.");
    t.call.interrupt();
    await t.feed(0.95, 0.06, 20);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => [u.text, u.interrupted])).toEqual([["go on", true]]);
  });

  it("never speaks markdown, emoji, links or the written follow-up", async () => {
    const t = await setup();
    t.call.replyProgress("**Sure!** \u{1F600} See https://example.com/a for it.\n\n- First point here");
    const heard = t.call.replyDone("**Sure!** \u{1F600} See https://example.com/a for it.\n\n- First point here\n\nBye for now.\n\n---\nDetails: https://example.com/b");
    const said = t.speech.mock.calls.map((c) => c[1]).join(" ");
    expect(said).toContain("Sure!");
    expect(said).toContain("First point here");
    expect(said).toContain("Bye for now.");
    expect(said).not.toMatch(/\*|https?:|example\.com|Details|---|\u{1F600}/u);
    t.player.drain();
    await heard;
  });

  it("a cough over the bot: ducked, then back, nothing cancelled", async () => {
    const t = await setup();
    void t.call.say("Here is a long answer that keeps going.");
    await t.feed(0.95, 0.06, 2);
    await t.feed(0.02, 0.001, 6);
    expect(t.player.ducks).toBe(1);
    expect(t.player.unducks).toBe(1);
    expect(t.player.cancels).toBe(0);
    expect(t.call.current.phase).toBe("speaking");
  });

  it("speaks a streamed answer sentence by sentence while it is written", async () => {
    const t = await setup();
    t.call.replyProgress("Sure. Let me");
    expect(t.speech).toHaveBeenCalledTimes(1);
    expect(t.speech.mock.calls[0]![1]).toBe("Sure.");
    t.call.replyProgress("Sure. Let me check that for you right now. And");
    expect(t.speech).toHaveBeenCalledTimes(2);
    const heard = t.call.replyDone("Sure. Let me check that for you right now. And here it is.");
    expect(t.speech).toHaveBeenCalledTimes(3);
    expect(t.speech.mock.calls.map((c) => c[1])).toEqual(["Sure.", "Let me check that for you right now.", "And here it is."]);
    // the person's Voice, Speed and Language go with every sentence
    expect(t.speech.mock.calls[0]![2]).toEqual({ voice: "ara", speed: 1, language: "fr" });
    t.player.drain();
    await expect(heard).resolves.toBe(true);
    expect(t.call.current.phase).toBe("listening");
  });

  it("with Only my voice and an enrollment, another voice is ignored", async () => {
    const mine = new Float32Array(512).fill(0.1);
    const theirs = Float32Array.from({ length: 512 }, (_, i) => (i % 2 ? 0.1 : -0.1));
    let next = theirs;
    const embedder = { embed: async () => next } as unknown as SpeakerEmbedder;
    const t = await setup({ embedder, voiceprint: voiceprintOf([mine], 0), transcripts: ["the tv talking", "my words"] });
    expect(t.call.verifying).toBe(true);
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances).toEqual([]);
    expect(t.rejected).toEqual(["other-voice"]);
    next = mine;
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["my words"]);
  });

  it("push to talk: the turn is what is said while the key is held", async () => {
    const t = await setup({ settings: { input: "push" }, transcripts: ["pushed words"] });
    await t.feed(0.95, 0.05, 20); // talking without the key: not a turn
    await t.settle();
    expect(t.utterances).toEqual([]);
    t.call.pushToTalk(true);
    await t.feed(0.95, 0.05, 20);
    t.call.pushToTalk(false);
    await t.settle();
    expect(t.utterances.map((u) => u.text)).toEqual(["pushed words"]);
  });

  it("mute: frames are not heard and the track is off; unmute hears again", async () => {
    const t = await setup();
    t.call.setMuted(true);
    expect(t.track.enabled).toBe(false);
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances).toEqual([]);
    t.call.setMuted(false);
    expect(t.track.enabled).toBe(true);
  });

  it("hold: nothing heard, nothing said; resume", async () => {
    const t = await setup();
    void t.call.say("Something to say.");
    t.call.hold();
    expect(t.player.cancels).toBe(1);
    expect(t.call.current.phase).toBe("held");
    await t.feed(0.95, 0.05, 40);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.utterances).toEqual([]);
    t.call.resume();
    expect(t.call.current.phase).toBe("listening");
  });

  it("without the streaming socket, each turn is uploaded whole", async () => {
    const t = await setup({ socketFails: true });
    await t.feed(0.95, 0.05, 30);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    expect(t.upload).toHaveBeenCalledTimes(1);
    const [, blob, language, thread] = t.upload.mock.calls[0]! as unknown as [string, Blob, string, string];
    expect(blob.type).toBe("audio/wav");
    expect([language, thread]).toEqual(["fr", "t-1"]);
    expect(t.utterances.map((u) => u.text)).toEqual(["uploaded words"]);
  });

  it("a language picked during the call opens a socket for it before the next turn", async () => {
    const language = { value: "auto" };
    const t = await setup({ language, transcripts: ["bonjour"] });
    const first = t.socket();
    expect(first.url).toContain("language=auto");
    language.value = "fr";
    await t.feed(0.95, 0.05, 2);
    await t.settle(); // frames arrive in real time: the new socket opens meanwhile
    await t.feed(0.95, 0.05, 28);
    await t.feed(0.02, 0.001, 25);
    await t.settle();
    const second = t.socket();
    expect(second).not.toBe(first);
    expect(second.url).toContain("language=fr");
    expect(second.audioBytes).toBeGreaterThan(0);
    expect(t.utterances.map((u) => u.text)).toEqual(["bonjour"]);
  });

  it("ending the call releases the microphone and the ears", async () => {
    const t = await setup();
    t.call.end();
    expect(t.track.stop).toHaveBeenCalled();
    expect(t.call.current.phase).toBe("ended");
  });
});

describe("resampler", () => {
  it("turns 48 kHz into 512-sample frames at 16 kHz", () => {
    const run = resampler(48_000);
    const frames = [...run(new Float32Array(4096).fill(0.5)), ...run(new Float32Array(4096).fill(0.5))];
    expect(frames.length).toBe(Math.floor((8192 / 3) / 512));
    expect(frames[0]!.length).toBe(512);
    expect(frames[0]![10]).toBeCloseTo(0.5);
  });
});
