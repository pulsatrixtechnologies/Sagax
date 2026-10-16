// The dev pods' own preferences, on this device only: the Settings >
// Experimental switch (off by default), which pods are collapsed or hidden
// and in what order, the conversations where the pods were dismissed, and
// whether the rail was hidden from the header button. Plus the live,
// unsaved state the rail shares with the header button (is the conversation
// development work, does the rail fit beside the transcript, is the overlay
// open).
//
// Every storage access is guarded: a private window or blocked site data
// gives the defaults, never an error.
import { useSyncExternalStore } from "react";

const KEY = "sagax.devPods.v1";
const MAX_DISMISSED = 200;

export interface DevPodPrefs {
  enabled: boolean;
  collapsed: Record<string, boolean>;
  hidden: string[];
  order: string[];
  /** Thread keys where the person dismissed the pods. Newest last. */
  dismissed: string[];
  /** The rail hidden from the header button while it fits beside the transcript. */
  railHidden: boolean;
}

export const DEFAULT_PREFS: DevPodPrefs = { enabled: false, collapsed: {}, hidden: [], order: [], dismissed: [], railHidden: false };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parsePrefs(raw: string | null): DevPodPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<DevPodPrefs> | null;
    if (!value || typeof value !== "object") return DEFAULT_PREFS;
    const collapsed: Record<string, boolean> = {};
    if (value.collapsed && typeof value.collapsed === "object") {
      for (const [id, flag] of Object.entries(value.collapsed)) if (typeof flag === "boolean") collapsed[id] = flag;
    }
    return {
      enabled: value.enabled === true,
      collapsed,
      hidden: strings(value.hidden),
      order: strings(value.order),
      dismissed: strings(value.dismissed).slice(-MAX_DISMISSED),
      railHidden: value.railHidden === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function read(): DevPodPrefs {
  try {
    return parsePrefs(globalThis.localStorage?.getItem(KEY) ?? null);
  } catch {
    return DEFAULT_PREFS;
  }
}

let prefs: DevPodPrefs | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => (prefs ??= read());

export function devPodPrefs(): DevPodPrefs {
  return snapshot();
}

export function updateDevPodPrefs(change: (current: DevPodPrefs) => DevPodPrefs): void {
  const next = change(snapshot());
  if (next === prefs) return;
  prefs = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // kept in memory for this window
  }
  for (const listener of listeners) listener();
}

/** Tests: forget the cached copy so the next read comes from storage. */
export function resetDevPodPrefsForTest(next?: DevPodPrefs): void {
  prefs = next ?? null;
  for (const listener of listeners) listener();
}

export function useDevPodPrefs(): DevPodPrefs {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export const setDevPodsEnabled = (enabled: boolean) => updateDevPodPrefs((current) => ({ ...current, enabled }));

export const setPodCollapsed = (id: string, collapsed: boolean) =>
  updateDevPodPrefs((current) => ({ ...current, collapsed: { ...current.collapsed, [id]: collapsed } }));

export const setPodHidden = (id: string, hidden: boolean) =>
  updateDevPodPrefs((current) => ({
    ...current,
    hidden: hidden ? [...current.hidden.filter((item) => item !== id), id] : current.hidden.filter((item) => item !== id),
  }));

export const showAllPods = () => updateDevPodPrefs((current) => ({ ...current, hidden: [] }));

/** Move a pod one place up (-1) or down (+1) among `ids`, the order on screen. */
export function movePod(ids: readonly string[], id: string, step: -1 | 1): void {
  const index = ids.indexOf(id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= ids.length) return;
  const order = [...ids];
  [order[index], order[target]] = [order[target]!, order[index]!];
  updateDevPodPrefs((current) => ({ ...current, order }));
}

export const setThreadDismissed = (threadKey: string, dismissed: boolean) =>
  updateDevPodPrefs((current) => ({
    ...current,
    dismissed: dismissed
      ? [...current.dismissed.filter((key) => key !== threadKey), threadKey].slice(-MAX_DISMISSED)
      : current.dismissed.filter((key) => key !== threadKey),
  }));

export const setRailHidden = (railHidden: boolean) => updateDevPodPrefs((current) => ({ ...current, railHidden }));

// Live state shared by the rail and the header button, per thread key.

export interface DevPodsLive {
  threadKey: string;
  /** The detector says this is development work. */
  active: boolean;
  /** At least one pod has something to show. */
  filled: boolean;
  /** The rail fits in the free gutter right of the transcript. */
  fits: boolean;
  /** Opened from the header on a narrow window: floats over the transcript. */
  overlayOpen: boolean;
}

const LIVE_OFF: DevPodsLive = { threadKey: "", active: false, filled: false, fits: false, overlayOpen: false };
let live: DevPodsLive = LIVE_OFF;
const liveListeners = new Set<() => void>();
const liveSubscribe = (listener: () => void) => {
  liveListeners.add(listener);
  return () => { liveListeners.delete(listener); };
};
const liveSnapshot = () => live;

export function updateDevPodsLive(patch: Partial<DevPodsLive>): void {
  const next = { ...live, ...patch };
  if ((Object.keys(next) as Array<keyof DevPodsLive>).every((key) => next[key] === live[key])) return;
  live = next;
  for (const listener of liveListeners) listener();
}

export function resetDevPodsLiveForTest(): void {
  live = LIVE_OFF;
  for (const listener of liveListeners) listener();
}

export function useDevPodsLive(): DevPodsLive {
  return useSyncExternalStore(liveSubscribe, liveSnapshot, liveSnapshot);
}
