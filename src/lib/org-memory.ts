// Settings > Memory: what the page shows of the organization memory cached
// on this computer for Obsidian (electron/org-memory-cache.mjs, Perspicax
// lot A.4). The desktop's main process does the work and, since 2026-10-14,
// sets it up by itself from the organization server the person is signed in
// to (no address, no token to type). The page only reads its state, asks for
// a new attempt and opens the vault in Obsidian.
import { useEffect, useState } from "react";

/** One tier of the last sync, as the main process reports it. */
export interface OrgMemoryTier {
  name: string;
  label: string;
  /** `direct` (my own tier), `auto` (accepted at once), `review`. */
  push: string;
  status: "cloned" | "pushed" | "up-to-date" | "refused" | "conflict" | "error";
  messages: string[];
}

/** One of the person's review items on Perspicax. */
export interface OrgMemoryItem {
  id?: string;
  tier: string;
  title: string;
  state: "pending" | "approved" | "refused" | "returned" | "expired";
  reason?: string;
  path?: string;
  edit_of?: string;
}

/** Why the automatic setup or sync did not go through (never a server
 * answer as such: the page says it in its own words). */
export type OrgMemoryAutoError =
  | "unreachable"
  | "unsupported"
  | "memory_off"
  | "not_member"
  | "signed_out"
  | "no_org"
  | "cloud_folder";

export interface OrgMemoryState {
  connected: boolean;
  server: string | null;
  /** `auto`: set up from the organization server; null or absent: by hand
   * (before 2026-10-14) or not at all. */
  mode?: "auto" | null;
  vault: string;
  cloned: boolean;
  obsidianConfigured: boolean;
  obsidianUrl: string;
  /** The vault sits in a cloud-synchronized folder: refused. */
  cloudFolder: string | null;
  busy: boolean;
  tiers: OrgMemoryTier[];
  pending: OrgMemoryItem[];
  pendingCount: number;
  lastSyncAt: number | null;
  lastError: string | null;
  autoError?: OrgMemoryAutoError | null;
}

export interface OrgMemoryBridge {
  state(): Promise<OrgMemoryState>;
  /** Set up (or renew) from the organization server, then sync. */
  auto(): Promise<OrgMemoryState>;
  sync(): Promise<OrgMemoryState>;
  erase(): Promise<OrgMemoryState>;
  writeObsidianConfig(): Promise<OrgMemoryState>;
  /** Opens the vault in Obsidian (electron/obsidian-vault.mjs). */
  openInObsidian(): Promise<OrgMemoryOpenResult>;
  /** Shows the vault folder in the Finder (Explorer, files). */
  showFolder(): Promise<boolean>;
}

/** What Open in Obsidian did: opened, or why not (`add_vault`: Obsidian is
 * open on its vault chooser, the person picks Open folder as vault). An
 * older desktop answers `true`. */
export type OrgMemoryOpenResult =
  | true
  | { ok: true }
  | { ok: false; reason: "not_installed" | "add_vault" | "failed" };

/** What the status line says. */
export type OrgMemoryStatus = "setting-up" | "syncing" | "synced" | "failed";

export function orgMemoryStatus(state: OrgMemoryState | null, running = false): OrgMemoryStatus {
  if (running || state?.busy) return state?.connected ? "syncing" : "setting-up";
  if (state?.autoError) return "failed";
  if (state?.connected) return "synced";
  return "setting-up";
}

/** How many of the person's proposals a reviewer refused lately: the page
 * shows a count only, never the items (their titles, reasons and team ids
 * stay in Perspicax and the _pending folder). */
export function refusedCount(items: OrgMemoryItem[]): number {
  return items.filter((i) => i.state === "refused").length;
}

/** The tiers whose last sync needs the person: a refusal, a conflict, an
 * error. */
export function tiersNeedingAttention(state: OrgMemoryState | null): OrgMemoryTier[] {
  return (state?.tiers ?? []).filter((t) => t.status === "refused" || t.status === "conflict" || t.status === "error");
}

// ── the automatic sync, shared by the app and the page ─────────────────

/** How often the copy syncs while the app is open. */
export const ORG_MEMORY_SYNC_MS = 15 * 60_000;

let latest: OrgMemoryState | null = null;
let running: Promise<OrgMemoryState | null> | null = null;
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};

/** One automatic attempt (a second call joins the running one). Never
 * throws: a failure is in the state the main process answers. */
export function runOrgMemoryAuto(bridge: OrgMemoryBridge): Promise<OrgMemoryState | null> {
  if (running) return running;
  running = bridge.auto().then(
    (state) => {
      latest = state;
      return state;
    },
    // A failed call keeps no stale "syncing" state: read it again.
    () => bridge.state().then((state) => (latest = state), () => latest),
  ).finally(() => {
    running = null;
    publish();
  });
  publish();
  return running;
}

/** The desktop app's bridge, or undefined (a browser, the phone). */
export function orgMemoryBridge(): OrgMemoryBridge | undefined {
  return typeof window === "undefined" ? undefined : window.ogb?.orgMemory;
}

/** Sets the copy up and keeps it synced while `active` (the app is on an
 * organization server signed in with Perspicax), in the desktop app only. */
export function useOrgMemoryAuto(active: boolean): void {
  useEffect(() => {
    const bridge = orgMemoryBridge();
    if (!bridge || !active) return;
    void runOrgMemoryAuto(bridge);
    const timer = setInterval(() => void runOrgMemoryAuto(bridge), ORG_MEMORY_SYNC_MS);
    return () => clearInterval(timer);
  }, [active]);
}

/** The last known state and whether an attempt is running. */
export function useOrgMemoryState(bridge: OrgMemoryBridge, initial: OrgMemoryState | null = null): { state: OrgMemoryState | null; running: boolean } {
  const [, setTick] = useState(0);
  const [own, setOwn] = useState<OrgMemoryState | null>(initial);
  useEffect(() => {
    let alive = true;
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    void bridge.state().then((s) => { if (alive && !latest) setOwn(s); }).catch(() => {});
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, [bridge]);
  return { state: latest ?? own, running: running !== null };
}

/** Tests only. */
export function resetOrgMemoryForTests(): void {
  latest = null;
  running = null;
  listeners.clear();
}
