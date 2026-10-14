// The model list shared by the composer's model menu and the model window
// (ModelMenu.tsx): rows grouped in sections, a search that filters as one
// types, and the arrow keys over what is left. Pure, so the rules are tested
// without a DOM.

export type ModelMenuRowKind = "auto" | "follow" | "model";

export interface ModelMenuRow {
  /** Unique in the list. */
  key: string;
  kind: ModelMenuRowKind;
  instanceId?: string;
  modelId?: string;
  /** The model's name, in primary ink. */
  label: string;
  /** Its effort, variant or origin, in secondary ink. */
  detail?: string;
  /** Short markers after the detail (Default, Loaded, the bot's model). */
  tags?: string[];
  /** The choice in effect: checked. */
  current: boolean;
  /** Why it cannot be picked: shown dimmed with this as a tooltip. */
  unavailable?: string;
  /** The tooltip otherwise: the whole name and detail, which a narrow menu
   * truncates. */
  title?: string;
  /** More words the search matches (the engine's name, the model id). */
  keywords?: string;
}

export interface ModelMenuSection {
  key: string;
  /** The heading (an engine, Cloud, Local); none for the top rows. */
  label?: string;
  /** A muted note beside the heading (an engine's state). */
  note?: string;
  rows: ModelMenuRow[];
}

/** Lower case, accents dropped: "élevé" matches "eleve". */
export function foldSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Every word of the query must appear in the row's name, detail, tags,
 * keywords or its section's heading. An empty query keeps everything;
 * sections left without rows are dropped. */
export function filterModelSections(sections: readonly ModelMenuSection[], query: string): ModelMenuSection[] {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections.filter((section) => section.rows.length > 0);
  return sections.flatMap((section) => {
    const rows = section.rows.filter((row) => {
      const haystack = foldSearch([section.label, row.label, row.detail, ...(row.tags ?? []), row.keywords, row.modelId].filter(Boolean).join(" "));
      return words.every((word) => haystack.includes(word));
    });
    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}

/** The rows the arrow keys and Enter reach, in order. */
export function pickableRows(sections: readonly ModelMenuSection[]): ModelMenuRow[] {
  return sections.flatMap((section) => section.rows.filter((row) => !row.unavailable));
}

/** The row Enter picks: the one the person moved to, else the first match
 * while searching, else the current choice, else the first row. */
export function activeRowKey(rows: readonly ModelMenuRow[], moved: string | null, searching: boolean): string | null {
  if (moved && rows.some((row) => row.key === moved)) return moved;
  if (!searching) {
    const current = rows.find((row) => row.current);
    if (current) return current.key;
  }
  return rows[0]?.key ?? null;
}

/** One step of the arrow keys, wrapping at both ends. */
export function stepRow(rows: readonly ModelMenuRow[], from: string | null, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): string | null {
  if (rows.length === 0) return null;
  const at = rows.findIndex((row) => row.key === from);
  const next = key === "Home" ? 0
    : key === "End" ? rows.length - 1
    : key === "ArrowDown" ? (at + 1) % rows.length
    : (at <= 0 ? rows.length : at) - 1;
  return rows[next]!.key;
}
