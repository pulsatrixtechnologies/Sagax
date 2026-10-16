/** Ranking for the command palette's name lists (bots, rooms).
 *
 * A prefix match is almost always what a few typed letters mean, so those
 * rows outrank plain substring matches. Within each tier the input order is
 * preserved — the caller's list already encodes a meaningful order (pinned
 * first, recency, …) and re-sorting it here would fight that. */
export function rankByName<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  // empty query = switcher mode: everything, untouched
  if (!q) return [...items];
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(item);
    else if (name.includes(q)) substring.push(item);
  }
  return [...prefix, ...substring];
}

/** Lowercased, accents folded: "Réglages" and "reglages" are the same
 * word to someone typing fast (Cursor and Grok Bot both fold them). */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** How well `query` names `label`, lower is better, null when it does not:
 * 0 prefix, 1 start of a word, 2 substring, 3 a search word (category or
 * keyword) contains it, 4 its letters appear in order in the label (fuzzy:
 * "nvconv" finds "Nouvelle conversation"). */
export function paletteMatchTier(label: string, query: string, words: readonly string[] = []): number | null {
  const q = foldForSearch(query.trim());
  if (!q) return 0;
  const name = foldForSearch(label);
  if (name.startsWith(q)) return 0;
  if (name.split(/[\s:/·,()-]+/).some((word) => word.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  if (words.some((word) => foldForSearch(word).includes(q))) return 3;
  const compact = q.replace(/\s+/g, "");
  let at = 0;
  for (const char of name) {
    if (char === compact[at]) at += 1;
    if (at === compact.length) return 4;
  }
  return null;
}

/** rankByName for palette commands: same tiers idea, fuzzy last, input
 * order kept within a tier so each group keeps its own meaningful order. */
export function rankFuzzy<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => { label: string; words?: readonly string[] },
): T[] {
  if (!query.trim()) return [...items];
  const tiers: T[][] = [[], [], [], [], []];
  for (const item of items) {
    const { label, words } = textOf(item);
    const tier = paletteMatchTier(label, query, words);
    if (tier !== null) tiers[tier]!.push(item);
  }
  return tiers.flat();
}
