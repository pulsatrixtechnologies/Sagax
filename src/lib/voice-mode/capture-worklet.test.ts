// AudioWorklet capture: the processor posts 16 kHz VAD frames from an inline
// Blob module. ScriptProcessor is the fallback when the worklet cannot load.
// Speakers (no headphones): echo residue after AEC never barges in; a louder
// person over the bot does.
import { describe, expect, it, vi } from "vitest";

import { EchoGuard } from "./echo";
import { TurnDetector } from "./turns";
import {
  attachVoiceCapture,
  CAPTURE_WORKLET_NAME,
  CAPTURE_WORKLET_SOURCE,
} from "./capture-worklet";

function loadProcessor(): { process: (inputs: Float32Array[][]) => boolean; port: { posted: Float32Array[] } } {
  const posted: Float32Array[] = [];
  class AudioWorkletProcessor {
    port = { postMessage: (data: Float32Array) => posted.push(data) };
  }
  let registered: (new () => { process: (inputs: Float32Array[][]) => boolean }) | undefined;
  const registerProcessor = (_name: string, ctor: new () => { process: (inputs: Float32Array[][]) => boolean }) => {
    expect(_name).toBe(CAPTURE_WORKLET_NAME);
    registered = ctor;
  };
  const run = new Function("AudioWorkletProcessor", "registerProcessor", CAPTURE_WORKLET_SOURCE);
  run(AudioWorkletProcessor, registerProcessor);
  const proc = new registered!();
  return { process: (inputs) => proc.process(inputs), port: { posted } };
}

describe("AudioWorklet capture processor", () => {
  it("posts 512-sample frames, not the 128-sample render quantum", () => {
    const proc = loadProcessor();
    for (let i = 0; i < 3; i++) {
      const block = new Float32Array(128);
      block.fill(i + 1);
      expect(proc.process([[block]])).toBe(true);
    }
    expect(proc.port.posted).toHaveLength(0);
    expect(proc.process([[new Float32Array(128).fill(4)]])).toBe(true);
    expect(proc.port.posted).toHaveLength(1);
    expect(proc.port.posted[0]!.length).toBe(512);
    expect(proc.port.posted[0]![0]).toBe(1);
    expect(proc.port.posted[0]![511]).toBe(4);
  });

  it("posts nothing for an empty input (keeps the graph alive)", () => {
    const proc = loadProcessor();
    expect(proc.process([[]])).toBe(true);
    expect(proc.process([])).toBe(true);
    expect(proc.port.posted).toHaveLength(0);
  });
});

describe("attachVoiceCapture", () => {
  it("loads the worklet from a blob URL and delivers frames on the port", async () => {
    const frames: Float32Array[] = [];
    let moduleUrl = "";
    let onmessage: ((event: MessageEvent) => void) | null = null;
    class FakeWorkletNode {
      port = {
        set onmessage(handler: ((event: MessageEvent) => void) | null) { onmessage = handler; },
        get onmessage() { return onmessage; },
      };
      connect() {}
      disconnect() {}
      constructor(_context: unknown, name: string) {
        expect(name).toBe(CAPTURE_WORKLET_NAME);
      }
    }
    const source = { connect: vi.fn() };
    const silent = { gain: { value: 1 }, connect: vi.fn(), disconnect() {} };
    const context = {
      sampleRate: 16_000,
      destination: {},
      audioWorklet: { addModule: vi.fn(async (url: string) => { moduleUrl = url; }) },
      createScriptProcessor: vi.fn(),
      createGain: () => silent,
    };
    const capture = await attachVoiceCapture(context as never, source as never, (frame) => frames.push(frame), { WorkletNode: FakeWorkletNode as never });
    expect(capture.kind).toBe("worklet");
    expect(moduleUrl.startsWith("blob:") || moduleUrl.startsWith("data:")).toBe(true);
    expect(context.createScriptProcessor).not.toHaveBeenCalled();
    expect(silent.gain.value).toBe(0);
    const frame = new Float32Array([0.5]);
    onmessage!({ data: frame } as MessageEvent);
    expect(frames[0]).toBe(frame);
    capture.disconnect();
  });

  it("falls back to ScriptProcessor when the worklet cannot load", async () => {
    const frames: Float32Array[] = [];
    const processor = { onaudioprocess: null as ((event: { inputBuffer: { getChannelData: (n: number) => Float32Array } }) => void) | null, connect() {}, disconnect() {} };
    const context = {
      sampleRate: 16_000,
      destination: {},
      audioWorklet: { addModule: async () => { throw new Error("no worklet"); } },
      createScriptProcessor: vi.fn(() => processor),
    };
    const capture = await attachVoiceCapture(context as never, { connect() {} } as never, (frame) => frames.push(frame));
    expect(capture.kind).toBe("script");
    expect(context.createScriptProcessor).toHaveBeenCalled();
    const data = new Float32Array([0.2]);
    processor.onaudioprocess!({ inputBuffer: { getChannelData: () => data } });
    expect(frames[0]).toBe(data);
    capture.disconnect();
  });
});

describe("speakers (no headphones)", () => {
  it("echo residue after AEC does not barge-in; a louder person over the bot does", () => {
    const guard = new EchoGuard();
    const turns = new TurnDetector();
    const playback = 0.1;
    const residue = playback * 0.05;
    const events: string[] = [];
    for (let i = 0; i < 80; i++) {
      const echo = guard.update(residue, playback);
      const event = turns.feed({ probability: 0.9, level: residue, botAudible: true, echo });
      if (event) events.push(event.type);
    }
    expect(events).toEqual([]);
    const voice = 0.08;
    const echo = guard.update(voice, playback);
    expect(echo).toBe(false);
    const barge = turns.feed({ probability: 0.95, level: voice, botAudible: true, echo });
    expect(barge).toMatchObject({ type: "candidate", bargeIn: true });
  });
});
