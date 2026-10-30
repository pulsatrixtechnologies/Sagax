// OpenAI and ElevenLabs as voices of voice mode, against fake servers on
// loopback: no real (paid) request is ever made.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { grokVoiceFailure } from "./grok.ts";
import { createElevenLabsVoice, elevenLabsLanguage, elevenLabsRefusal, elevenLabsSpeed } from "./elevenlabs-voice.ts";
import { createOpenAiVoice, openAiRefusal } from "./openai-voice.ts";
import { createFishVoice } from "./fish-voice.ts";
import { wavPcm24 } from "./installed-voice.ts";

const KEY = "sk-FAKEtest1Zx2Cv3Bn4Mm8Qq";

interface Seen { method?: string; url?: string; headers: IncomingMessage["headers"]; body: string }
const servers: Array<{ close(): void }> = [];

async function fake(handler: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void): Promise<{ api: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += String(chunk); });
    req.on("end", () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body };
      seen.push(entry);
      handler(req, res, entry);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { api: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, seen };
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function readAll(body: ReadableStream<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) out.push(...chunk);
  return out;
}

describe("OpenAI voice (server/tts/openai-voice.ts)", () => {
  it("streams raw PCM with the voice, model and speed asked, the key only in the header", async () => {
    const { api, seen } = await fake((_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write(Buffer.from([1, 2]));
      setTimeout(() => res.end(Buffer.from([3, 4])), 10);
    });
    const voice = createOpenAiVoice({ api, ttsModel: "gpt-4o-mini-tts" });
    const audio = await voice.synthesizeStream("Bonjour", "cedar", KEY, { speed: 1.25 });
    expect(audio.sampleRate).toBe(24_000);
    expect(await readAll(audio.body)).toEqual([1, 2, 3, 4]);
    expect(seen[0]!.url).toBe("/v1/audio/speech");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(seen[0]!.body)).toEqual({ model: "gpt-4o-mini-tts", input: "Bonjour", voice: "cedar", response_format: "pcm", speed: 1.25 });
  });

  it("uses Marin when no voice is picked, MP3 for a reply read aloud", async () => {
    const { api, seen } = await fake((_req, res) => { res.writeHead(200, { "content-type": "audio/mpeg" }); res.end(Buffer.from([9, 9])); });
    const audio = await createOpenAiVoice({ api }).synthesize("Hi", undefined, KEY);
    expect(audio).toEqual({ bytes: new Uint8Array([9, 9]), mime: "audio/mpeg" });
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ voice: "marin", response_format: "mp3" });
  });

  it("sorts refusals like xAI's, never with OpenAI's own words", async () => {
    const { api } = await fake((_req, res) => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "insufficient_quota", message: `quota for ${KEY}` } }));
    });
    const error = await createOpenAiVoice({ api }).synthesize("Hi", undefined, KEY).then(() => new Error("no refusal"), (caught: Error) => caught);
    expect(grokVoiceFailure(error.message)).toBe("quota");
    expect(error.message).not.toContain(KEY);
    expect(grokVoiceFailure(openAiRefusal(401))).toBe("key");
    expect(grokVoiceFailure(openAiRefusal(429))).toBe("busy");
    expect(grokVoiceFailure(openAiRefusal(400, JSON.stringify({ error: { param: "voice" } })))).toBe("voice");
    expect(grokVoiceFailure(openAiRefusal(503))).toBe("down");
  });

  it("says a closed port is OpenAI not reachable", async () => {
    const error = await createOpenAiVoice({ api: "http://127.0.0.1:9/v1" }).synthesize("Hi", undefined, KEY).then(() => new Error("no refusal"), (caught: Error) => caught);
    expect(grokVoiceFailure(error.message)).toBe("down");
  });

  it("checks a key on the TTS model, and lists its built-in voices without a request", async () => {
    const { api, seen } = await fake((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
    const voice = createOpenAiVoice({ api, ttsModel: "gpt-4o-mini-tts" });
    await voice.verify(KEY);
    expect(seen[0]!.url).toBe("/v1/models/gpt-4o-mini-tts");
    expect((await voice.listVoices(KEY)).slice(0, 2)).toEqual([{ id: "marin", label: "Marin" }, { id: "cedar", label: "Cedar" }]);
    expect(seen).toHaveLength(1);
  });
});

