// Floating windows: non-blocking, movable and resizable windows drawn over the
// app (the conversation stays usable behind them). Generic: a window is an id,
// a kind, a title and either a `render` function (this session only) or JSON
// `data` that a renderer registered for its kind draws (registerFloatingKind).
//
// - Several at once, stacked in order: the last one is on top; a click brings
//   one forward (focusFloating). Each closes on its own.
// - Position and size are remembered per stable id, so reopening the same id
//   puts it back where it was.
// - A window opened with `persist: true` (and a kind renderer, since a render
//   function cannot be saved) reopens at its place when Sagax restarts.
//
// Saved per device in localStorage (omb.floatingWindows.v1): the open
// persistent windows and the last geometry of up to MAX_GEOMETRY ids.
import { useSyncExternalStore, type ReactNode } from "react";

export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingWindowEntry {
  id: string;
  kind: string;
  title: string;
  /** JSON data for the kind's renderer; saved with a persistent window. */
  data?: unknown;
  rect: FloatingRect;
  minWidth: number;
  minHeight: number;
  persist: boolean;
}

export interface OpenFloatingOptions {
  /** Stable id: one window per id; reopening it focuses it. */
  id: string;
  kind: string;
  title: string;
  data?: unknown;
  /** Draws the body for this session; without it the kind's renderer does. */
  render?: (entry: FloatingWindowEntry) => ReactNode;
  /** Called once when the window closes (this session only). */
  onClose?: () => void;
  /** Reopen it at its place after a restart (needs a kind renderer). */
  persist?: boolean;
  /** First size when the id has no remembered geometry. */
  size?: { width: number; height: number };
  minWidth?: number;
  minHeight?: number;
}

export type FloatingRenderer = (entry: FloatingWindowEntry) => ReactNode;
export type FloatingStorage = Pick<Storage, "getItem" | "setItem">;
export type Viewport = { width: number; height: number };

export const FLOATING_STORAGE_KEY = "omb.floatingWindows.v1";
export const MAX_FLOATING_WINDOWS = 16;
export const MAX_GEOMETRY = 50;
const CASCADE_STEP = 28;
const CASCADE_WRAP = 8;
const ID = /^[\w:.@/-]{1,200}$/;
const DEFAULT_SIZE = { width: 640, height: 400 };
/** How much of a window always stays on screen, so its title bar can be grabbed. */
const KEEP_VISIBLE = 96;
const TITLE_BAR = 36;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function readRect(value: unknown): FloatingRect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/** Keeps a window reachable in the viewport: no larger than it, the title bar
 * inside it, and at least KEEP_VISIBLE pixels of the window on screen. */
export function clampRect(rect: FloatingRect, viewport: Viewport, min = { width: 240, height: 160 }): FloatingRect {
  const width = Math.round(Math.max(Math.min(min.width, viewport.width), Math.min(rect.width, viewport.width)));
  const height = Math.round(Math.max(Math.min(min.height, viewport.height), Math.min(rect.height, viewport.height)));
  const keep = Math.min(KEEP_VISIBLE, width);
  const x = Math.round(Math.min(Math.max(rect.x, keep - width), viewport.width - keep));
  const y = Math.round(Math.min(Math.max(rect.y, 0), viewport.height - TITLE_BAR));
  return { x, y, width, height };
}

/** Where a new window goes: centered a little up, each further one offset
 * down and right so a stack of windows stays readable. */
export function cascadeRect(openCount: number, size: { width: number; height: number }, viewport: Viewport): FloatingRect {
  const step = (openCount % CASCADE_WRAP) * CASCADE_STEP;
  const x = Math.round((viewport.width - size.width) / 2) + step;
  const y = Math.max(48, Math.round((viewport.height - size.height) / 3)) + step;
  return clampRect({ x, y, ...size }, viewport);
}

interface Saved {
  open: Array<Pick<FloatingWindowEntry, "id" | "kind" | "title" | "data" | "rect" | "minWidth" | "minHeight">>;
  geometry: Record<string, FloatingRect>;
}

