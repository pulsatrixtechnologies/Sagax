// #1154: the model a turn really runs on when the paying person's own
// session does not offer the one that was picked. Pure logic shared by the
// server (the turn) and the app (the model menu), so both name the same
// model. Ids only: no catalogue, no network.

/** The kind of model a line is: a quick one, a coding one, or the plain line. */
type ModelKind = "fast" | "code" | "plain";

function lower(id: string): string {
  const value = id.toLowerCase();
  const sep = value.lastIndexOf("::");
  const tail = sep >= 0 ? value.slice(sep + 2) : value;
  const slash = tail.lastIndexOf("/");
  return slash >= 0 ? tail.slice(slash + 1) : tail;
}

function kindOf(id: string): ModelKind {
  const bare = lower(id);
  if (/(^|[-_.])(fast|mini|nano|lite|flash|haiku|spark|highspeed|turbo)([-_.]|$)/.test(bare)) return "fast";
  if (/(^|[-_.])(code|codex|coder|coding)([-_.]|$)/.test(bare)) return "code";
  return "plain";
}

/** "grok-4.7-build-fast" -> "grok-#-build-fast": the line without its version. */
function stemOf(id: string): string {
  return lower(id).replace(/\d+(?:\.\d+)*/, "#");
}

function versionOf(id: string): number[] {
  const match = /\d+(?:\.\d+)*/.exec(lower(id));
  return match ? match[0].split(".").map(Number) : [];
}

/** One number per version so distances compare: 4.7 -> 4.07, 5 -> 5. */
function versionValue(version: readonly number[]): number {
  return version.reduce((sum, part, index) => sum + part / 100 ** index, 0);
}

/**
 * The model of `offered` closest to `requested`: the same line first
 * (grok-4.7 -> grok-4.6), then the same kind (a fast model for a fast one),
 * then any. Within a group the nearest version wins, the newer one on a tie.
 * Null when `requested` is offered (nothing to replace) or nothing is.
 */
export function equivalentOfferedModel(requested: string, offered: readonly string[]): string | null {
  if (!requested || offered.includes(requested)) return null;
  const pool = [...new Set(offered.filter((id) => id && id !== requested))];
  if (!pool.length) return null;
  const stem = stemOf(requested);
  const kind = kindOf(requested);
  const wanted = versionValue(versionOf(requested));
  const group = (id: string): number => (stemOf(id) === stem ? 0 : kindOf(id) === kind ? 1 : 2);
  const distance = (id: string): number => {
    const version = versionOf(id);
    return version.length && wanted ? Math.abs(versionValue(version) - wanted) : Number.POSITIVE_INFINITY;
  };
  return pool.toSorted((a, b) =>
    group(a) - group(b)
    || distance(a) - distance(b)
    || versionValue(versionOf(b)) - versionValue(versionOf(a))
    || (a < b ? -1 : a > b ? 1 : 0))[0] ?? null;
}
