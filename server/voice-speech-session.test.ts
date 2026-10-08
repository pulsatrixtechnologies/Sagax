// The streaming voice's server session (voice-speech-session.ts) with a
// fake xAI socket: clauses one after the other, barge-in cleared at xAI,
// a dropped socket failing the clauses in flight and reconnecting with a
// backoff, three failed reconnects in a row ending in a fallback logged
// once, a stuck clause or clear counted as a drop.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SpeechStream, SpeechStreamHandlers } from "./tts/grok.ts";
import { createSpeechSession, SPEECH_BACKOFF_MS, type SpeechFrame } from "./voice-speech-session.ts";

class FakeUpstream implements SpeechStream {
  spoken: string[] = [];
  clears = 0;
  closed = false;
  ready: Promise<void>;
  private open!: () => void;
  private refuse!: (error: Error) => void;
  constructor(readonly handlers: SpeechStreamHandlers) {
    this.ready = new Promise((resolve, reject) => { this.open = resolve; this.refuse = reject; });
    this.ready.catch(() => {});
  }
  speak(text: string) { this.spoken.push(text); }
  clear() { this.clears += 1; }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.refuse(new Error("closed"));
    this.handlers.onClose();
  }
  accept() { this.open(); }
  /** the connection dropped (xAI side) */
  drop() { this.close(); }
}

