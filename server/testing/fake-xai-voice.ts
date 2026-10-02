// A loopback fake of the xAI voice endpoints voice mode uses
// (server/tts/grok.ts): GET /v1/tts/voices, POST /v1/tts and POST /v1/stt.
// It records what each request carried (never answering with the key) so a
// check can prove the voice, speed and language the person picked reached
// xAI, and that the audio was a WAV turn. Point the server at it with
// SAGAX_XAI_TTS_API=<url>/v1.
import { createServer, type Server } from "node:http";

export interface FakeXaiRequest {
  method: string;
  path: string;
  authorization?: string;
  /** /v1/tts: the JSON body */
  json?: Record<string, unknown>;
  /** /v1/stt: the multipart fields (text) and the file's first bytes */
  fields?: Record<string, string>;
  fileHead?: string;
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

export async function startFakeXaiVoice(options: { transcript?: string } = {}): Promise<FakeXaiVoice> {
  const requests: FakeXaiRequest[] = [];
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake xAI did not get a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
