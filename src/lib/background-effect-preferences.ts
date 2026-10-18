import { useSyncExternalStore } from "react";
import {
  DEFAULT_INTENSITY,
  isBackgroundEffectId,
  isIntensity,
  isPaletteId,
  type BackgroundEffectId,
  type Intensity,
  type PaletteId,
} from "./background-effects";

// Settings > Appearance > Background effects: which effect sits behind the
// conversation, the colour chosen for each effect and the intensity. A
// renderer preference of this person on this computer, like the skin;
// nothing goes to the server. Another window follows through the storage
// event. A session choice survives private or blocked storage.
//
// Migration (2026-10-18): the switch of #716 ("Glyph ripple on click",
// `sagax-glyph-ripple`) becomes the effect: "1" -> "glyphs", anything else
// -> "none". The first write of the new key removes the old one.

export const BACKGROUND_EFFECT_KEY = "sagax-background-effect";
/** The switch of 0.5.15 and 0.5.16, read once for the migration. */
export const GLYPH_RIPPLE_KEY = "sagax-glyph-ripple";

export interface BackgroundEffectPrefs {
  effect: BackgroundEffectId;
  /** The colour chosen per effect (an effect never chosen has its default). */
  palettes: Partial<Record<BackgroundEffectId, PaletteId>>;
  intensity: Intensity;
}

export const DEFAULT_PREFS: BackgroundEffectPrefs = Object.freeze({ effect: "none", palettes: Object.freeze({}), intensity: DEFAULT_INTENSITY }) as BackgroundEffectPrefs;

/** Parses the stored JSON (anything a hand edit or an older build left),
 * falling back field by field; `legacy` is the old switch's value. */
export function parsePrefs(raw: string | null | undefined, legacy?: string | null): BackgroundEffectPrefs {
  if (raw == null || raw === "") {
    return { effect: legacy === "1" ? "glyphs" : "none", palettes: {}, intensity: DEFAULT_INTENSITY };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS, palettes: {} };
  }
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const palettes: Partial<Record<BackgroundEffectId, PaletteId>> = {};
  const storedPalettes = record.palettes;
  if (storedPalettes && typeof storedPalettes === "object" && !Array.isArray(storedPalettes)) {
    for (const [key, palette] of Object.entries(storedPalettes as Record<string, unknown>)) {
      if (isBackgroundEffectId(key) && isPaletteId(palette)) palettes[key] = palette;
    }
  }
  return {
    effect: isBackgroundEffectId(record.effect) ? record.effect : "none",
    palettes,
    intensity: isIntensity(record.intensity) ? record.intensity : DEFAULT_INTENSITY,
  };
}

let sessionChoice: BackgroundEffectPrefs | undefined;
let cached: { raw: string | null; legacy: string | null; prefs: BackgroundEffectPrefs } | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** The current choice. The same object until something changes, as
 * useSyncExternalStore needs. */
export function readBackgroundEffectPrefs(): BackgroundEffectPrefs {
  if (sessionChoice) return sessionChoice;
  const raw = read(BACKGROUND_EFFECT_KEY);
  const legacy = raw == null ? read(GLYPH_RIPPLE_KEY) : null;
  if (cached && cached.raw === raw && cached.legacy === legacy) return cached.prefs;
  const prefs = parsePrefs(raw, legacy);
  cached = { raw, legacy, prefs };
  return prefs;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== BACKGROUND_EFFECT_KEY && event.key !== GLYPH_RIPPLE_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

function write(next: BackgroundEffectPrefs): void {
  sessionChoice = next;
  try {
    const store = storage();
    store?.setItem(BACKGROUND_EFFECT_KEY, JSON.stringify(next));
    store?.removeItem(GLYPH_RIPPLE_KEY);
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

export function setBackgroundEffect(effect: BackgroundEffectId): void {
  const prefs = readBackgroundEffectPrefs();
  if (prefs.effect === effect) return;
  write({ ...prefs, effect });
}

export function setBackgroundPalette(effect: BackgroundEffectId, palette: PaletteId): void {
  const prefs = readBackgroundEffectPrefs();
  write({ ...prefs, effect, palettes: { ...prefs.palettes, [effect]: palette } });
}

export function setBackgroundIntensity(intensity: Intensity): void {
  const prefs = readBackgroundEffectPrefs();
  if (prefs.intensity === intensity) return;
  write({ ...prefs, intensity });
}

/** Tests only: forget the session choice and the cache. */
export function resetBackgroundEffectPrefsForTests(): void {
  sessionChoice = undefined;
  cached = undefined;
}

export function useBackgroundEffectPrefs(): BackgroundEffectPrefs {
  return useSyncExternalStore(subscribe, readBackgroundEffectPrefs, () => DEFAULT_PREFS);
}