function make() {
  const upstreams: FakeUpstream[] = [];
  const frames: SpeechFrame[] = [];
  const audio: number[] = [];
  const usage: number[] = [];
  const log = vi.fn();
  const closePage = vi.fn();
  const session = createSpeechSession({
    open: (handlers) => {
      const upstream = new FakeUpstream(handlers);
      upstreams.push(upstream);
      return upstream;
    },
    speakable: (text) => text.replace(/```[\s\S]*?```/g, "").trim(),
    usage: (n) => usage.push(n),
    sendText: (frame) => frames.push(frame),
    sendBinary: (pcm) => audio.push(pcm.byteLength),
    closePage,
    log,
    sampleRate: 24_000,
  });
  const say = (id: string, text: string) => session.message(JSON.stringify({ type: "say", id, text }));
  const cancel = (id: string) => session.message(JSON.stringify({ type: "cancel", id }));
  return { session, upstreams, up: () => upstreams.at(-1)!, frames, audio, usage, log, closePage, say, cancel };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe("streaming voice session (server side)", () => {
  it("opens xAI's socket, then speaks each clause in turn, its audio between start and done", async () => {
    const t = make();
    t.up().accept();
    expect(await t.session.ready).toBe(true);
    t.say("c1", "Bonjour,");
    t.say("c2", "voici la suite.");
    await flush();
    // one utterance at a time
    expect(t.up().spoken).toEqual(["Bonjour,"]);
    t.up().handlers.onAudio(new Uint8Array(4800));
    t.up().handlers.onDone();
    expect(t.up().spoken).toEqual(["Bonjour,", "voici la suite."]);
    t.up().handlers.onAudio(new Uint8Array(2400));
    t.up().handlers.onDone();
    expect(t.frames).toEqual([{ type: "start", id: "c1" }, { type: "done", id: "c1" }, { type: "start", id: "c2" }, { type: "done", id: "c2" }]);
    expect(t.audio).toEqual([4800, 2400]);
    expect(t.usage).toEqual([8, 15]);
  });

  it("a clause with nothing speakable is skipped, never sent to xAI; a bad frame is ignored", async () => {
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "```js\nx()\n```");
    t.session.message("not json");
    t.session.message(JSON.stringify({ type: "say", id: "bad id!", text: "x" }));
    expect(t.frames).toEqual([{ type: "skip", id: "c1" }]);
    expect(t.up().spoken).toEqual([]);
  });

  it("barge-in: the clause speaking is cleared at xAI, queued ones dropped, no audio after", async () => {
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Une longue phrase.");
    t.say("c2", "Une autre.");
    t.up().handlers.onAudio(new Uint8Array(100));
    t.cancel("c2");
    t.cancel("c1");
    expect(t.up().clears).toBe(1);
    // xAI's last frames of it, and its own done, before audio.clear
    t.up().handlers.onAudio(new Uint8Array(100));
    t.up().handlers.onDone();
    expect(t.audio).toEqual([100]);
    t.up().handlers.onCleared();
    expect(t.frames).toEqual([{ type: "start", id: "c1" }, { type: "done", id: "c2" }, { type: "done", id: "c1" }]);
    // the next answer goes on the same socket
    t.say("c3", "Nouvelle réponse.");
    expect(t.up().spoken).toEqual(["Une longue phrase.", "Nouvelle réponse."]);
    expect(t.upstreams).toHaveLength(1);
  });

  it("a dropped socket fails the clauses in flight and reconnects with a backoff", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Un.");
    t.say("c2", "Deux.");
    t.up().drop();
    expect(t.frames.at(-1)).toEqual({ type: "error", ids: ["c1", "c2"] });
    await vi.advanceTimersByTimeAsync(SPEECH_BACKOFF_MS[0] - 1);
    expect(t.upstreams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.upstreams).toHaveLength(2);
    // said while it reconnects: waits for it
    t.say("c3", "Trois.");
    expect(t.up().spoken).toEqual([]);
    t.up().accept();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.up().spoken).toEqual(["Trois."]);
    expect(t.log).not.toHaveBeenCalled();
  });

  it("three failed reconnects in a row: fallback to POST, logged once, the page closed", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.up().drop();
    for (const wait of SPEECH_BACKOFF_MS) {
      await vi.advanceTimersByTimeAsync(wait);
      t.up().drop();
    }
    expect(t.upstreams).toHaveLength(1 + SPEECH_BACKOFF_MS.length);
    expect(t.frames.at(-1)).toEqual({ type: "fallback" });
    expect(t.log).toHaveBeenCalledTimes(1);
    expect(t.closePage).toHaveBeenCalledWith(1000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.upstreams).toHaveLength(1 + SPEECH_BACKOFF_MS.length);
  });

  it("a reconnect that works resets the count", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    for (let i = 0; i < 5; i++) {
      t.up().drop();
      await vi.advanceTimersByTimeAsync(SPEECH_BACKOFF_MS[0]);
      t.up().accept();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(t.frames.some((f) => f.type === "fallback")).toBe(false);
  });

  it("an xAI error frame closes that socket (a drop), the clause is failed", async () => {
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Un.");
    t.up().handlers.onError("Grok text to speech reported an error.");
    expect(t.upstreams[0]!.closed).toBe(true);
    expect(t.frames.at(-1)).toEqual({ type: "error", ids: ["c1"] });
  });

  it("a clause stuck without audio, or a clear never confirmed, counts as a drop", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.say("c1", "Bloquée.");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(t.upstreams[0]!.closed).toBe(true);
    expect(t.frames.at(-1)).toEqual({ type: "error", ids: ["c1"] });
    await vi.advanceTimersByTimeAsync(SPEECH_BACKOFF_MS[0]);
    t.up().accept();
    await vi.advanceTimersByTimeAsync(0);
    t.say("c2", "Coupée.");
    t.cancel("c2");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.upstreams[1]!.closed).toBe(true);
  });

  it("an xAI socket that never opens: ready says false (the route answers 502)", async () => {
    const t = make();
    t.up().drop();
    expect(await t.session.ready).toBe(false);
    t.session.close();
  });

  it("closing the session (hang-up) closes xAI's socket and stops reconnecting", async () => {
    vi.useFakeTimers();
    const t = make();
    t.up().accept();
    await t.session.ready;
    t.session.close();
    expect(t.up().closed).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.upstreams).toHaveLength(1);
    expect(t.frames).toEqual([]);
  });
});
