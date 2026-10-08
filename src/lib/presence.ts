// Who of the organization is online, away or offline, as this page shows it
// (shared/presence.ts holds the thresholds; server/routes/presence.ts the
// routes). On a page signed in to an organization server this module:
//   1. reads GET /api/org/presence once, then again every few minutes and
//      whenever the page comes back into view;
//   2. applies the `presence.changed` frames of the event stream;
//   3. sends a heartbeat every minute: how long the person has not used the
//      page (or, in the desktop app, the computer) and whether the computer
//      is idle or locked. Coming back after an idle spell sends one at once.
// Anywhere else the server answers 404 and nothing is shown.
import { useSyncExternalStore } from "react";

import {
  PRESENCE_AWAY_AFTER_MS,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_VISIBLE_PREFERENCE,
  isPresenceState,
  presenceHidden,
  type PresenceClientKind,
  type PresenceState,
  type SystemIdleState,
} from "../../shared/presence";
import { t } from "@/lib/i18n";

export interface PresenceEntry {
  state: PresenceState;
  lastSeenAt: number | null;
  /** Your own row only: the others see you offline. */
  hidden?: boolean;
}

interface PresenceRow extends PresenceEntry {
  principalId: string;
}

export const PRESENCE_PATH = "/api/org/presence";
export const PRESENCE_HEARTBEAT_PATH = "/api/presence/heartbeat";
/** The list is read again this often, in case a frame was missed. */
export const PRESENCE_REFRESH_MS = 5 * 60_000;
/** Back from idle: at most one early heartbeat this often. */
const EARLY_BEAT_MS = 10_000;

let enabled = false;
let selfId: string | null = null;
let entries = new Map<string, PresenceEntry>();
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const key = (id: string) => id.trim().toLowerCase();

function cleanRow(value: unknown): PresenceRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.principalId !== "string" || !isPresenceState(row.state)) return null;
  const lastSeenAt = typeof row.lastSeenAt === "number" && Number.isFinite(row.lastSeenAt) ? row.lastSeenAt : null;
  return { principalId: row.principalId, state: row.state, lastSeenAt, ...(row.hidden === true ? { hidden: true } : {}) };
}

/** Replace everything with the server's list (GET /api/org/presence). */
export function applyPresenceList(people: unknown): void {
  if (!Array.isArray(people)) return;
  const next = new Map<string, PresenceEntry>();
  for (const value of people) {
    const row = cleanRow(value);
    if (row) next.set(key(row.principalId), { state: row.state, lastSeenAt: row.lastSeenAt, ...(row.hidden ? { hidden: true } : {}) });
  }
  enabled = true;
  entries = next;
  notify();
}

/** One `presence.changed` frame. Your own row comes in its own frame (with
 * `audience`); the public one about you is skipped so a hidden person still
 * sees their real state. */
export function applyPresenceFrame(frame: { audience?: unknown; people?: unknown }): void {
  if (!enabled || !Array.isArray(frame.people)) return;
  const own = typeof frame.audience === "string";
  if (own) selfId = key(frame.audience as string);
  let changed = false;
  const next = new Map(entries);
  for (const value of frame.people) {
    const row = cleanRow(value);
    if (!row) continue;
    const id = key(row.principalId);
    if (!own && selfId && id === selfId) continue;
    next.set(id, { state: row.state, lastSeenAt: row.lastSeenAt, ...(row.hidden ? { hidden: true } : {}) });
    changed = true;
  }
  if (!changed) return;
  entries = next;
  notify();
}

/** Tests and sign-out: forget everything. */
export function resetPresence(): void {
  enabled = false;
  selfId = null;
  entries = new Map();
  notify();
}

export function presenceEnabled(): boolean {
  return enabled;
}

export function presenceOf(principalId: string | null | undefined): PresenceEntry | null {
  if (!enabled || !principalId) return null;
  // not in the list: not a person of the directory (a team, a service account)
  return entries.get(key(principalId)) ?? null;
}

/** A person's presence, live; null where there is none (a solo server,
 * a page not signed in, before the first answer). */
export function usePresence(principalId: string | null | undefined): PresenceEntry | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return presenceOf(principalId);
}

