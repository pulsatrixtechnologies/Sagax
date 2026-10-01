import { useSyncExternalStore } from "react";
import { z } from "zod";

export type SidebarDensity = "comfortable" | "compact" | "icons";

export const SIDEBAR_DENSITIES: readonly SidebarDensity[] = ["comfortable", "compact", "icons"];

export const SIDEBAR_DENSITY_KEY = "openmausbot.sidebarDensity";
export const SIDEBAR_WIDTH_KEY = "openmausbot.sidebarWidth";
export const SIDEBAR_ATTENTION_PINNED_KEY = "openmausbot.sidebarAttentionPinned.v1";
export const SIDEBAR_COLLAPSED_SECTIONS_KEY = "openmausbot.sidebarCollapsedSections.v1";
export const SIDEBAR_SECTION_ORDER_KEY = "openmausbot.sidebarSectionOrder.v1";
/** The density to return to when the collapsed (icons) sidebar is expanded
 * again from its header button. */
export const SIDEBAR_EXPANDED_DENSITY_KEY = "openmausbot.sidebarExpandedDensity.v1";

export function parseSidebarDensity(value: string | null): SidebarDensity {
  switch (value) {
    case "comfortable":
    case "compact":
    case "icons":
      return value;
    default:
      return "comfortable";
  }
}

export function loadSidebarDensity(storage?: Pick<Storage, "getItem"> | null): SidebarDensity {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseSidebarDensity(target?.getItem(SIDEBAR_DENSITY_KEY) ?? null);
  } catch {
    return "comfortable";
  }
}

export function saveSidebarDensity(
  density: SidebarDensity,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_DENSITY_KEY, density);
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // The in-memory React state still makes the control useful this session.
  }
}

/** The sidebar's collapse button: icons density is the collapsed rail, like
 * Perspicax's narrow sidebar. Collapsing remembers the density it left so
 * expanding lands back on comfortable or compact, whichever it was. */
export function toggleSidebarCollapsed(
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): SidebarDensity {
  let target: Pick<Storage, "getItem" | "setItem"> | null = null;
  try {
    target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
  } catch {
    target = null;
  }
  const current = loadSidebarDensity(target);
  let next: SidebarDensity = "icons";
  if (current === "icons") {
    let stored: string | null = null;
    try { stored = target?.getItem(SIDEBAR_EXPANDED_DENSITY_KEY) ?? null; } catch { /* default below */ }
    const previous = parseSidebarDensity(stored);
    next = previous === "icons" ? "comfortable" : previous;
  } else {
    try { target?.setItem(SIDEBAR_EXPANDED_DENSITY_KEY, current); } catch { /* session only */ }
  }
  if (storage === undefined) setSidebarDensity(next);
  else saveSidebarDensity(next, target);
  return next;
}

// The sidebar and Settings → Appearance both read and change the density, so
// it lives in one renderer store rather than in either component's state.
// A session choice survives storage that rejects writes; another window's
// storage event supersedes it.
let densitySessionChoice: SidebarDensity | undefined;
const densityListeners = new Set<() => void>();

function currentSidebarDensity(): SidebarDensity {
  return densitySessionChoice ?? loadSidebarDensity();
}

function notifyDensity() {
  for (const listener of densityListeners) listener();
}

function onDensityStorage(event: StorageEvent) {
  if (event.key !== SIDEBAR_DENSITY_KEY && event.key !== null) return;
  try {
    if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
  } catch {
    return;
  }
  densitySessionChoice = undefined;
  notifyDensity();
}

function subscribeDensity(listener: () => void): () => void {
  densityListeners.add(listener);
  if (densityListeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onDensityStorage);
  }
  return () => {
    densityListeners.delete(listener);
    if (densityListeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onDensityStorage);
    }
  };
}

/** The same store for callers that do not render through a hook. */
export function subscribeSidebarDensity(listener: () => void): () => void {
  return subscribeDensity(listener);
}

export function setSidebarDensity(density: SidebarDensity): void {
  densitySessionChoice = density;
  saveSidebarDensity(density);
  notifyDensity();
}

export function useSidebarDensity(): SidebarDensity {
  return useSyncExternalStore(subscribeDensity, currentSidebarDensity, () => "comfortable");
}

export function clampSidebarWidth(width: number, viewportWidth: number): number {
  return Math.max(240, Math.min(480, viewportWidth - 320, Math.round(width)));
}

export function loadSidebarWidth(storage?: Pick<Storage, "getItem"> | null): number | null {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    const raw = target?.getItem(SIDEBAR_WIDTH_KEY);
    if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return null;
    const width = Number(raw);
    return width >= 240 && width <= 480 ? width : null;
  } catch {
    return null;
  }
}

export function saveSidebarWidth(width: number, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // A blocked local store does not prevent resizing this session.
  }
}

export function parseSidebarAttentionPinned(value: string | null): boolean {
  return value === "true";
}

export function loadSidebarAttentionPinned(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseSidebarAttentionPinned(target?.getItem(SIDEBAR_ATTENTION_PINNED_KEY) ?? null);
  } catch {
    return false;
  }
}

export function saveSidebarAttentionPinned(
  pinned: boolean,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_ATTENTION_PINNED_KEY, String(pinned));
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // The in-memory React state still makes the control useful this session.
  }
}

const stringListSchema = z.array(z.string().min(1).max(240));

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = stringListSchema.safeParse(parsed);
    return result.success ? [...new Set(result.data)].slice(0, 100) : [];
  } catch {
    return [];
  }
}

function loadStringList(
  key: string,
  storage?: Pick<Storage, "getItem"> | null,
): string[] {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseStringList(target?.getItem(key) ?? null);
  } catch {
    return [];
  }
}

function saveStringList(
  key: string,
  values: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    const safe = [
      ...new Set(values.filter((value) => value.length > 0 && value.length <= 240)),
    ].slice(0, 100);
    target?.setItem(key, JSON.stringify(safe));
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // In-memory React state still keeps the interaction useful this session.
  }
}

export function loadCollapsedSections(storage?: Pick<Storage, "getItem"> | null): string[] {
  return loadStringList(SIDEBAR_COLLAPSED_SECTIONS_KEY, storage);
}

export function saveCollapsedSections(
  ids: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  saveStringList(SIDEBAR_COLLAPSED_SECTIONS_KEY, ids, storage);
}

export function toggleCollapsedSection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

export function loadSectionOrder(storage?: Pick<Storage, "getItem"> | null): string[] {
  return loadStringList(SIDEBAR_SECTION_ORDER_KEY, storage);
}

export function saveSectionOrder(
  ids: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  saveStringList(SIDEBAR_SECTION_ORDER_KEY, ids, storage);
}
