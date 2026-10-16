import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";

let server: Server;
let status = 200;
let contentType = "audio/mpeg";
let audio = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
let voices: unknown = { voices: [{ voice_id: "ara", name: "Ara", description: "Warm" }] };
const seen: Array<{ url: string; authorization?: string; body: string }> = [];
// Since 2026-10-14 Grok voice runs on the xAI key, the one Grok bots use.
const config: AppConfig = { xai: { key: "fixture-voice-key" }, tts: { provider: "xai", voice: "ara" } };
const voice = () => import("./index.ts");

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push({ url: req.url ?? "", authorization: req.headers.authorization, body });
      if (status !== 200) {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "fixture-xai-key private text" }));
      } else if (req.url === "/v1/stt") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ text: "bonjour", language: "fr", duration: 1 }));
      } else if (req.url === "/v1/tts/voices") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(voices));
      } else {
        res.writeHead(200, { "content-type": contentType });
        res.end(audio);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP fixture");
  vi.stubEnv("SAGAX_XAI_TTS_API", `http://127.0.0.1:${address.port}/v1`);
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});
beforeEach(() => {
  status = 200;
  contentType = "audio/mpeg";
  audio = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  voices = { voices: [{ voice_id: "ara", name: "Ara", description: "Warm" }] };
  seen.length = 0;
});

