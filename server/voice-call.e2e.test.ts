// Voice mode's live call routes end to end over real sockets: the page's
// streaming speech to text (GET /voice/listen, a WebSocket through the same
// upgrade gate as the desktop viewer) and the streamed speech of one sentence
// (POST /voice/stream), against a loopback fake of xAI. The key stays on the
// server, and xAI is only ears and a voice: no chat, responses or realtime
// agent endpoint is ever called during a call.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createDesktopViewer } from "./routes/desktop-viewer.ts";
import { PASS, type RouteContext } from "./routes/table.ts";
import type { SessionRecord } from "./sessions.ts";
import { startFakeXaiVoice, XAI_VOICE_PATHS, type FakeXaiVoice } from "./testing/fake-xai-voice.ts";
import type { VoiceUsage } from "./voice-mode.ts";

const KEY = "xai-CALLfake8Hq2Zr5Lp7Wd3";
const ada: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: "s-ada", label: "web", scopes: ["client"], createdAt: 1, lastSeenAt: 1, principalId: "p-ada" } as SessionRecord,
};

let xai: FakeXaiVoice;
let server: Server;
let origin = "";
const usage: VoiceUsage[] = [];

beforeAll(async () => {
  xai = await startFakeXaiVoice({ transcripts: ["first turn", "second turn"], sttFinalizeMs: 30, ttsFirstChunkMs: 40, ttsSeconds: 0.3, sttConfidence: 0.92 });
  process.env.SAGAX_XAI_TTS_API = `${xai.url}/v1`;
  const grok = await import("./tts/grok.ts");
  const { createVoiceModeRoutes } = await import("./voice-mode.ts");
  const viewer = createDesktopViewer({
    target: () => undefined,
    live: () => true,
    acceptsUpgrade: (path) => /^\/api\/bots\/[\w-]+\/voice\/listen$/.test(path),
  });
  const route = createVoiceModeRoutes({
    organization: false,
    speaker: () => ({ principalId: "p-ada" }),
    target: (_auth, botId, threadId) => ({ botId, botName: "Cryptic", threadId: threadId ?? "t-1" }),
    serverKey: () => KEY,
    hasOwnKey: () => false,
    resolveOwnKey: async () => ({ ok: false, error: "no_key" }),
    xai: {
      listVoices: grok.listVoices,
      synthesize: grok.synthesize,
      transcribe: grok.transcribe,
      synthesizeStream: grok.synthesizeStream,
      openTranscription: (key, options, handlers) => grok.openTranscriptionStream(key, options, handlers),
    },
    upgrade: (req) => viewer.upgradeOf(req),
    utterances: (text) => (text.startsWith("```") ? [] : [text.replace(/\*\*/g, "")]),
    recordUsage: (entry) => { usage.push(entry); },
  });
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const ctx = { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: ada, json, readBody } as RouteContext;
    const answered = await route(ctx);
    if (answered === PASS && !res.headersSent) json(res, 404, { error: "not found" });
  };
  server = createServer((req, res) => void handle(req, res));
  viewer.attach(server, handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server?.closeAllConnections?.();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await xai?.close();
});

function open(path: string, headers: Record<string, string> = {}): Promise<{ ws: WebSocket; frames: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace("http", "ws")}${path}`, { headers: { origin, ...headers } });
    const frames: Array<Record<string, unknown>> = [];
    ws.on("message", (data) => frames.push(JSON.parse(String(data)) as Record<string, unknown>));
    ws.once("open", () => resolve({ ws, frames }));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

async function until<T>(what: string, check: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("voice mode live call (streaming)", () => {
  it("streams the person's audio to xAI and answers each finalized utterance, on one socket", async () => {
    const { ws, frames } = await open("/api/bots/b-cryptic/voice/listen?language=fr&threadId=t-1");
    await until("ready", () => frames.find((f) => f.type === "ready"));
    const pcm = Buffer.alloc(3200); // 100 ms of 16 kHz 16-bit audio
    ws.send(pcm);
    ws.send(pcm);
    const started = Date.now();
    ws.send(JSON.stringify({ type: "finalize" }));
    const first = await until("first transcript", () => frames.find((f) => f.type === "transcript" && f.text === "first turn"));
    // xAI's confidence reaches the page (noise fragments are dropped by it)
    expect(first).toMatchObject({ final: true, speechFinal: true, confidence: 0.92 });
    expect(Date.now() - started).toBeLessThan(1000);
    ws.send(pcm);
    ws.send(JSON.stringify({ type: "finalize" }));
    await until("second transcript", () => frames.find((f) => f.type === "transcript" && f.text === "second turn"));
    ws.close();
    const socket = await until("the xAI socket", () => xai.requests.find((r) => r.websocket && r.path === "/v1/stt"));
    expect(socket.authorization).toBe(`Bearer ${KEY}`);
    expect(socket.query).toMatchObject({ encoding: "pcm", sample_rate: "16000", interim_results: "true", language: "fr" });
    await until("audio forwarded", () => socket.audioBytes === 3 * 3200);
    expect(socket.finalizes).toBe(2);
    // booked as heard, never with a key
    await until("usage", () => usage.filter((u) => u.model === "grok-stt").length >= 2);
    expect(usage.filter((u) => u.model === "grok-stt").reduce((sum, u) => sum + u.input, 0)).toBe(3 * 3200);
    expect(JSON.stringify(frames)).not.toContain(KEY.slice(6, 14));
  });

  it("refuses a WebSocket from another origin (no CORS for WebSockets)", async () => {
    await expect(open("/api/bots/b-cryptic/voice/listen", { origin: "https://evil.example" })).rejects.toThrow(/403/);
  });

  it("refuses a plain GET without an upgrade", async () => {
    const res = await fetch(`${origin}/api/bots/b-cryptic/voice/listen`);
    expect(res.status).toBe(426);
  });

  it("streams one sentence's speech as raw PCM while xAI makes it", async () => {
    const started = Date.now();
    const res = await fetch(`${origin}/api/bots/b-cryptic/voice/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "**Bonjour** Ada.", voice: "ara", speed: 1.25, language: "fr" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/pcm");
    expect(res.headers.get("x-voice-sample-rate")).toBe("24000");
    const reader = res.body!.getReader();
    const first = await reader.read();
    const firstAt = Date.now() - started;
    expect(first.value!.byteLength).toBeGreaterThan(0);
    let total = first.value!.byteLength;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
    }
    // the first chunk arrives long before the whole sentence is done
    expect(firstAt).toBeLessThan(600);
    expect(total).toBe(Math.round(24_000 * 0.3) * 2);
    const tts = xai.requests.filter((r) => r.path === "/v1/tts").at(-1)!;
    expect(tts.json).toMatchObject({ text: "Bonjour Ada.", voice_id: "ara", speed: 1.25, language: "fr", output_format: { codec: "pcm", sample_rate: 24000 } });
    expect(tts.authorization).toBe(`Bearer ${KEY}`);
  });

  it("answers silence for a sentence with nothing speakable", async () => {
    const res = await fetch(`${origin}/api/bots/b-cryptic/voice/stream`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "```js\nx()\n```" }),
    });
    expect(res.status).toBe(204);
  });

  it("never asks xAI to answer: only speech to text and text to speech endpoints were called", () => {
    expect(xai.requests.length).toBeGreaterThan(0);
    const other = xai.requests.filter((r) => !XAI_VOICE_PATHS.has(r.path));
    expect(other).toEqual([]);
    expect(xai.requests.some((r) => /chat|responses|realtime|completions/.test(r.path))).toBe(false);
  });
});