export function readSaved(storage: FloatingStorage | undefined): Saved {
  let raw: unknown = null;
  try {
    raw = JSON.parse(storage?.getItem(FLOATING_STORAGE_KEY) ?? "null");
  } catch {
    raw = null;
  }
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const geometry: Record<string, FloatingRect> = {};
  if (value.geometry && typeof value.geometry === "object") {
    for (const [id, rect] of Object.entries(value.geometry as Record<string, unknown>)) {
      const parsed = readRect(rect);
      if (ID.test(id) && parsed) geometry[id] = parsed;
    }
  }
  const open: Saved["open"] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value.open) ? value.open : []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const rect = readRect(entry.rect);
    if (typeof entry.id !== "string" || !ID.test(entry.id) || seen.has(entry.id)) continue;
    if (typeof entry.kind !== "string" || !entry.kind || typeof entry.title !== "string" || !rect) continue;
    seen.add(entry.id);
    open.push({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      ...(entry.data !== undefined ? { data: entry.data } : {}),
      rect,
      minWidth: finite(entry.minWidth) ? entry.minWidth : 240,
      minHeight: finite(entry.minHeight) ? entry.minHeight : 160,
    });
    if (open.length >= MAX_FLOATING_WINDOWS) break;
  }
  return { open, geometry };
}

function defaultStorage(): FloatingStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function defaultViewport(): Viewport {
  return typeof window === "undefined" ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight };
}

export interface FloatingWindowsSnapshot {
  /** Bottom to top. */
  windows: FloatingWindowEntry[];
  /** Bumped when a kind renderer is registered, so the host redraws. */
  kinds: number;
}

