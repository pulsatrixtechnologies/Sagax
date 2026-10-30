import { describe, expect, it } from "vitest";

import { openHttpSpeechStream } from "./http-speech-stream.ts";

function pcm(...chunks: number[][]): { body: ReadableStream<Uint8Array>; sampleRate: number } {
  return { body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk)); controller.close(); } }), sampleRate: 24_000 };
}

function recorder() {
  const events: string[] = [];
  const audio: number[] = [];
  return {
    events, audio,
    handlers: {
      onAudio: (bytes: Uint8Array) => { audio.push(...bytes); events.push(`audio:${bytes.byteLength}`); },
      onDone: () => events.push("done"),
      onCleared: () => events.push("cleared"),
      onError: (message: string) => events.push(`error:${message}`),
      onClose: () => events.push("close"),
    },
  };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("a live call's voice over HTTP (server/tts/http-speech-stream.ts)", () => {
  it("speaks each finished sentence at once, in order, and ends the utterance after the last", async () => {
    const asked: string[] = [];
    const rec = recorder();
    const stream = openHttpSpeechStream({ synthesize: async (text) => { asked.push(text); return pcm([1, 2], [3, 4]); }, idleMs: 1_000 }, rec.handlers);
    await stream.ready;
    stream.delta("Bonjour. Comment");
    await tick();
    // the first sentence goes before the rest is written
    expect(asked).toEqual(["Bonjour."]);
    stream.delta(" vas-tu?");
    stream.done();
    await tick(10);
    expect(asked).toEqual(["Bonjour.", "Comment vas-tu?"]);
    expect(rec.events.at(-1)).toBe("done");
    expect(rec.audio).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  });

  it("speaks held words once the bot pauses", async () => {
    const asked: string[] = [];
    const stream = openHttpSpeechStream({ synthesize: async (text) => { asked.push(text); return pcm([0, 0]); }, idleMs: 20 }, recorder().handlers);
    await stream.ready;
    stream.delta("Je regarde");
    await tick(5);
    expect(asked).toEqual([]);
    await tick(40);
    expect(asked).toEqual(["Je regarde"]);
  });

  it("keeps whole 16-bit samples when a chunk splits one", async () => {
    const rec = recorder();
    const stream = openHttpSpeechStream({ synthesize: async () => pcm([1, 2, 3], [4]) }, rec.handlers);
    await stream.ready;
    stream.speak("Oui.");
    await tick(10);
    expect(rec.events.filter((event) => event.startsWith("audio"))).toEqual(["audio:2", "audio:2"]);
    expect(rec.audio).toEqual([1, 2, 3, 4]);
  });

  it("clears what is speaking on a barge-in and says nothing more of it", async () => {
    let release!: () => void;
    const rec = recorder();
    let aborted = false;
    const stream = openHttpSpeechStream({
      synthesize: async (_text, signal) => {
        signal.addEventListener("abort", () => { aborted = true; });
        return { body: new ReadableStream({ async start(controller) { controller.enqueue(new Uint8Array([1, 1])); await new Promise<void>((resolve) => { release = resolve; }); controller.enqueue(new Uint8Array([2, 2])); controller.close(); } }), sampleRate: 24_000 };
      },
    }, rec.handlers);
    await stream.ready;
    stream.speak("Une longue réponse.");
    await tick(5);
    stream.clear();
    release();
    await tick(10);
    expect(aborted).toBe(true);
    expect(rec.events).toEqual(["audio:2", "cleared"]);
  });

  it("is a dropped socket when the provider fails, and refuses to open on a bad key", async () => {
    const rec = recorder();
    const stream = openHttpSpeechStream({ synthesize: async () => { throw new Error("OpenAI is rate-limiting speech. Wait a moment and try again."); } }, rec.handlers);
    await stream.ready;
    stream.speak("Bonjour.");
    await tick(5);
    expect(rec.events).toEqual(["error:OpenAI is rate-limiting speech. Wait a moment and try again.", "close"]);

    const refused = recorder();
    const bad = openHttpSpeechStream({ synthesize: async () => pcm(), verify: async () => { throw new Error("OpenAI rejected the key or its permissions."); } }, refused.handlers);
    await expect(bad.ready).rejects.toThrow();
    expect(refused.events).toEqual(["error:OpenAI rejected the key or its permissions.", "close"]);
  });
});
