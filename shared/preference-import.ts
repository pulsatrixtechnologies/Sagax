// Import of preference lines onto a primary bot. A card lists every line
// first. A line that is already there with the same text changes nothing.
// A line that would replace one is not written unless that line was
// accepted. A line left out is not written. Nothing else is touched.

export const PREFERENCE_LIMITS = {
  lines: 80,
  chars: 400,
  kept: 200,
} as const;

export interface PreferenceItem {
  id: string;
  /** The part before the first colon, or the whole line when there is none. */
  key: string;
  text: string;
}

export interface PreferencePreviewLine {
  id: string;
  key: string;
  text: string;
  kind: "add" | "same" | "conflict";
  /** The text already stored, when kind is conflict or same. */
  existing?: string;
}

export function preferenceLineId(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash, 31) + key.charCodeAt(i) | 0;
  return `pref_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function keyOf(text: string): string {
  const cut = text.indexOf(":");
  if (cut <= 0 || cut >= text.length - 1) return text.toLowerCase();
  const key = text.slice(0, cut).trim();
  return key ? key.toLowerCase() : text.toLowerCase();
}

/** One preference per non-empty line. Later duplicates of a key replace
 * the earlier line in this paste. Not applied yet. */
export function parsePreferenceLines(text: string): PreferenceItem[] {
  const out: PreferenceItem[] = [];
  const seen = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const textLine = line.length > PREFERENCE_LIMITS.chars ? line.slice(0, PREFERENCE_LIMITS.chars).trimEnd() : line;
    const key = keyOf(textLine);
    const item = { id: preferenceLineId(key), key, text: textLine };
    const at = seen.get(key);
    if (at === undefined) {
      if (out.length >= PREFERENCE_LIMITS.lines) break;
      seen.set(key, out.length);
      out.push(item);
    } else {
      out[at] = item;
    }
  }
  return out;
}

export function previewPreferenceImport(existing: readonly PreferenceItem[], incoming: readonly PreferenceItem[]): PreferencePreviewLine[] {
  const byKey = new Map(existing.map((item) => [item.key, item]));
  return incoming.map((item) => {
    const found = byKey.get(item.key);
    if (!found) return { id: item.id, key: item.key, text: item.text, kind: "add" as const };
    if (found.text === item.text) return { id: item.id, key: item.key, text: item.text, kind: "same" as const, existing: found.text };
    return { id: item.id, key: item.key, text: item.text, kind: "conflict" as const, existing: found.text };
  });
}

/** Writes only accepted add and conflict lines. Same lines, refused lines
 * and every preference that was not in the paste stay as they are. */
export function applyPreferenceImport(existing: readonly PreferenceItem[], preview: readonly PreferencePreviewLine[], accept: ReadonlySet<string>): PreferenceItem[] {
  const next = existing.map((item) => ({ ...item }));
  for (const line of preview) {
    if (line.kind === "same" || !accept.has(line.id)) continue;
    const item = { id: line.id, key: line.key, text: line.text };
    const at = next.findIndex((entry) => entry.key === line.key);
    if (at < 0) {
      if (next.length < PREFERENCE_LIMITS.kept) next.push(item);
    } else if (line.kind === "conflict") {
      next[at] = { ...next[at]!, text: line.text };
    }
  }
  return next;
}
