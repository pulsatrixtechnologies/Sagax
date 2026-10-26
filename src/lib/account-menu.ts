// The sidebar's avatar menu, after the reference design's (2026-10-16, for 0.5.7):
//
//   Usage · N% used ›      (the person's own plan; no percent without one)
//   Get Sagax on mobile    (only once there is a public link to send)
//   Help ›                 (Keyboard shortcuts, Release notes, Check for updates, About)
//   Settings
//   Automations, Achievements (Team map: the Automations header and ⌘K)
//   ──────────
//   Switch organization ›  (this computer and the saved organization servers)
//   Switch account ›       (a business session: the account in use, then any
//                           saved personal or organization account)
//   Sign out               (an organization server only)
//
// Browse bots left for Connect apps' header, Automations for Settings, and
// Check for updates, Keyboard shortcuts and About for Help. Pure helpers,
// so the menu's rules are tested without a store or a bridge.
import { formatResetDistance, type PlanRow } from "./plan-usage";

/** No public App Store or TestFlight link for Sagax exists yet: "Get Sagax
 * on mobile" stays out of the menu until one does. */
export const SAGAX_MOBILE_URL: string | null = null;

/** The figure beside Usage: the most used weekly window of the person's own
 * plans (a 5-hour window when a plan reports no weekly one), rounded; null
 * without a plan that reports one. */
export function usagePercent(rows: readonly PlanRow[]): number | null {
  let best: number | null = null;
  for (const row of rows) {
    if (row.state !== "windows") continue;
    const window = row.weekly.available && row.weekly.usedPercent != null ? row.weekly : row.fiveHour;
    if (!window.available || window.usedPercent == null || !Number.isFinite(window.usedPercent)) continue;
    const used = Math.round(Math.min(100, Math.max(0, window.usedPercent)));
    best = best === null ? used : Math.max(best, used);
  }
  return best;
}

export interface UsageLine {
  key: string;
  label: string;
  subtitle?: string;
  value: string;
}

/** The second level's figures: one line per window of each plan (its name
 * and plan, the window, the percent used, when it resets). */
export function usageLines(
  rows: readonly PlanRow[],
  labels: { weekly: string; fiveHour: string; used: (percent: number) => string; resetsIn: (when: string) => string },
  now = Date.now(),
): UsageLine[] {
  const lines: UsageLine[] = [];
  for (const row of rows) {
    if (row.state !== "windows") continue;
    const name = row.plan ? `${row.name} ${row.plan}` : row.name;
    for (const [key, label, window] of [["weekly", labels.weekly, row.weekly], ["five-hour", labels.fiveHour, row.fiveHour]] as const) {
      if (!window.available || window.usedPercent == null) continue;
      const when = formatResetDistance(window.resetsAt, now);
      lines.push({
        key: `${row.id}:${key}`,
        label: `${name} · ${label}`,
        subtitle: when ? labels.resetsIn(when) : undefined,
        value: labels.used(Math.round(Math.min(100, Math.max(0, window.usedPercent)))),
      });
    }
  }
  return lines;
}

export interface SwitchTarget {
  id: string;
  name: string;
  /** this computer's own server (solo) */
  local: boolean;
  active: boolean;
}

/** The account this page is signed into, when it is not one of the saved
 * servers. The menu shows its name; the id stays off the screen. */
export const CURRENT_ACCOUNT_ID = "current";

export interface AccountChoice {
  id: string;
  name: string;
  local: boolean;
  active: boolean;
  /** The desktop can open this saved server. The account in use, when it
   * is not one of those servers, is shown and checked, and picking it
   * does nothing. */
  switchable: boolean;
}

/** The account a business session is signed into: the desktop's locked
 * server when it names one, otherwise the organization's own name. */
export function businessAccount(
  server: { active: true; id: string; name: string } | { active: false } | null,
  organizationName: string | null | undefined,
): { id: string; name: string; local: false } | null {
  if (server?.active) {
    const id = server.id.trim();
    const name = server.name.trim();
    if (id && name) return { id, name, local: false };
  }
  const name = organizationName?.trim() ?? "";
  if (!name) return null;
  return { id: CURRENT_ACCOUNT_ID, name, local: false };
}

/** Switch account ›: the saved personal and organization accounts, with the
 * one in use checked. A current account the saved list does not already
 * name is added, still checked, and is not a switch target. */
export function accountChoices(
  saved: readonly SwitchTarget[],
  current: { id: string; name: string; local?: boolean } | null,
): AccountChoice[] {
  const rows: AccountChoice[] = saved
    .filter((entry) => entry.id.trim().length > 0 && entry.name.trim().length > 0)
    .map((entry) => ({
      id: entry.id,
      name: entry.name.trim(),
      local: entry.local,
      active: entry.active,
      switchable: true,
    }));
  const id = current?.id.trim() ?? "";
  const name = current?.name.trim() ?? "";
  if (!id || !name) return rows;
  const known = rows.findIndex((entry) => entry.id === id);
  if (known >= 0) return rows.map((entry, index) => ({ ...entry, active: index === known }));
  if (id === CURRENT_ACCOUNT_ID) {
    const byName = rows.findIndex((entry) => entry.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
    if (byName >= 0) return rows.map((entry, index) => ({ ...entry, active: index === byName }));
    if (rows.some((entry) => entry.active)) return rows;
  }
  return [
    ...rows.map((entry) => ({ ...entry, active: false })),
    { id, name, local: current?.local === true, active: true, switchable: false },
  ];
}

/** Switch organization ›: this computer first, then the organization
 * servers saved on it, the active one checked. Missing folders and other
 * computers' remote servers that are not organizations stay in Settings. */
export function switchTargets(state: {
  activeId: string;
  environments: Array<{ id: string; kind?: "local" | "remote"; name: string; org?: boolean; missing?: boolean }>;
} | null, soloName: string): SwitchTarget[] {
  if (!state) return [];
  const local = state.environments.find((entry) => entry.id === "local");
  const orgs = state.environments.filter((entry) => entry.id !== "local" && entry.org === true && !entry.missing);
  return [
    { id: "local", name: local?.name?.trim() || soloName, local: true, active: state.activeId === "local" },
    ...orgs.map((entry) => ({ id: entry.id, name: entry.name, local: false, active: state.activeId === entry.id })),
  ];
}
