// The addresses that open a screen of the app (`#approvals`, `#approvals?…`,
// `#code`, `#code/<run>`, `#achievements`, `#achievements/<category>`), read at load and on every hash change of an open
// tab. Any other hash (`#inbox`, a pairing `#code=…`) is left to its owner.
import { isInboxHash } from "../../shared/approvals-inbox";
import { ACHIEVEMENT_CATEGORIES } from "../../shared/achievements";
import { codeHashTarget } from "@/lib/code-runs";
import type { AchievementsCategory } from "@/state/store";

export type ViewHashAction =
  | { type: "showApprovals" }
  | { type: "showCode"; runId?: string }
  | { type: "showAchievements"; category?: AchievementsCategory };

const ACHIEVEMENTS_CATEGORIES: readonly string[] = ["all", ...ACHIEVEMENT_CATEGORIES, "settings"];

/** `#achievements` opens the page on All, `#achievements/<category>` on that
 * category (an unknown one falls back to All). Null for any other hash. */
export function achievementsHashTarget(hash: string): { category?: AchievementsCategory } | null {
  const match = /^#achievements(?:\/([a-z-]+))?\/?$/.exec(hash);
  if (!match) return null;
  const named = match[1];
  return named && ACHIEVEMENTS_CATEGORIES.includes(named) ? { category: named as AchievementsCategory } : {};
}

/** Opens the screen the hash names; true when it named one. The Approvals
 * screen keeps its filters in the address; `#code` leaves it. */
export function followViewHash(
  dispatch: (action: ViewHashAction) => void,
  loc: Pick<Location, "hash" | "pathname" | "search"> = location,
  historyApi: Pick<History, "replaceState" | "state"> | null = globalThis.history ?? null,
): boolean {
  if (isInboxHash(loc.hash)) {
    dispatch({ type: "showApprovals" });
    return true;
  }
  const achievements = achievementsHashTarget(loc.hash);
  if (achievements) {
    dispatch({ type: "showAchievements", ...achievements });
    try { historyApi?.replaceState(historyApi.state, "", `${loc.pathname}${loc.search}`); } catch { /* ignore */ }
    return true;
  }
  const target = codeHashTarget(loc.hash);
  if (!target) return false;
  dispatch({ type: "showCode", ...target });
  try { historyApi?.replaceState(historyApi.state, "", `${loc.pathname}${loc.search}`); } catch { /* ignore */ }
  return true;
}

/** Drops a `#approvals…` or `#code…` hash once its screen is no longer
 * shown, so following the same address again fires a hash change and opens
 * it. True when it cleared one. */
export function clearLeftViewHash(
  activeView: string,
  loc: Pick<Location, "hash" | "pathname" | "search"> = location,
  historyApi: Pick<History, "replaceState" | "state"> | null = globalThis.history ?? null,
): boolean {
  const left = (isInboxHash(loc.hash) && activeView !== "approvals") || (codeHashTarget(loc.hash) !== null && activeView !== "code");
  if (!left) return false;
  try { historyApi?.replaceState(historyApi.state, "", `${loc.pathname}${loc.search}`); } catch { /* ignore */ }
  return true;
}

/** Follows the hash now and on every later change; returns the cleanup. */
export function watchViewHash(dispatch: (action: ViewHashAction) => void): () => void {
  followViewHash(dispatch);
  const onHashChange = () => { followViewHash(dispatch); };
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
}
