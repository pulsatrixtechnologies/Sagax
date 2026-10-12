/** Inline video widgets in chat: structured payloads bots and Glitcho tools emit. */

export type VideoWidgetKind = "live" | "vod";

export interface WireVideoWidget {
  kind: VideoWidgetKind;
  /** Client playback URL (often `/api/media/proxy/…`; never a secret). */
  playbackUrl: string;
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
  title?: string;
  streamer?: string;
  source?: string;
  poster?: string;
  posterUrl?: string;
  durationMs?: number;
  duration?: number;
  viewerCount?: number;
}

const URL_KEYS = ["hlsUrl", "hls_url", "playbackUrl", "playback_url", "streamUrl", "stream_url", "url", "m3u8", "mp4"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pickUrl(row: Record<string, unknown>): string | null {
  for (const key of URL_KEYS) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
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
  const url = pickUrl(row);
  if (!url) return null;
  return {
    kind: pickKind(row, defaults?.live),
    url,
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