describe("ElevenLabs voice (server/tts/elevenlabs-voice.ts)", () => {
  const voices = { voices: [
    { voice_id: "premadeVoice001", name: "Rachel", category: "premade", labels: { accent: "american" } },
    { voice_id: "myClonedVoice01", name: "Moi", category: "cloned", labels: {} },
  ] };

  it("keeps an included token on its relay and sends an own key to its provider", async () => {
    const relay = await fake((_req, res) => { res.writeHead(200, { "content-type": "audio/mpeg" }); res.end(Buffer.from([1])); });
    const provider = await fake((_req, res) => { res.writeHead(200, { "content-type": "audio/mpeg" }); res.end(Buffer.from([2])); });
    const voice = createElevenLabsVoice({ apiForKey: (key) => key === "test-included-token" ? relay.api : provider.api });
    await voice.synthesize("Hi", "premadeVoice001", "test-included-token");
    await voice.synthesize("Hi", "premadeVoice001", KEY);
    expect(relay.seen.map((entry) => entry.headers["xi-api-key"])).toEqual(["test-included-token"]);
    expect(provider.seen.map((entry) => entry.headers["xi-api-key"])).toEqual([KEY]);
  });

  it("lists the person's voices, cloned ones first, and keeps them a while", async () => {
    const { api, seen } = await fake((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(voices)); });
    const voice = createElevenLabsVoice({ api });
    const list = await voice.listVoices(KEY);
    expect(list).toEqual([
      { id: "myClonedVoice01", label: "Moi", own: true },
      { id: "premadeVoice001", label: "Rachel", description: "american" },
    ]);
    await voice.listVoices(KEY);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers["xi-api-key"]).toBe(KEY);
  });

  it("streams PCM at 24 kHz with the language and a clamped speed, the first own voice by default", async () => {
    const { api, seen } = await fake((req, res) => {
      if (req.url === "/v1/voices") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(voices)); return; }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.from([5, 6]));
    });
    const audio = await createElevenLabsVoice({ api, model: "eleven_flash_v2_5" }).synthesizeStream("Salut", undefined, KEY, { speed: 1.5, language: "fr" });
    expect(await readAll(audio.body)).toEqual([5, 6]);
    const speak = seen.find((entry) => entry.method === "POST")!;
    expect(speak.url).toBe("/v1/text-to-speech/myClonedVoice01/stream?output_format=pcm_24000");
    expect(JSON.parse(speak.body)).toEqual({ text: "Salut", model_id: "eleven_flash_v2_5", language_code: "fr", voice_settings: { speed: 1.2 } });
  });

  it("sorts its refusals: quota hidden in a 401 is credits, a missing voice is the voice", () => {
    expect(grokVoiceFailure(elevenLabsRefusal(401, JSON.stringify({ detail: { status: "quota_exceeded" } })))).toBe("quota");
    expect(grokVoiceFailure(elevenLabsRefusal(401, JSON.stringify({ detail: { status: "invalid_api_key" } })))).toBe("key");
    expect(grokVoiceFailure(elevenLabsRefusal(400, JSON.stringify({ detail: { status: "voice_not_found" } })))).toBe("voice");
    expect(grokVoiceFailure(elevenLabsRefusal(429))).toBe("busy");
    expect(grokVoiceFailure(elevenLabsRefusal(500))).toBe("down");
  });

  it("maps speed and language to what ElevenLabs takes", () => {
    expect(elevenLabsSpeed(1)).toBeUndefined();
    expect(elevenLabsSpeed(0.5)).toBe(0.7);
    expect(elevenLabsLanguage("auto")).toBeUndefined();
    expect(elevenLabsLanguage("pt-BR")).toBe("pt");
  });
});

describe("Fish voice on the shared speech contract", () => {
  it("streams 24 kHz PCM and reads MP3 with the same own key, voice and model", async () => {
    const { api, seen } = await fake((_req, res) => { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(Buffer.from([4, 5])); });
    const voice = createFishVoice({ api: api.replace(/\/v1$/, ""), model: () => "s2.1-pro" });
    const clip = await voice.synthesizeStream!("Bonjour", "my-fish-voice", KEY, { speed: 1.2, language: "fr" });
    expect(clip.sampleRate).toBe(24_000);
    expect(await readAll(clip.body)).toEqual([4, 5]);
    expect(seen[0]!.url).toBe("/v1/tts");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ reference_id: "my-fish-voice", format: "pcm", sample_rate: 24_000, prosody: { speed: 1.2 }, language: "fr" });
    expect(seen[0]!.body).not.toContain(KEY);
    const mp3 = await voice.synthesize!("Hi", "my-fish-voice", KEY, { language: "auto" });
    expect(mp3.mime).toBe("audio/mpeg");
    expect(JSON.parse(seen[1]!.body)).toMatchObject({ format: "mp3", sample_rate: 44_100, mp3_bitrate: 64 });
    expect(JSON.parse(seen[1]!.body)).not.toHaveProperty("language");
  });

  it("does not expose a provider response containing a key", async () => {
    const { api } = await fake((_req, res) => { res.writeHead(402, { "content-type": "application/json" }); res.end(JSON.stringify({ error: KEY })); });
    const failure = await createFishVoice({ api: api.replace(/\/v1$/, "") }).synthesize!("Hi", "my-fish-voice", KEY, {}).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("credits");
    expect((failure as Error).message).not.toContain(KEY);
  });
});

describe("installed voice audio in live calls", () => {
  it("converts 48 kHz stereo WAV to the shared mono 24 kHz PCM", () => {
    const wav = Buffer.alloc(44 + 16);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(48_000, 24); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16, 40);
    [1000, 3000, 4000, 6000, -2000, -4000, -6000, -8000].forEach((sample, i) => wav.writeInt16LE(sample, 44 + i * 2));
    const pcm = Buffer.from(wavPcm24(wav));
    expect([pcm.readInt16LE(0), pcm.readInt16LE(2)]).toEqual([2000, -3000]);
    expect(() => wavPcm24(new Uint8Array([1, 2]))).toThrow("WAV");
  });
});
