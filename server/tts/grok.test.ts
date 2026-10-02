import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.ts";

let server: Server;
let status = 200;
let contentType = "audio/mpeg";
let audio = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
let voices: unknown = { voices: [{ voice_id: "ara", name: "Ara", description: "Warm" }] };
const seen: Array<{ url: string; authorization?: string; body: string }> = [];
const config: AppConfig = { xai: { key: "fixture-xai-key" }, tts: { provider: "xai", voice: "ara" } };
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
  it("uses only the existing xAI key and never exposes it in status", async () => {
    const { describeVoice, providerConfigured, voiceReady, speak, listVoices } = await voice();
    const missing: AppConfig = { tts: { provider: "xai", key: "eleven-key", fishKey: "fish-key", voice: "ara" } };
    expect(providerConfigured(missing)).toBe(false);
    expect(voiceReady(missing)).toBe(false);
    expect(() => speak(missing, "hi")).toThrow("Add an xAI key");
    expect(await listVoices(missing)).toEqual([]);
    expect(seen).toHaveLength(0);
    expect(describeVoice(config)).toEqual({ configured: true, ready: true, provider: "xai", voice: "ara", baseUrl: "", model: "" });
    const noVoice: AppConfig = { xai: config.xai, tts: { provider: "xai" } };
    expect(voiceReady(noVoice)).toBe(false);
    expect(voiceReady(noVoice, "eve")).toBe(true);
    expect(() => speak(noVoice, "hi")).toThrow("Pick a voice");
  });

  it("loads the provider's current voice catalogue", async () => {
    const { listVoices } = await voice();
    expect(await listVoices(config)).toEqual([{ id: "ara", label: "Ara", description: "Warm" }]);
    expect(seen[0]).toMatchObject({ url: "/v1/tts/voices", authorization: "Bearer fixture-xai-key" });
    voices = { voices: [{ name: "Missing ID" }] };
    await expect(listVoices(config)).rejects.toThrow("invalid voice list");
  });

  it("preserves Polish text, requests MP3 with language detection and honors the bot voice", async () => {
    const { speak } = await voice();
    const result = await speak(config, "Cześć, sprawdzamy polską mowę.", "eve");
    expect(result.mime).toBe("audio/mpeg");
    expect(Buffer.from(result.bytes)).toEqual(audio);
    expect(seen[0]).toMatchObject({ url: "/v1/tts", authorization: "Bearer fixture-xai-key" });
    expect(JSON.parse(seen[0].body)).toEqual({ text: "Cześć, sprawdzamy polską mowę.", voice_id: "eve", language: "auto", output_format: { codec: "mp3" } });
  });

  it.each([401, 402, 403, 404, 429, 500])("sanitizes HTTP %i errors", async (code) => {
    status = code;
    const { speak, listVoices } = await voice();
    for (const operation of [() => speak(config, "hi"), () => listVoices(config)]) {
      const promise = operation();
      await expect(promise).rejects.toThrow(/xAI|Grok/);
      await expect(promise).rejects.not.toThrow(/fixture-xai-key|private text/);
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
});
