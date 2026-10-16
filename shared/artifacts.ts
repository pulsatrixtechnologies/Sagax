// Artifacts (docs/superpowers/specs/2026-10-16-artifacts-design.md): an
// interactive widget a bot saved for later, with an optional data source the
// server re-runs on an interval, without a model turn. Shared by the server
// (store, tools, refresher) and the desktop client (Files tab, palette).
//
// Every setting here belongs to the bot: the person opens, pops out, pins as
// a favorite, refreshes now or deletes, and asks the bot for anything else.

export const ARTIFACT_LIMITS = {
  title: 120,
  /** The widget's own document, as the bot wrote it. */
  html: 200_000,
  /** The JSON a source answered with, kept for the next open. */
  data: 256_000,
  perBot: 50,
  tool: 200,
  command: 2_000,
  args: 8_000,
  /** Seconds between two runs of a source. */
  minInterval: 30,
  maxInterval: 86_400,
  /** Consecutive failures before the refresher pauses an artifact. */
  maxFailures: 3,
  /** A window smaller than this would hide its own title bar. */
  minWidth: 220,
  minHeight: 140,
  maxSide: 4_000,
} as const;

/** What the server re-runs for fresh data: one tool call with fixed
 * arguments, or one command in the bot's workspace. */
export type ArtifactSource =
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "command"; command: string };

export interface ArtifactBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** idle: never ran (or no source); ok: last run answered; error: last run
 * failed, will try again; paused: stopped after too many failures or by the
 * bot; blocked: the source needs a person's approval, so it never runs alone. */
export type ArtifactRefreshState = "idle" | "ok" | "error" | "paused" | "blocked";

export interface ArtifactRefresh {
  state: ArtifactRefreshState;
  failures: number;
  lastRunAt?: number;
  lastOkAt?: number;
  /** The last failure, one line, scrubbed of secrets. */
  error?: string;
}

export interface Artifact {
  id: string;
  botId: string;
  /** The conversation the bot saved it from, when there was one. */
  threadId?: string;
  /** On a shared server, the person whose conversation saved it: only they
   * (and an admin) see it, and its source runs in their name. */
  ownerPrincipalId?: string;
  title: string;
  html: string;
  source?: ArtifactSource;
  /** Seconds; only with a source. */
  intervalSeconds?: number;
  favorite: boolean;
  /** Shown in its own floating window instead of only in the Files tab. */
  popped: boolean;
  /** The bot's suggested window; each device remembers where the person
   * actually left it. */
  bounds?: ArtifactBounds;
  createdAt: number;
  updatedAt: number;
  /** Bumped on every change, so a client can tell two versions apart. */
  rev: number;
  refresh: ArtifactRefresh;
  /** The last good answer of the source, as JSON. */
  data?: { at: number; value: unknown };
}

/** What a list sends: everything but the widget's document and its data,
 * which the client asks for when it opens the artifact. */
export type ArtifactSummary = Omit<Artifact, "html" | "data"> & { dataAt?: number };

export function summarizeArtifact(artifact: Artifact): ArtifactSummary {
  const { html: _html, data, ...rest } = artifact;
  return data ? { ...rest, dataAt: data.at } : rest;
}

/** The live frame the server sends when a bot's artifacts change. */
export const ARTIFACTS_FRAME = "artifacts";
/** Ids only: a client fetches what changed with its own rights. */
export interface ArtifactsFrame {
  kind: typeof ARTIFACTS_FRAME;
  botId: string;
  /** The artifact that changed; absent when several did. */
  artifactId?: string;
  /** True when it was deleted. */
  deleted?: boolean;
}

/** Message types between the app and an artifact's sandboxed frame. */
export const ARTIFACT_DATA_MESSAGE = "sagax-artifact-data";

