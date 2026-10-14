import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Agent as HttpAgent, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { URL } from "node:url";

import type { SagaxVideoEmit, WireVideoWidget } from "../shared/video-widget.ts";
import { normalizeVideoFormat, videoFormatFromUrl } from "../shared/video-widget.ts";
import {
  checkMediaDestination,
  isNonPublicLiteralHost,
  MediaProxyBlockedError,
  mediaProxyPolicyFromEnv,
  mediaUrlMayBeProxied,
  type MediaProxyPolicy,
  type MediaProxyResolver,
} from "./media-proxy-guard.ts";

const TOKEN_TTL_MS = 4 * 60 * 60_000;
const MAX_BYTES = 512 * 1024 * 1024;
/** HLS playlists are text; a real one is a few KiB, a long VOD a few hundred. */
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
export const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";

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
    if (host.endsWith(".local") || isNonPublicLiteralHost(host)) return true;
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
  const format = emit.format ?? videoFormatFromUrl(emit.url);
  return {
    kind: emit.kind ?? "vod",
    playbackUrl,
    ...(format ? { format } : {}),
    title: emit.title,
    streamer: emit.streamer,
    source: emit.source,
    posterUrl,
    durationMs: emit.durationMs,
  };
}

function isPlaylistContentType(contentType: string | undefined): boolean {
  return normalizeVideoFormat(contentType) === "hls";
}

/**
 * Rewrite the URIs of an HLS playlist (media or multivariant) so a player
 * that loaded it from `/api/media/proxy/<token>` can still reach segments,
 * keys, init maps and variant playlists:
 * - relative URIs resolve against the upstream playlist URL and go back
 *   through the proxy with their own signed token (same origin only, which
 *   is the origin the server already chose to proxy);
 * - absolute URIs on that same origin are proxied only when the browser
 *   could not reach them (private host, credentials);
 * - absolute URIs on any other origin are left untouched: the proxy never
 *   follows a playlist to a host it was not asked for;
 * - a URI whose host is a non-public IP literal or `localhost` is never
 *   turned into a proxy path unless SAGAX_MEDIA_PROXY_ALLOW_HOSTS allows it
 *   (a host name is checked after DNS resolution when the proxy fetches it).
 */
export function rewriteHlsPlaylist(
  text: string,
  playlistUrl: string,
  mint: (url: string) => string,
  policy: MediaProxyPolicy = mediaProxyPolicyFromEnv(),
): string {
  let base: URL;
  try {
    base = new URL(playlistUrl);
  } catch {
    return text;
  }
  const rewrite = (raw: string): string => {
    const value = raw.trim();
    if (!value) return raw;
    let resolved: URL;
    try {
      resolved = new URL(value, base);
    } catch {
      return raw;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return raw;
    if (resolved.origin !== base.origin) return raw;
    if (!mediaUrlMayBeProxied(resolved, policy)) return raw;
    const relative = !/^[a-z][a-z\d+.-]*:/i.test(value);
    if (!relative && !needsMediaProxy(resolved.href)) return raw;
    return mint(resolved.href);
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith("#")) return line.replace(/URI="([^"]*)"/g, (_m, uri: string) => `URI="${rewrite(uri)}"`);
      return rewrite(line);
    })
    .join("\n");
}

export interface StreamProxiedMediaOptions {
  /** Thread the top-level token was minted for; nested HLS tokens inherit it. */
  threadId?: string;
  now?: number;
  /** Destinations allowed besides public ones (default: SAGAX_MEDIA_PROXY_ALLOW_HOSTS). */
  policy?: MediaProxyPolicy;
  /** DNS resolver of the destination guard (tests pass a fake one). */
  resolver?: MediaProxyResolver;
}

/** Redirects the proxy follows itself, each hop checked like the first URL. */
const MAX_REDIRECTS = 5;

// Sockets of the proxy live in their own pool: a kept-alive socket reused
// here was always opened by the proxy toward an address it had checked.
const proxyHttpAgent = new HttpAgent({ keepAlive: true });
const proxyHttpsAgent = new HttpsAgent({ keepAlive: true });

