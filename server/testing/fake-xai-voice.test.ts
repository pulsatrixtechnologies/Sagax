import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { applySpeechControls, MAX_FAKE_OPEN_DELAY_MS, startFakeXaiVoice, type FakeSpeechControls, type FakeXaiTiming } from "./fake-xai-voice.ts";

const fresh = (): FakeSpeechControls => ({ refuse: false, openDelayMs: 0, dropAfter: 0, errorNext: false });

describe("fake xAI speech controls", () => {
  it("applies the known switches a test sends", () => {
    const speech = fresh();
    applySpeechControls(speech, { refuse: true, dropAfter: 1, openDelayMs: 250, errorNext: true });
    expect(speech).toEqual({ refuse: true, openDelayMs: 250, dropAfter: 1, errorNext: true });
  });

  it("bounds the delay and ignores unknown keys, wrong types and __proto__", () => {
    const speech = fresh();
    applySpeechControls(speech, JSON.parse('{"openDelayMs": 1e12, "refuse": "yes", "__proto__": {"polluted": true}, "extra": 1}'));
    expect(speech).toEqual({ refuse: false, openDelayMs: MAX_FAKE_OPEN_DELAY_MS, dropAfter: 0, errorNext: false });
    expect(Object.getPrototypeOf(speech)).toBe(Object.prototype);
    expect((speech as unknown as Record<string, unknown>).polluted).toBeUndefined();
    applySpeechControls(speech, { openDelayMs: -5 });
    expect(speech.openDelayMs).toBe(0);
    applySpeechControls(speech, null);
    applySpeechControls(speech, [1, 2]);
    expect(speech.openDelayMs).toBe(0);
  });
});

describe("fake xAI utterance timings", () => {
  it("stamps speech-to-text and text-to-speech with the bound utterance id", async () => {
    const xai = await startFakeXaiVoice({ sttFinalizeMs: 5, ttsFirstChunkMs: 5, ttsSeconds: 0.02, ttsChunkMs: 5 });
    const opened = (ws: WebSocket) => new Promise<void>((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const until = async (predicate: (rows: FakeXaiTiming[]) => boolean) => {
      const deadline = Date.now() + 2_000;
      let rows: FakeXaiTiming[] = [];
      while (Date.now() < deadline) {
        rows = await fetch(`${xai.url}/__timings`).then((response) => response.json() as Promise<FakeXaiTiming[]>);
        if (predicate(rows)) return rows;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`timings not observed: ${JSON.stringify(rows)}`);
    };
    const stt = new WebSocket(`${xai.url.replace(/^http/, "ws")}/v1/stt`);
    const tts = new WebSocket(`${xai.url.replace(/^http/, "ws")}/v1/tts`);
    try {
      await fetch(`${xai.url}/__utterance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utteranceId: "u-stt" }),
      });
      await opened(stt);
      stt.send(JSON.stringify({ type: "finalize" }));
      const sttRows = await until((rows) => rows.some((row) => row.path === "/v1/stt" && row.utteranceId === "u-stt"));
      expect(sttRows).toContainEqual(expect.objectContaining({ path: "/v1/stt", utteranceId: "u-stt" }));

      await fetch(`${xai.url}/__utterance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utteranceId: "u-tts" }),
      });
      await opened(tts);
      tts.send(JSON.stringify({ type: "text.delta", delta: "Hi." }));
      tts.send(JSON.stringify({ type: "text.done" }));
      const ttsRows = await until((rows) => rows.some((row) => row.path === "/v1/tts" && row.utteranceId === "u-tts"));
      expect(ttsRows).toContainEqual(expect.objectContaining({ path: "/v1/tts", utteranceId: "u-tts" }));

      const requests = await fetch(`${xai.url}/__requests`).then((response) => response.json() as Promise<{ path: string }[]>);
      expect(requests.every((request) => !request.path.startsWith("/__"))).toBe(true);
      expect(requests.map((request) => request.path)).toEqual(expect.arrayContaining(["/v1/stt", "/v1/tts"]));
    } finally {
      stt.close();
      tts.close();
      await xai.close();
    }
  });
});
