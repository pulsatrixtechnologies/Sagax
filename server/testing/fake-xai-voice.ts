// A loopback fake of the xAI voice endpoints voice mode uses
// (server/tts/grok.ts): GET /v1/tts/voices, POST /v1/tts (MP3, or raw PCM
// streamed in chunks for a live call), POST /v1/stt and the streaming speech
// to text WebSocket (wss://.../v1/stt: transcript.created, then a final
// transcript after each {"type":"finalize"}). Every other path is recorded
// and refused, so a check can prove voice mode never asked xAI to answer
// (no chat, responses or realtime agent endpoint).
// It records what each request carried (never answering with the key) so a
// check can prove the voice, speed and language the person picked reached
// xAI, and that the audio was a WAV turn. Point the server at it with
// SAGAX_XAI_TTS_API=<url>/v1.
import { createServer, type Server } from "node:http";

import { WebSocketServer } from "ws";

export interface FakeXaiRequest {
  method: string;
  path: string;
  authorization?: string;
  /** /v1/tts: the JSON body */
  json?: Record<string, unknown>;
  /** /v1/stt: the multipart fields (text) and the file's first bytes */
  fields?: Record<string, string>;
  fileHead?: string;
  /** the streaming speech to text socket */
  websocket?: boolean;
  query?: Record<string, string>;
  audioBytes?: number;
  finalizes?: number;
}

/** Paths a voice call may use. Anything else (chat, responses, realtime)
 * would mean xAI was asked to answer instead of the bot. */
export const XAI_VOICE_PATHS = new Set(["/v1/tts", "/v1/tts/voices", "/v1/stt"]);

export interface FakeXaiOptions {
  transcript?: string;
  /** one transcript per finalized utterance of the streaming socket, in order (then `transcript`) */
  transcripts?: string[];
  /** delay before the first PCM chunk of a streamed sentence */
  ttsFirstChunkMs?: number;
  /** delay between finalize and the final transcript */
  sttFinalizeMs?: number;
  /** a confidence on each final transcript, like xAI may report */
  sttConfidence?: number;
  /** seconds of tone per streamed sentence */
  ttsSeconds?: number;
}

export interface FakeXaiVoice {
  url: string;
  requests: FakeXaiRequest[];
  close(): Promise<void>;
}

export const FAKE_XAI_VOICES = [
  { voice_id: "altair", name: "Altair" },
  { voice_id: "ara", name: "Ara" },
  { voice_id: "atlas", name: "Atlas" },
  { voice_id: "eve", name: "Eve" },
];

/** A few silent MPEG-1 Layer III frames (128 kbit/s, 44.1 kHz). */
function silentMp3(frames = 12): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00], 0);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

/** The text fields and the file of a multipart body (enough for a fake). */
function multipart(body: Buffer, contentType: string): { fields: Record<string, string>; fileHead?: string } {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const marker = `--${boundary?.[1] ?? boundary?.[2] ?? ""}`;
  const fields: Record<string, string> = {};
  let fileHead: string | undefined;
  const text = body.toString("latin1");
  for (const part of text.split(marker)) {
    const split = part.indexOf("\r\n\r\n");
    if (split < 0) continue;
    const head = part.slice(0, split);
    const value = part.slice(split + 4).replace(/\r\n$/, "");
    const name = /name="([^"]+)"/.exec(head)?.[1];
    if (!name) continue;
    if (/filename="/.test(head)) fileHead = value.slice(0, 4);
    else fields[name] = value;
  }
  return { fields, fileHead };
}

/** A 220 Hz tone at 24 kHz, 16-bit little-endian: what a streamed sentence "says". */
function tonePcm(seconds: number): Buffer {
  const rate = 24_000;
  const out = Buffer.alloc(Math.round(rate * seconds) * 2);
  for (let i = 0; i < out.length / 2; i++) out.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.3 * 0x7fff), i * 2);
  return out;
}

export async function startFakeXaiVoice(options: FakeXaiOptions = {}): Promise<FakeXaiVoice> {
  const requests: FakeXaiRequest[] = [];
  const transcripts = [...(options.transcripts ?? [])];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? "").split("?")[0]!;
      // for the check in another process (the Electron side); not recorded
      if (req.method === "GET" && path === "/__requests") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(requests));
        return;
      }
      const record: FakeXaiRequest = { method: req.method ?? "", path, authorization: req.headers.authorization };
      requests.push(record);
      if (req.method === "GET" && path === "/v1/tts/voices") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ voices: FAKE_XAI_VOICES }));
        return;
      }
      if (req.method === "POST" && path === "/v1/tts") {
        try {
          record.json = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
        } catch {
          record.json = {};
        }
        const format = record.json.output_format as { codec?: string } | undefined;
        if (format?.codec === "pcm") {
          // streamed as it is "made": a first chunk after a short delay, then the rest
          const audio = tonePcm(options.ttsSeconds ?? 0.6);
          res.writeHead(200, { "content-type": "application/octet-stream" });
          const chunk = 4800;
          let at = 0;
          const next = () => {
            if (res.destroyed) return;
            if (at >= audio.length) { res.end(); return; }
            res.write(audio.subarray(at, at + chunk));
            at += chunk;
            setTimeout(next, 20);
          };
          setTimeout(next, options.ttsFirstChunkMs ?? 120);
          return;
        }
        res.writeHead(200, { "content-type": "audio/mpeg" });
        res.end(silentMp3());
        return;
      }
      if (req.method === "POST" && path === "/v1/stt") {
        const parsed = multipart(body, String(req.headers["content-type"] ?? ""));
        record.fields = parsed.fields;
        record.fileHead = parsed.fileHead;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ text: options.transcript ?? "Hello from voice mode", language: parsed.fields.language ?? "en", duration: 1.2 }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://fake");
    const record: FakeXaiRequest = {
      method: "GET", path: url.pathname, authorization: req.headers.authorization, websocket: true,
      query: Object.fromEntries(url.searchParams), audioBytes: 0, finalizes: 0,
    };
    requests.push(record);
    if (url.pathname !== "/v1/stt") { socket.destroy(); return; }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: "transcript.created" }));
      ws.on("message", (data, binary) => {
        if (binary) { record.audioBytes = (record.audioBytes ?? 0) + (data as Buffer).length; return; }
        let message: { type?: string } = {};
        try { message = JSON.parse(String(data)) as { type?: string }; } catch { /* ignored */ }
        if (message.type === "finalize") {
          record.finalizes = (record.finalizes ?? 0) + 1;
          const text = transcripts.shift() ?? options.transcript ?? "Hello from voice mode";
          setTimeout(() => {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "transcript.partial", text, is_final: true, speech_final: true, start: 0, duration: 1, ...(options.sttConfidence !== undefined ? { confidence: options.sttConfidence } : {}) }));
          }, options.sttFinalizeMs ?? 80);
        } else if (message.type === "audio.done") {
          ws.send(JSON.stringify({ type: "transcript.done", text: "" }));
          ws.close();
        }
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake xAI did not get a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