export function createFloatingWindows({ storage = defaultStorage(), viewport = defaultViewport }: { storage?: FloatingStorage; viewport?: () => Viewport } = {}) {
  const saved = readSaved(storage);
  const geometry = new Map(Object.entries(saved.geometry));
  const renders = new Map<string, FloatingRenderer>();
  const closers = new Map<string, () => void>();
  const kinds = new Map<string, FloatingRenderer>();
  const listeners = new Set<() => void>();
  let snapshot: FloatingWindowsSnapshot = {
    windows: saved.open.map((entry) => ({ ...entry, persist: true })),
    kinds: 0,
  };

  const save = () => {
    const open = snapshot.windows
      .filter((entry) => entry.persist)
      .map(({ id, kind, title, data, rect, minWidth, minHeight }) => ({ id, kind, title, ...(data !== undefined ? { data } : {}), rect, minWidth, minHeight }));
    const ids = [...geometry.keys()].slice(-MAX_GEOMETRY);
    try {
      storage?.setItem(FLOATING_STORAGE_KEY, JSON.stringify({ open, geometry: Object.fromEntries(ids.map((id) => [id, geometry.get(id)])) }));
    } catch {
      /* private mode or quota: the windows still work for this session */
    }
  };
  const emit = (next: FloatingWindowsSnapshot, persist = true) => {
    snapshot = next;
    if (persist) save();
    for (const listener of listeners) listener();
  };
  const remember = (id: string, rect: FloatingRect) => {
    geometry.delete(id); // re-inserted last: the most recent ids are kept
    geometry.set(id, rect);
  };

  function open(options: OpenFloatingOptions): void {
    if (!ID.test(options.id)) throw new Error(`invalid floating window id: ${options.id}`);
    if (options.render) renders.set(options.id, options.render);
    if (options.onClose) closers.set(options.id, options.onClose);
    const existing = snapshot.windows.find((entry) => entry.id === options.id);
    if (existing) {
      const updated = { ...existing, title: options.title, ...(options.data !== undefined ? { data: options.data } : {}) };
      emit({ ...snapshot, windows: [...snapshot.windows.filter((entry) => entry.id !== options.id), updated] });
      return;
    }
    const minWidth = options.minWidth ?? 240;
    const minHeight = options.minHeight ?? 160;
    const view = viewport();
    const remembered = geometry.get(options.id);
    const rect = remembered
      ? clampRect(remembered, view, { width: minWidth, height: minHeight })
      : cascadeRect(snapshot.windows.length, options.size ?? DEFAULT_SIZE, view);
    const entry: FloatingWindowEntry = {
      id: options.id,
      kind: options.kind,
      title: options.title,
      ...(options.data !== undefined ? { data: options.data } : {}),
      rect,
      minWidth,
      minHeight,
      persist: options.persist === true,
    };
    let windows = [...snapshot.windows, entry];
    // over the cap, the bottom window closes
    while (windows.length > MAX_FLOATING_WINDOWS) {
      const [dropped] = windows;
      windows = windows.slice(1);
      renders.delete(dropped.id);
      const onClose = closers.get(dropped.id);
      closers.delete(dropped.id);
      onClose?.();
    }
    emit({ ...snapshot, windows });
  }

  function close(id: string): void {
    if (!snapshot.windows.some((entry) => entry.id === id)) return;
    const onClose = closers.get(id);
    renders.delete(id);
    closers.delete(id);
    emit({ ...snapshot, windows: snapshot.windows.filter((entry) => entry.id !== id) });
    onClose?.();
  }

  function focus(id: string): void {
    const windows = snapshot.windows;
    const index = windows.findIndex((entry) => entry.id === id);
    if (index < 0 || index === windows.length - 1) return;
    emit({ ...snapshot, windows: [...windows.slice(0, index), ...windows.slice(index + 1), windows[index]] }, false);
  }

  /** Moves or resizes a window; `commit` (the end of a drag) remembers it. */
  function setRect(id: string, rect: FloatingRect, { commit = false }: { commit?: boolean } = {}): void {
    const entry = snapshot.windows.find((candidate) => candidate.id === id);
    if (!entry) return;
    const next = clampRect(rect, viewport(), { width: entry.minWidth, height: entry.minHeight });
    if (commit) remember(id, next);
    emit({ ...snapshot, windows: snapshot.windows.map((candidate) => (candidate.id === id ? { ...candidate, rect: next } : candidate)) }, commit);
  }

  function registerKind(kind: string, renderer: FloatingRenderer): () => void {
    kinds.set(kind, renderer);
    emit({ ...snapshot, kinds: snapshot.kinds + 1 }, false);
    return () => {
      if (kinds.get(kind) !== renderer) return;
      kinds.delete(kind);
      emit({ ...snapshot, kinds: snapshot.kinds + 1 }, false);
    };
  }

  /** The body of a window: its own render, else its kind's; null until the
   * kind is registered (a restored window waits for it). */
  function renderBody(entry: FloatingWindowEntry): ReactNode {
    const render = renders.get(entry.id) ?? kinds.get(entry.kind);
    return render ? render(entry) : null;
  }

  return {
    open,
    close,
    focus,
    setRect,
    registerKind,
    renderBody,
    isOpen: (id: string) => snapshot.windows.some((entry) => entry.id === id),
    hasRenderer: (entry: FloatingWindowEntry) => renders.has(entry.id) || kinds.has(entry.kind),
    rememberedRect: (id: string) => geometry.get(id),
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type FloatingWindows = ReturnType<typeof createFloatingWindows>;

let shared: FloatingWindows | null = null;
/** The app's floating windows (created on first use). */
export function floatingWindows(): FloatingWindows {
  shared ??= createFloatingWindows();
  return shared;
}

export const openFloating = (options: OpenFloatingOptions) => floatingWindows().open(options);
export const closeFloating = (id: string) => floatingWindows().close(id);
export const focusFloating = (id: string) => floatingWindows().focus(id);
export const registerFloatingKind = (kind: string, renderer: FloatingRenderer) => floatingWindows().registerKind(kind, renderer);

const subscribe = (listener: () => void) => floatingWindows().subscribe(listener);
const getSnapshot = () => floatingWindows().snapshot();

export function useFloatingWindows(): FloatingWindowsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useFloatingOpen(id: string): boolean {
  return useFloatingWindows().windows.some((entry) => entry.id === id);
}
