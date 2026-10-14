/** Inline video widgets in chat: structured payloads bots and Glitcho tools emit. */

export type VideoWidgetKind = "live" | "vod";

/**
 * Container of the stream. Optional and additive: emitters may declare it
 * (`format: "hls"`), else Sagax infers it from the source URL before the
 * media proxy rewrites it (the proxied `/api/media/proxy/<token>` path no
 * longer shows `.m3u8`, so players must not sniff `playbackUrl`).
 */
export type VideoWidgetFormat = "hls" | "mp4";

const HLS_MIME = /^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/(?:x-)?mpegurl)\b/i;
const MP4_MIME = /^video\/(?:mp4|quicktime|webm)\b/i;

/** Normalize a declared format, MIME type or file extension; undefined when unknown. */
export function normalizeVideoFormat(raw: unknown): VideoWidgetFormat | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "hls" || value === "m3u8" || HLS_MIME.test(value)) return "hls";
  if (value === "mp4" || value === "m4v" || value === "mov" || value === "webm" || MP4_MIME.test(value)) return "mp4";
  return undefined;
}

/** Format from a source URL's path extension (`.m3u8` = HLS, `.mp4` = progressive); undefined otherwise. */
export function videoFormatFromUrl(url: string): VideoWidgetFormat | undefined {
  let path: string;
  try {
    path = new URL(url, "http://local.invalid").pathname;
  } catch {
    return undefined;
  }
  if (/\.m3u8$/i.test(path)) return "hls";
  if (/\.(?:mp4|m4v|mov|webm)$/i.test(path)) return "mp4";
  return undefined;
}

export interface WireVideoWidget {
  kind: VideoWidgetKind;
  /** Client playback URL (often `/api/media/proxy/…`; never a secret). */
  playbackUrl: string;
  /** Stream container, decided server side from the original URL. Absent on older messages. */
  format?: VideoWidgetFormat;
  title?: string;
  streamer?: string;
  source?: string;
  posterUrl?: string;
  durationMs?: number;
  viewerCount?: number;
}

export interface SagaxVideoEmit {
  kind?: VideoWidgetKind;
  url: string;
  /** Optional: `"hls"` or `"mp4"`. Inferred from `url` when absent. */
  format?: VideoWidgetFormat;
  title?: string;
  streamer?: string;
  source?: string;
  poster?: string;
  posterUrl?: string;
  durationMs?: number;
  duration?: number;
  viewerCount?: number;
}

/**
 * Whether a wire widget is an HLS stream. Trusts the declared `format`; only
 * messages from before it existed fall back to sniffing `playbackUrl`.
 */
export function isHlsVideo(video: Pick<WireVideoWidget, "format" | "playbackUrl">): boolean {
  if (video.format) return video.format === "hls";
  return videoFormatFromUrl(video.playbackUrl) === "hls";
}

const URL_KEYS = ["hlsUrl", "hls_url", "playbackUrl", "playback_url", "streamUrl", "stream_url", "url", "m3u8", "mp4"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pickUrl(row: Record<string, unknown>): { url: string; key: (typeof URL_KEYS)[number] } | null {
  for (const key of URL_KEYS) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return { url: v.trim(), key };
  }
  return null;
}

function pickFormat(row: Record<string, unknown>, key: (typeof URL_KEYS)[number], url: string): VideoWidgetFormat | undefined {
  for (const field of ["format", "mimeType", "mime_type", "contentType", "content_type"]) {
    const declared = normalizeVideoFormat(row[field]);
    if (declared) return declared;
  }
  if (key === "hlsUrl" || key === "hls_url" || key === "m3u8") return "hls";
  if (key === "mp4") return "mp4";
  return videoFormatFromUrl(url);
}

function pickKind(row: Record<string, unknown>, liveHint?: boolean): VideoWidgetKind {
  const raw = row.kind ?? row.mode ?? row.type;
  if (raw === "live" || raw === "vod") return raw;
  if (liveHint || row.isLive === true || row.live === true) return "live";
  return "vod";
}