const ID = /^art_[A-Za-z0-9_-]{6,64}$/;
export function isArtifactId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseArtifactSource(value: unknown): Parsed<ArtifactSource> {
  if (!isRecord(value)) return { ok: false, error: "source: give {kind:\"tool\", tool, args} or {kind:\"command\", command}." };
  if (value.kind === "tool") {
    const tool = typeof value.tool === "string" ? value.tool.trim() : "";
    if (!tool || tool.length > ARTIFACT_LIMITS.tool || !/^[\w.:/-]+$/.test(tool)) return { ok: false, error: "source.tool: the exact name of one of your tools." };
    const args = value.args === undefined ? {} : value.args;
    if (!isRecord(args)) return { ok: false, error: "source.args: an object of the tool's arguments." };
    if (JSON.stringify(args).length > ARTIFACT_LIMITS.args) return { ok: false, error: `source.args: at most ${ARTIFACT_LIMITS.args} characters of JSON.` };
    return { ok: true, value: { kind: "tool", tool, args } };
  }
  if (value.kind === "command") {
    const command = typeof value.command === "string" ? value.command.trim() : "";
    if (!command || command.length > ARTIFACT_LIMITS.command) return { ok: false, error: `source.command: one shell command, at most ${ARTIFACT_LIMITS.command} characters.` };
    return { ok: true, value: { kind: "command", command } };
  }
  return { ok: false, error: "source.kind: tool or command." };
}

export function parseArtifactInterval(value: unknown): Parsed<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < ARTIFACT_LIMITS.minInterval || value > ARTIFACT_LIMITS.maxInterval) {
    return { ok: false, error: `interval_seconds: a whole number from ${ARTIFACT_LIMITS.minInterval} to ${ARTIFACT_LIMITS.maxInterval}.` };
  }
  return { ok: true, value };
}

export function parseArtifactBounds(value: unknown): Parsed<ArtifactBounds> {
  if (!isRecord(value)) return { ok: false, error: "bounds: {x, y, width, height} in pixels." };
  const read = (key: string, min: number) => {
    const raw = value[key];
    return typeof raw === "number" && Number.isFinite(raw) ? Math.round(Math.min(Math.max(raw, min), ARTIFACT_LIMITS.maxSide)) : null;
  };
  const x = read("x", 0);
  const y = read("y", 0);
  const width = read("width", ARTIFACT_LIMITS.minWidth);
  const height = read("height", ARTIFACT_LIMITS.minHeight);
  if (x === null || y === null || width === null || height === null) return { ok: false, error: "bounds: {x, y, width, height} in pixels." };
  return { ok: true, value: { x, y, width, height } };
}

/** The fields save_artifact and update_artifact take, checked. `null` on an
 * update clears a source, an interval or the bounds. */
export interface ArtifactFields {
  title?: string;
  html?: string;
  source?: ArtifactSource | null;
  intervalSeconds?: number | null;
  favorite?: boolean;
  popped?: boolean;
  bounds?: ArtifactBounds | null;
  /** update only: true pauses the refresher, false resumes it. */
  paused?: boolean;
}

export function parseArtifactFields(input: unknown, creating: boolean): Parsed<ArtifactFields> {
  if (!isRecord(input)) return { ok: false, error: "Send the artifact's fields as an object." };
  const out: ArtifactFields = {};
  if (input.title !== undefined || creating) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title || title.length > ARTIFACT_LIMITS.title) return { ok: false, error: `title: a short name, at most ${ARTIFACT_LIMITS.title} characters.` };
    out.title = title;
  }
  if (input.html !== undefined || creating) {
    const html = typeof input.html === "string" ? input.html : "";
    if (!html.trim()) return { ok: false, error: "html: the widget's HTML, CSS and JS." };
    if (html.length > ARTIFACT_LIMITS.html) return { ok: false, error: `html: at most ${ARTIFACT_LIMITS.html} characters.` };
    out.html = html;
  }
  if (input.source !== undefined) {
    if (input.source === null) out.source = null;
    else {
      const source = parseArtifactSource(input.source);
      if (!source.ok) return source;
      out.source = source.value;
    }
  }
  const interval = input.interval_seconds ?? input.intervalSeconds;
  if (interval !== undefined) {
    if (interval === null) out.intervalSeconds = null;
    else {
      const parsed = parseArtifactInterval(interval);
      if (!parsed.ok) return parsed;
      out.intervalSeconds = parsed.value;
    }
  }
  for (const key of ["favorite", "popped", "paused"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") return { ok: false, error: `${key}: true or false.` };
    if (key === "paused" && creating) continue;
    out[key] = input[key] as boolean;
  }
  if (input.bounds !== undefined) {
    if (input.bounds === null) out.bounds = null;
    else {
      const bounds = parseArtifactBounds(input.bounds);
      if (!bounds.ok) return bounds;
      out.bounds = bounds.value;
    }
  }
  return { ok: true, value: out };
}

/** Favorites first, then newest change first. */
export function sortArtifacts<T extends Pick<ArtifactSummary, "favorite" | "updatedAt" | "title">>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}
