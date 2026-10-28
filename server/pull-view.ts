// What `gh pr view --json number,additions,deletions,state,isDraft,url`
// answers. Absent counts stay absent: a missing field is not zero.

export interface PullView {
  number: number;
  additions?: number;
  deletions?: number;
  state: "open" | "closed" | "merged";
  draft?: boolean;
  url?: string;
}

const COUNT = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;

/** The forge's own answer, or undefined when it is not that answer. */
export function parsePullView(stdout: string, expected?: number): PullView | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const row = parsed as { number?: unknown; additions?: unknown; deletions?: unknown; state?: unknown; isDraft?: unknown; url?: unknown };
  const number = typeof row.number === "number" ? row.number : Number.NaN;
  if (!Number.isInteger(number) || number < 1) return undefined;
  if (expected !== undefined && number !== expected) return undefined;
  const state = row.state === "MERGED" ? "merged" : row.state === "CLOSED" ? "closed" : row.state === "OPEN" ? "open" : undefined;
  if (!state) return undefined;
  const additions = COUNT(row.additions);
  const deletions = COUNT(row.deletions);
  const url = typeof row.url === "string" && row.url.startsWith("https://") ? row.url : undefined;
  return {
    number,
    state,
    ...(additions !== undefined ? { additions } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
    ...(row.isDraft === true ? { draft: true } : {}),
    ...(url ? { url } : {}),
  };
}
