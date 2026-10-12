import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import { request as httpRequest } from "node:https";
import { request as httpRequestHttp } from "node:http";
import { URL } from "node:url";

import type { SagaxVideoEmit, WireVideoWidget } from "../shared/video-widget.ts";

const TOKEN_TTL_MS = 4 * 60 * 60_000;
const MAX_BYTES = 512 * 1024 * 1024;

function b64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

function unb64url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

export interface MediaProxyBody {
  u: string;
  e: number;
  t?: string;
}

let proxyKey: Buffer | null = null;

export function initMediaProxy(dataDir: string): void {
  const path = join(dataDir, "media-proxy.key");
  if (!existsSync(path)) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path, randomBytes(32), { mode: 0o600 });
  }
  proxyKey = readFileSync(path);
}

function key(): Buffer {
  if (!proxyKey) throw new Error("media proxy not initialized");
  return proxyKey;
}

export function needsMediaProxy(url: string, source?: string): boolean {
  if (source?.toLowerCase() === "glitcho") return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return true;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return true;
    if (parsed.username || parsed.password) return true;
  } catch {
    return true;
  }
  return false;
}

export function mintMediaProxyToken(url: string, threadId?: string, now = Date.now()): string {
  const body: MediaProxyBody = { u: url, e: now + TOKEN_TTL_MS, ...(threadId ? { t: threadId } : {}) };
  const payload = b64url(JSON.stringify(body));
  const mac = createHmac("sha256", key()).update(payload).digest("base64url").slice(0, 32);
  return `${payload}.${mac}`;
}

export function verifyMediaProxyToken(token: string, now = Date.now()): MediaProxyBody | null {
  if (!token || token.length > 4096) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", key()).update(payload).digest("base64url").slice(0, 32);
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) return null;
  try {
    const body = JSON.parse(unb64url(payload)) as MediaProxyBody;
    if (typeof body.u !== "string" || typeof body.e !== "number" || body.e < now) return null;
    return body;
  } catch {
    return null;
  }
}

export function mediaProxyPath(token: string): string {
  return `/api/media/proxy/${token}`;
}

export function wireVideoFromEmit(
  emit: SagaxVideoEmit,
  threadId: string,
  now = Date.now(),
): WireVideoWidget {
  const proxied = needsMediaProxy(emit.url, emit.source);
  const playbackUrl = proxied ? mediaProxyPath(mintMediaProxyToken(emit.url, threadId, now)) : emit.url;
  const posterUrl = emit.posterUrl && needsMediaProxy(emit.posterUrl, emit.source)
    ? mediaProxyPath(mintMediaProxyToken(emit.posterUrl, threadId, now))
    : emit.posterUrl;
  return {
    kind: emit.kind ?? "vod",
    playbackUrl,
    title: emit.title,
    streamer: emit.streamer,
    source: emit.source,
    posterUrl,
    durationMs: emit.durationMs,
  };
}

export async function streamProxiedMedia(
  targetUrl: string,
  res: ServerResponse,
  rangeHeader?: string,
): Promise<void> {
  const url = new URL(targetUrl);
  const lib = url.protocol === "https:" ? httpRequest : httpRequestHttp;
  await new Promise<void>((resolve, reject) => {
    const req = lib(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        headers: rangeHeader ? { Range: rangeHeader } : undefined,
      },
      (upstream) => {
        const status = upstream.statusCode ?? 502;
        if (status >= 400) {
          res.writeHead(status, { "content-type": "text/plain" });
          res.end();
          upstream.resume();
          resolve();
          return;
        }
        let bytes = 0;
        const headers: Record<string, string> = {};
        const ct = upstream.headers["content-type"];
        if (typeof ct === "string") headers["content-type"] = ct;
        const cl = upstream.headers["content-length"];
        if (typeof cl === "string") headers["content-length"] = cl;
        const cr = upstream.headers["content-range"];
        if (typeof cr === "string") headers["content-range"] = cr;
        const ar = upstream.headers["accept-ranges"];
        if (typeof ar === "string") headers["accept-ranges"] = ar;
        res.writeHead(status, headers);
        upstream.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            upstream.destroy();
            if (!res.writableEnded) res.end();
            resolve();
            return;
          }
          res.write(chunk);
        });
        upstream.on("end", () => {
          if (!res.writableEnded) res.end();
          resolve();
        });
        upstream.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}
