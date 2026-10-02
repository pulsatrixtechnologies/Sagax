// What the person heard of an answer, from the player's audio clock: whole
// sentences that played, the share of the one playing (cut at a word), and
// everything queued behind it (docs/voice-mode-xai.md, barge-in).
import { describe, expect, it } from "vitest";

import { PcmPlayer, splitAtShare, type Sentence } from "./player";

class FakeContext {
  currentTime = 0;
  state = "running";
  destination = {};
  private param() {
    return { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  }
  createGain() { return { gain: this.param(), connect() {} }; }
  createAnalyser() { return { fftSize: 0, connect() {}, disconnect() {}, getFloatTimeDomainData() {} }; }
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  createBufferSource() { return { buffer: null, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
  createOscillator() { return { type: "", frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
  async resume() {}
  async close() {}
}

/** One sentence whose audio is `seconds` long at 24 kHz, all of it at once,
 * or only its first part (`partial`: the stream stays open). */
function sentence(text: string, seconds: number, partial = false): Sentence {
  const bytes = new Uint8Array(Math.round(seconds * 24_000) * 2);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      if (!partial) controller.close();
    },
  });
  return { text, audio: Promise.resolve({ body, sampleRate: 24_000 }), abort() {} };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("PcmPlayer playback", () => {
  it("knows which sentences were heard, and where in the playing one it was cut", async () => {
    const context = new FakeContext();
    const player = new PcmPlayer(() => context as unknown as AudioContext);
    player.enqueue(sentence("It is sunny in Montreal today.", 2));
    player.enqueue(sentence("Tomorrow it will rain all day long.", 2));
    player.enqueue(sentence("Bring an umbrella.", 1));
    for (let i = 0; i < 10; i++) await tick();
    // nothing played yet
    expect(player.playback()).toEqual({ heard: "", unheard: "It is sunny in Montreal today. Tomorrow it will rain all day long. Bring an umbrella." });
    // the first sentence whole, then about half of the second
    context.currentTime = 0.015 + 2 + 1;
    expect(player.playback()).toEqual({ heard: "It is sunny in Montreal today. Tomorrow it will", unheard: "rain all day long. Bring an umbrella." });
    player.resetLedger();
    expect(player.playback()).toEqual({ heard: "", unheard: "" });
  });

  it("places the cut by speaking rate while a sentence's audio still arrives", async () => {
    const context = new FakeContext();
    const player = new PcmPlayer(() => context as unknown as AudioContext);
    // 0.2 s arrived of a sentence that takes about 3 s to say
    player.enqueue(sentence("The meeting moved to Thursday at three in the afternoon.", 0.2, true));
    for (let i = 0; i < 10; i++) await tick();
    context.currentTime = 0.015 + 1;
    const cut = player.playback();
    expect(cut.heard.length).toBeGreaterThan(0);
    expect(cut.heard.length).toBeLessThan(30);
    expect(`${cut.heard} ${cut.unheard}`).toBe("The meeting moved to Thursday at three in the afternoon.");
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