function pickTitle(row: Record<string, unknown>): string | undefined {
  for (const key of ["title", "name", "streamTitle"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickStreamer(row: Record<string, unknown>): string | undefined {
  for (const key of ["streamer", "channel", "login", "broadcaster", "userName", "user_name"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function durationMs(row: Record<string, unknown>): number | undefined {
  if (typeof row.durationMs === "number" && row.durationMs > 0) return Math.round(row.durationMs);
  if (typeof row.duration === "number" && row.duration > 0) {
    return row.duration > 24 * 3600 ? Math.round(row.duration) : Math.round(row.duration * 1000);
  }
  return undefined;
}

function viewerCount(row: Record<string, unknown>): number | undefined {
  for (const key of ["viewerCount", "viewer_count", "viewers", "viewCount"]) {
    const v = row[key];
    if (typeof v === "number" && v >= 0) return Math.floor(v);
  }
  return undefined;
}

function poster(row: Record<string, unknown>): string | undefined {
  for (const key of ["posterUrl", "poster_url", "poster", "thumbnail", "thumbnailUrl"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function rowToWidget(row: Record<string, unknown>, defaults?: { source?: string; live?: boolean }): SagaxVideoEmit | null {
  const picked = pickUrl(row);
  if (!picked) return null;
  const { url } = picked;
  const format = pickFormat(row, picked.key, url);
  return {
    kind: pickKind(row, defaults?.live),
    url,
    ...(format ? { format } : {}),
    title: pickTitle(row),
    streamer: pickStreamer(row),
    source: typeof row.source === "string" ? row.source : defaults?.source,
    posterUrl: poster(row),
    durationMs: durationMs(row),
    viewerCount: viewerCount(row),
  };
}

/** Explicit Sagax envelope in tool JSON: `{ sagaxVideos: [...] }` or one `sagaxVideo`. */
export function sagaxVideosFromJson(parsed: unknown): SagaxVideoEmit[] {
  const root = asRecord(parsed);
  if (!root) return [];
  const list = root.sagaxVideos ?? root.videos;
  if (Array.isArray(list)) {
    return list.map((entry) => rowToWidget(asRecord(entry) ?? {})).filter((v): v is SagaxVideoEmit => v !== null);
  }
  const one = root.sagaxVideo ?? root.video;
  const single = rowToWidget(asRecord(one) ?? root);
  return single ? [single] : [];
}

function glitchoToolStem(toolName: string): string | null {
  const lower = toolName.toLowerCase();
  const idx = lower.lastIndexOf("list_followed");
  if (idx >= 0) return "list_followed";
  if (lower.includes("list_recordings")) return "list_recordings";
  if (lower.includes("start_recording")) return "start_recording";
  return null;
}

/** Map Glitcho MCP tool output to video emits (live followed channels, recordings). */
export function glitchoVideosFromTool(toolName: string, output: string): SagaxVideoEmit[] {
  const stem = glitchoToolStem(toolName);
  if (!stem || !toolName.toLowerCase().includes("glitcho")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  const fromEnvelope = sagaxVideosFromJson(parsed);
  if (fromEnvelope.length) return fromEnvelope.map((v) => ({ ...v, source: v.source ?? "Glitcho" }));

  const root = asRecord(parsed);
  if (!root) return [];
  const items = Array.isArray(parsed)
    ? (parsed as unknown[])
    : (root.items ?? root.recordings ?? root.streams ?? root.channels ?? root.live ?? root.data);
  if (!Array.isArray(items)) return [];

  const live = stem === "list_followed";
  const out: SagaxVideoEmit[] = [];
  for (const entry of items) {
    const row = asRecord(entry);
    if (!row) continue;
    const emit = rowToWidget(row, { source: "Glitcho", live });
    if (emit) out.push(emit);
  }
  return out;
}

export function videosFromToolOutput(toolName: string, output: string | undefined): SagaxVideoEmit[] {
  if (!output?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return glitchoVideosFromTool(toolName, output);
  }
  const sagax = sagaxVideosFromJson(parsed);
  if (sagax.length) return sagax;
  return glitchoVideosFromTool(toolName, output);
}

const YT_HOST = /^(?:www\.)?(?:youtube\.com|youtu\.be|m\.youtube\.com)$/i;

/** Extract a YouTube video id from a URL, or null. */
export function youtubeVideoId(href: string): string | null {
  try {
    const url = new URL(href);
    if (!YT_HOST.test(url.hostname)) return null;
    if (url.hostname === "youtu.be") {
      const id = url.pathname.replace(/^\//, "").split("/")[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    const embed = url.pathname.match(/^\/embed\/([\w-]{11})$/);
    if (embed) return embed[1]!;
    const shorts = url.pathname.match(/^\/shorts\/([\w-]{11})$/);
    if (shorts) return shorts[1]!;
  } catch {
    return null;
  }
  return null;
}

/** Find unique YouTube video ids in bot markdown (plain URLs and markdown links). */
export function youtubeIdsInText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string | null) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const match of text.matchAll(/https?:\/\/[^\s<>)]+/gi)) add(youtubeVideoId(match[0]!));
  for (const match of text.matchAll(/\[[^\]]*]\((https?:\/\/[^)]+)\)/gi)) add(youtubeVideoId(match[1]!));
  return out;
}