/** "2 h ago", for "Offline, last seen 2 h ago". */
export function lastSeenAgo(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return t("presence.seen.justNow");
  if (minutes < 60) return t("presence.seen.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("presence.seen.hours", { count: hours });
  return t("presence.seen.days", { count: Math.floor(hours / 24) });
}

/** The words for the dot: its accessible name and its tooltip. */
export function presenceLabel(entry: PresenceEntry, now: number = Date.now()): string {
  const base = entry.state === "online"
    ? t("presence.online")
    : entry.state === "away"
      ? t("presence.away")
      : entry.lastSeenAt !== null
        ? t("presence.offlineSeen", { when: lastSeenAgo(entry.lastSeenAt, now) })
        : t("presence.offline");
  return entry.hidden ? t("presence.hiddenSelf", { state: base }) : base;
}

// ── "Show when I am online" (Settings > Privacy) ─────────────────────────

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

let visibleChoice: boolean | undefined;
const visibleListeners = new Set<() => void>();

function readVisible(): boolean {
  if (visibleChoice !== undefined) return visibleChoice;
  try {
    return !presenceHidden(storage()?.getItem(PRESENCE_VISIBLE_PREFERENCE));
  } catch {
    return true;
  }
}

/** On by default. Synced per person (shared/user-preferences.ts). */
export function usePresenceVisible(): boolean {
  return useSyncExternalStore(
    (listener) => { visibleListeners.add(listener); return () => visibleListeners.delete(listener); },
    readVisible,
    () => true,
  );
}

export function setPresenceVisible(visible: boolean): void {
  visibleChoice = visible;
  try {
    storage()?.setItem(PRESENCE_VISIBLE_PREFERENCE, visible ? "1" : "0");
  } catch {
    // the switch still moves for this session; the server keeps the last saved value
  }
  for (const listener of visibleListeners) listener();
}

// ── the page's heartbeat ─────────────────────────────────────────────────

export interface PresenceLoopDeps {
  fetch: typeof fetch;
  now: () => number;
  kind: PresenceClientKind;
  /** The desktop's idle state, when the shell offers it. */
  systemIdle?: () => Promise<{ state: SystemIdleState; idleSeconds: number } | null>;
  setInterval: (fn: () => void, ms: number) => unknown;
  pageId: string;
}

export function presencePageId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `pg_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The loop itself, for a page and for tests. Resolves false (and does
 * nothing more) where the server has no presence. */
export async function startPresenceLoop(deps: PresenceLoopDeps): Promise<{ interacted: () => void; beat: () => Promise<void>; refresh: () => Promise<void> } | null> {
  const refresh = async () => {
    try {
      const response = await deps.fetch(PRESENCE_PATH, { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!response.ok) return;
      applyPresenceList(((await response.json()) as { people?: unknown }).people);
    } catch {
      // keep what was shown; the next refresh tries again
    }
  };
  let lastInteraction = deps.now();
  let lastBeat = 0;
  const beat = async () => {
    lastBeat = deps.now();
    let idleMs = Math.max(0, deps.now() - lastInteraction);
    let systemIdle: SystemIdleState = "unknown";
    if (deps.systemIdle) {
      try {
        const system = await deps.systemIdle();
        if (system) {
          systemIdle = system.state;
          // in the desktop app, using the computer counts as being here
          idleMs = Math.min(idleMs, system.idleSeconds * 1_000);
        }
      } catch {
        // unknown: the page's own idle time decides
      }
    }
    try {
      const response = await deps.fetch(PRESENCE_HEARTBEAT_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId: deps.pageId, kind: deps.kind, idleMs: Math.floor(idleMs), systemIdle }),
      });
      if (!response.ok) return;
      const row = cleanRow(await response.json());
      if (!row) return;
      selfId = key(row.principalId);
      entries = new Map(entries).set(selfId, { state: row.state, lastSeenAt: row.lastSeenAt, ...(row.hidden ? { hidden: true } : {}) });
      notify();
    } catch {
      // the next beat tries again
    }
  };
  // presence exists only where the list answers
  try {
    const probe = await deps.fetch(PRESENCE_PATH, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!probe.ok) return null;
    applyPresenceList(((await probe.json()) as { people?: unknown }).people);
  } catch {
    return null;
  }
  await beat();
  let ticks = 0;
  deps.setInterval(() => {
    void beat();
    ticks += 1;
    if (ticks % Math.max(1, Math.round(PRESENCE_REFRESH_MS / PRESENCE_HEARTBEAT_MS)) === 0) void refresh();
  }, PRESENCE_HEARTBEAT_MS);
  const interacted = () => {
    const now = deps.now();
    const wasIdle = now - lastInteraction > PRESENCE_AWAY_AFTER_MS;
    lastInteraction = now;
    // back after an idle spell: say so now, not at the next minute
    if (wasIdle && now - lastBeat > EARLY_BEAT_MS) void beat();
  };
  return { interacted, beat, refresh };
}

let started = false;

/** The page's wiring: real fetch, input events, the desktop's idle state. */
export async function startPresence(): Promise<void> {
  if (started || typeof window === "undefined") return;
  started = true;
  const shell = window.ogb?.systemIdle;
  const loop = await startPresenceLoop({
    fetch: window.fetch.bind(window),
    now: Date.now,
    kind: shell ? "desktop" : "web",
    systemIdle: shell ? () => shell() : undefined,
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    pageId: presencePageId(),
  });
  if (!loop) return;
  for (const name of ["pointerdown", "keydown", "wheel", "touchstart", "focus"] as const) {
    window.addEventListener(name, loop.interacted, { passive: true, capture: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    loop.interacted();
    void loop.refresh();
  });
  // "Show when I am online" changed here: the server learns it with the
  // synced preferences, then tells everyone; a beat refreshes this row.
  visibleListeners.add(() => { setTimeout(() => void loop.beat(), 2_500); });
}