describe("Grok voice", () => {
  it("uses the xAI key and needs one", async () => {
    const { describeVoice, providerConfigured, voiceReady, speak, listVoices } = await voice();
    const missing: AppConfig = { tts: { provider: "xai", key: "eleven-key", fishKey: "fish-key", voice: "ara" } };
    expect(providerConfigured(missing)).toBe(false);
    expect(voiceReady(missing)).toBe(false);
    expect(() => speak(missing, "hi")).toThrow("Add an xAI key");
    expect(await listVoices(missing)).toEqual([]);
    expect(seen).toHaveLength(0);
    expect(describeVoice(config)).toEqual({ configured: true, ready: true, provider: "xai", voice: "ara", baseUrl: "", model: "", keys: { elevenlabs: false, fish: false } });
    expect(JSON.stringify(describeVoice(config))).not.toContain("fixture-voice-key");
    const noVoice: AppConfig = { xai: config.xai, tts: { provider: "xai" } };
    expect(voiceReady(noVoice)).toBe(false);
    expect(voiceReady(noVoice, "eve")).toBe(true);
    expect(() => speak(noVoice, "hi")).toThrow("Pick a voice");
  });

  it("loads the provider's current voice catalogue", async () => {
    const { listVoices } = await voice();
    expect(await listVoices(config)).toEqual([{ id: "ara", label: "Ara", description: "Warm" }]);
    expect(seen[0]).toMatchObject({ url: "/v1/tts/voices", authorization: "Bearer fixture-voice-key" });
    voices = { voices: [{ name: "Missing ID" }] };
    await expect(listVoices(config)).rejects.toThrow("invalid voice list");
  });

  it("preserves Polish text, requests MP3 with language detection and honors the bot voice", async () => {
    const { speak } = await voice();
    const result = await speak(config, "Cześć, sprawdzamy polską mowę.", "eve");
    expect(result.mime).toBe("audio/mpeg");
    expect(Buffer.from(result.bytes)).toEqual(audio);
    expect(seen[0]).toMatchObject({ url: "/v1/tts", authorization: "Bearer fixture-voice-key" });
    expect(JSON.parse(seen[0].body)).toEqual({ text: "Cześć, sprawdzamy polską mowę.", voice_id: "eve", language: "auto", output_format: { codec: "mp3" } });
  });

  it.each([401, 402, 403, 404, 429, 500])("sanitizes HTTP %i errors", async (code) => {
    status = code;
    const { speak, listVoices } = await voice();
    for (const operation of [() => speak(config, "hi"), () => listVoices(config)]) {
      const promise = operation();
      await expect(promise).rejects.toThrow(/xAI|Grok/);
      await expect(promise).rejects.not.toThrow(/fixture-voice-key|fixture-bot-key|private text/);
    }
  });

  it("rejects JSON masquerading as successful audio and empty audio", async () => {
    const { speak } = await voice();
    contentType = "application/json";
    await expect(speak(config, "hi")).rejects.toThrow("unexpected audio format");
    contentType = "audio/mpeg";
    audio = Buffer.alloc(0);
    await expect(speak(config, "hi")).rejects.toThrow("empty audio");
  });

  it("accepts MP3 content types with parameters", async () => {
    contentType = "audio/mp3; charset=binary";
    expect((await (await voice()).speak(config, "hi")).mime).toBe("audio/mpeg");
  });

  it("voice mode: sends the picked speed and language, and no voice for Not set", async () => {
    const grok = await import("./grok.ts");
    await grok.synthesize("Salut", "ara", "fixture-xai-key", { speed: 1.25, language: "fr" });
    await grok.synthesize("Hi", undefined, "fixture-xai-key", { speed: 1 });
    expect(JSON.parse(seen[0]!.body)).toEqual({ text: "Salut", voice_id: "ara", language: "fr", speed: 1.25, output_format: { codec: "mp3" } });
    expect(JSON.parse(seen[1]!.body)).toEqual({ text: "Hi", language: "auto", output_format: { codec: "mp3" } });
  });

  it("voice mode: transcribes one recorded turn through /v1/stt with the language hint", async () => {
    const grok = await import("./grok.ts");
    const heard = await grok.transcribe(new Uint8Array([82, 73, 70, 70]), "audio/wav", "fixture-xai-key", "fr");
    expect(heard).toEqual({ text: "bonjour", language: "fr" });
    expect(seen[0]?.url).toBe("/v1/stt");
    expect(seen[0]?.authorization).toBe("Bearer fixture-xai-key");
    expect(seen[0]?.body).toContain('name="language"');
    expect(seen[0]?.body).toContain('filename="turn.wav"');
  });

  it("voice mode: sends keyterms before the file, which xAI needs last", async () => {
    const grok = await import("./grok.ts");
    await grok.transcribe(new Uint8Array([82, 73, 70, 70]), "audio/wav", "fixture-xai-key", "fr", ["Cryptic", "CrowdStrike"]);
    const body = seen[0]?.body ?? "";
    expect(body.match(/name="keyterm"/g)).toHaveLength(2);
    expect(body).toContain("CrowdStrike");
    const file = body.indexOf('name="file"');
    expect(file).toBeGreaterThan(body.lastIndexOf('name="keyterm"'));
    expect(file).toBeGreaterThan(body.indexOf('name="language"'));
  });

  it("voice mode: the streaming socket asks for each keyterm", async () => {
    const grok = await import("./grok.ts");
    const urls: string[] = [];
    class FakeSocket extends EventTarget {
      readyState = 0;
      binaryType = "";
      constructor(url: string) { super(); urls.push(url); }
      send() {}
      close() {}
    }
    const stream = grok.openTranscriptionStream("fixture-xai-key", { language: "fr", keyterms: ["Cryptic", "Marie Tremblay"] }, {
      onTranscript() {}, onError() {}, onClose() {},
    }, FakeSocket as unknown as import("./grok.ts").HeaderWebSocket);
    stream.close();
    const query = new URL(urls[0]!).searchParams;
    expect(query.getAll("keyterm")).toEqual(["Cryptic", "Marie Tremblay"]);
    expect(query.get("language")).toBe("fr");
  });

  it("voice mode: the socket keeps fillers, asks for formatting with a language, and a smart turn that never ends the turn itself", async () => {
    const grok = await import("./grok.ts");
    const urls: string[] = [];
    class FakeSocket extends EventTarget {
      readyState = 0;
      binaryType = "";
      constructor(url: string) { super(); urls.push(url); }
      send() {}
      close() {}
    }
    const handlers = { onTranscript() {}, onError() {}, onClose() {} };
    grok.openTranscriptionStream("fixture-xai-key", { language: "fr", format: true }, handlers, FakeSocket as unknown as import("./grok.ts").HeaderWebSocket).close();
    grok.openTranscriptionStream("fixture-xai-key", { format: true }, handlers, FakeSocket as unknown as import("./grok.ts").HeaderWebSocket).close();
    const fr = new URL(urls[0]!).searchParams;
    expect(fr.get("filler_words")).toBe("true");
    expect(fr.get("format")).toBe("true");
    expect(Number(fr.get("smart_turn"))).toBeGreaterThanOrEqual(0.9);
    expect(Number(fr.get("smart_turn_timeout"))).toBeGreaterThanOrEqual(5000);
    const auto = new URL(urls[1]!).searchParams;
    expect(auto.get("filler_words")).toBe("true");
    // format needs a language: pure auto never asks for it
    expect(auto.get("format")).toBeNull();
    expect(auto.get("language")).toBeNull();
  });

  it("voice mode: passes xAI's end of turn confidence through", async () => {
    const grok = await import("./grok.ts");
    const sockets: EventTarget[] = [];
    class FakeSocket extends EventTarget {
      readyState = 1;
      binaryType = "";
      constructor() { super(); sockets.push(this); }
      send() {}
      close() {}
    }
    const events: import("./grok.ts").TranscriptEvent[] = [];
    const stream = grok.openTranscriptionStream("fixture-xai-key", {}, {
      onTranscript(event) { events.push(event); }, onError() {}, onClose() {},
    }, FakeSocket as unknown as import("./grok.ts").HeaderWebSocket);
    const message = (data: unknown) => sockets[0]!.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(data) }));
    message({ type: "transcript.partial", text: "peux-tu regarder le billet", is_final: false, end_of_turn_confidence: 0.12 });
    message({ type: "transcript.partial", text: "de CONTOSO", is_final: true, speech_final: false });
    message({ type: "transcript.partial", text: "x", end_of_turn_confidence: 7 });
    stream.close();
    expect(events[0]).toMatchObject({ text: "peux-tu regarder le billet", endOfTurnConfidence: 0.12 });
    expect(events[1]).not.toHaveProperty("endOfTurnConfidence");
    expect(events[2]!.endOfTurnConfidence).toBe(1);
  });

  it("voice mode: the recorded turn keeps fillers and asks for formatting when told, file still last", async () => {
    const grok = await import("./grok.ts");
    await grok.transcribe(new Uint8Array([82, 73, 70, 70]), "audio/wav", "fixture-xai-key", "fr", ["CONTOSO"], { format: true });
    await grok.transcribe(new Uint8Array([82, 73, 70, 70]), "audio/wav", "fixture-xai-key", undefined, [], { format: true });
    const body = seen[0]?.body ?? "";
    expect(body).toMatch(/name="filler_words"\r\n\r\ntrue/);
    expect(body).toMatch(/name="format"\r\n\r\ntrue/);
    expect(body.indexOf('name="file"')).toBeGreaterThan(body.indexOf('name="format"'));
    expect(body.indexOf('name="file"')).toBeGreaterThan(body.indexOf('name="filler_words"'));
    const auto = seen[1]?.body ?? "";
    expect(auto).toContain('name="filler_words"');
    expect(auto).not.toContain('name="format"');
  });
});
