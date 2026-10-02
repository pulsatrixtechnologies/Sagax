// The live call's ears: xAI's streaming finalize semantics. A final chunk is
// one xAI will not revise, not the end of the utterance; only speech_final
// closes it, so the words after a first final chunk are not cut off or
// handed to the next turn.
import { describe, expect, it } from "vitest";

import { LiveTranscriber } from "./stt-stream";
import { VAD_FRAME } from "./vad";

class Socket {
  readyState = 0;
  binaryType = "blob";
  finalizes = 0;
  onFinalize: (socket: Socket) => void = () => {};
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  constructor() {
    setTimeout(() => {
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
  transcript(text: string, final: boolean, speechFinal: boolean, confidence?: number) {
    this.fire("message", { data: JSON.stringify({ type: "transcript", text, final, speechFinal, ...(confidence !== undefined ? { confidence } : {}) }) });
  }
  send(data: string | ArrayBuffer) {
    if (typeof data === "string" && JSON.parse(data).type === "finalize") {
      this.finalizes += 1;
      this.onFinalize(this);
    }
  }
  close() {}
}

async function ears(finalTimeoutMs = 300) {
  const socket = new Socket();
  const transcriber = new LiveTranscriber({
    botId: "b-1",
    language: () => "en",
    threadId: () => "t-1",
    socket: () => socket as unknown as WebSocket,
    transcribe: async () => "uploaded",
    finalTimeoutMs,
  });
  expect(await transcriber.connect()).toBe(true);
  const speak = () => {
    transcriber.begin([]);
    transcriber.push(new Float32Array(VAD_FRAME).fill(0.05));
  };
  return { socket, transcriber, speak };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("LiveTranscriber finalize", () => {
  it("waits for speech_final: a final chunk after finalize is not the end of the sentence", async () => {
    const { socket, transcriber, speak } = await ears();
    socket.onFinalize = (s) => {
      setTimeout(() => s.transcript("give me a good prompt to", true, false), 2);
      setTimeout(() => s.transcript("write an email to Max", true, true), 6);
    };
    speak();
    const heard = await transcriber.finishHeard();
    expect(heard.text).toBe("give me a good prompt to write an email to Max");
  });

  it("keeps the late words of an utterance the timeout settled out of the next one", async () => {
    const { socket, transcriber, speak } = await ears(30);
    socket.onFinalize = (s) => {
      if (s.finalizes === 1) {
        s.transcript("the weather right now in", true, false);
        // its last chunk comes after the timeout
        setTimeout(() => s.transcript("Trois-Rivieres", true, true), 60);
      } else setTimeout(() => s.transcript("thanks", true, true), 2);
    };
    speak();
    expect((await transcriber.finishHeard()).text).toBe("the weather right now in");
    await wait(80);
    speak();
    expect((await transcriber.finishHeard()).text).toBe("thanks");
  });

  it("an utterance xAI already closed (speech_final) with no audio since needs no finalize", async () => {
    const { socket, transcriber, speak } = await ears();
    speak();
    socket.transcript("what time is it", true, true);
    expect((await transcriber.finishHeard()).text).toBe("what time is it");
    expect(socket.finalizes).toBe(0);
  });

  it("reports xAI's lowest confidence in the utterance", async () => {
    const { socket, transcriber, speak } = await ears();
    socket.onFinalize = (s) => {
      s.transcript("call", true, false, 0.9);
      s.transcript("Max", true, true, 0.3);
    };
    speak();
    expect(await transcriber.finishHeard()).toEqual({ text: "call Max", confidence: 0.3 });
  });
});