/**
 * One GET to a destination the guard accepted, connected to the address the
 * guard checked: the `lookup` hook hands that address to the socket, so no
 * second DNS answer (a rebinding resolver) can redirect the connection.
 */
async function requestCheckedUpstream(
  target: URL,
  headers: Record<string, string> | undefined,
  options: StreamProxiedMediaOptions,
): Promise<IncomingMessage> {
  const pinned = await checkMediaDestination(target, options.policy ?? mediaProxyPolicyFromEnv(), options.resolver);
  const https = target.protocol === "https:";
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
  return await new Promise<IncomingMessage>((resolve, reject) => {
    const req = (https ? httpsRequest : httpRequest)(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port || (https ? 443 : 80),
        path: target.pathname + target.search,
        method: "GET",
        headers,
        agent: https ? proxyHttpsAgent : proxyHttpAgent,
        lookup: pinnedLookup,
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

export async function streamProxiedMedia(
  targetUrl: string,
  res: ServerResponse,
  rangeHeader?: string,
  options: StreamProxiedMediaOptions = {},
): Promise<void> {
  const playlistByPath = videoFormatFromUrl(targetUrl) === "hls";
  // A playlist is rewritten whole: never ask the upstream for a byte range of it.
  const forwardRange = rangeHeader && !playlistByPath ? rangeHeader : undefined;
  const headers = forwardRange ? { Range: forwardRange } : undefined;
  let current = new URL(targetUrl);
  let upstream = await requestCheckedUpstream(current, headers, options);
  for (let hop = 0; ; hop += 1) {
    const status = upstream.statusCode ?? 502;
    const location = upstream.headers.location;
    if (status < 300 || status >= 400 || status === 304 || typeof location !== "string") break;
    upstream.resume();
    if (hop >= MAX_REDIRECTS) throw new MediaProxyBlockedError("too-many-redirects", current.hostname);
    current = new URL(location, current);
    upstream = await requestCheckedUpstream(current, headers, options);
  }
  const finalUrl = current.href;
  const response = upstream;
  await new Promise<void>((resolve, reject) => {
    const status = response.statusCode ?? 502;
    if (status >= 300) {
      res.writeHead(status >= 400 ? status : 502, { "content-type": "text/plain" });
      res.end();
      response.resume();
      resolve();
      return;
    }
    const ct = response.headers["content-type"];
    const contentType = typeof ct === "string" ? ct : undefined;
    if (status === 200 && (playlistByPath || isPlaylistContentType(contentType))) {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      response.on("data", (chunk: Buffer) => {
        if (aborted) return;
        size += chunk.length;
        if (size > MAX_PLAYLIST_BYTES) {
          aborted = true;
          response.destroy();
          res.writeHead(502, { "content-type": "text/plain" });
          res.end();
          resolve();
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (aborted) return;
        const now = options.now ?? Date.now();
        // Relative URIs resolve against the URL that answered (after redirects).
        const body = Buffer.from(
          rewriteHlsPlaylist(
            Buffer.concat(chunks).toString("utf8"),
            finalUrl,
            (u) => mediaProxyPath(mintMediaProxyToken(u, options.threadId, now)),
            options.policy,
          ),
          "utf8",
        );
        res.writeHead(200, {
          "content-type": HLS_CONTENT_TYPE,
          "content-length": String(body.length),
          "cache-control": "no-store",
        });
        res.end(body);
        resolve();
      });
      response.on("error", (error) => {
        if (aborted) return;
        reject(error);
      });
      return;
    }
    let bytes = 0;
    const out: Record<string, string> = {};
    if (contentType) out["content-type"] = contentType;
    const cl = response.headers["content-length"];
    if (typeof cl === "string") out["content-length"] = cl;
    const cr = response.headers["content-range"];
    if (typeof cr === "string") out["content-range"] = cr;
    const ar = response.headers["accept-ranges"];
    if (typeof ar === "string") out["accept-ranges"] = ar;
    res.writeHead(status, out);
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) {
        response.destroy();
        if (!res.writableEnded) res.end();
        resolve();
        return;
      }
      res.write(chunk);
    });
    response.on("end", () => {
      if (!res.writableEnded) res.end();
      resolve();
    });
    response.on("error", reject);
  });
}
