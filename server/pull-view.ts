// What `gh pr view --json number,additions,deletions,state,isDraft,url`
// answers. Absent counts stay absent: a missing field is not zero.

export interface PullView {
  number: number;
  additions?: number;
  deletions?: number;
  state: "open" | "closed" | "merged";
  draft?: boolean;
  url?: string;
  /** GitHub auto-merge is on (merge when ready). */
  autoMerge?: boolean;
  /** Head branch, when the forge named one that can be deleted. */
  head?: string;
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
  const row = parsed as {
    number?: unknown; additions?: unknown; deletions?: unknown; state?: unknown; isDraft?: unknown; url?: unknown;
    autoMergeRequest?: unknown; headRefName?: unknown;
  };
  const number = typeof row.number === "number" ? row.number : Number.NaN;
  if (!Number.isInteger(number) || number < 1) return undefined;
  if (expected !== undefined && number !== expected) return undefined;
  const state = row.state === "MERGED" ? "merged" : row.state === "CLOSED" ? "closed" : row.state === "OPEN" ? "open" : undefined;
  if (!state) return undefined;
  const additions = COUNT(row.additions);
  const deletions = COUNT(row.deletions);
  const url = typeof row.url === "string" && row.url.startsWith("https://") ? row.url : undefined;
  const head = typeof row.headRefName === "string" && /^[\w./-]+$/.test(row.headRefName) && !row.headRefName.includes("..") ? row.headRefName : undefined;
  return {
    number,
    state,
    ...(additions !== undefined ? { additions } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
    ...(row.isDraft === true ? { draft: true } : {}),
    ...(url ? { url } : {}),
    ...(row.autoMergeRequest !== null && typeof row.autoMergeRequest === "object" ? { autoMerge: true } : {}),
    ...(head ? { head } : {}),
  };
}

/** Failed GitHub Actions runs named on a pull request (`statusCheckRollup`).
 * A check that is not an Actions run is not a run id. */
export function failedActionRuns(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const rollup = (parsed as { statusCheckRollup?: unknown } | null)?.statusCheckRollup;
  if (!Array.isArray(rollup)) return [];
  const ids = new Set<string>();
  for (const item of rollup) {
    if (!item || typeof item !== "object") continue;
    const row = item as { conclusion?: unknown; state?: unknown; detailsUrl?: unknown; details_url?: unknown };
    const conclusion = typeof row.conclusion === "string" ? row.conclusion.toUpperCase() : "";
    const state = typeof row.state === "string" ? row.state.toUpperCase() : "";
    const failed = conclusion === "FAILURE" || conclusion === "CANCELLED" || conclusion === "TIMED_OUT" || state === "FAILURE" || state === "ERROR";
    if (!failed) continue;
    const url = typeof row.detailsUrl === "string" ? row.detailsUrl : typeof row.details_url === "string" ? row.details_url : "";
    const match = /\/actions\/runs\/(\d+)/.exec(url);
    if (match?.[1]) ids.add(match[1]);
  }
  return [...ids];
}
