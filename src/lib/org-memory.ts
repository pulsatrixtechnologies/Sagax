// Settings > Memory: what the page shows of the organization memory cached
// on this computer for Obsidian (electron/org-memory-cache.mjs, Perspicax
// lot A.4). The desktop's main process does the work; the page only reads
// its state and asks for a connect, a sync, an erase or the Obsidian link.

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

export interface OrgMemoryState {
  connected: boolean;
  server: string | null;
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
}

export interface OrgMemoryBridge {
  state(): Promise<OrgMemoryState>;
  connect(input: { server: string; token: string }): Promise<OrgMemoryState>;
  sync(): Promise<OrgMemoryState>;
  erase(): Promise<OrgMemoryState>;
  writeObsidianConfig(): Promise<OrgMemoryState>;
  openInObsidian(): Promise<boolean>;
}

/** The Perspicax console page where a person mints their memory sync token. */
export function tokenPageUrl(server: string | null | undefined): string | null {
  if (!server) return null;
  try {
    const url = new URL(server);
    return `${url.origin}/console/memory/sync`;
  } catch {
    return null;
  }
}

/** The address to suggest: the organization's Perspicax when the server
 * is signed in with it. */
export function suggestedServer(issuer: string | null | undefined): string {
  if (!issuer) return "";
  try {
    return new URL(issuer).origin;
  } catch {
    return "";
  }
}

/** Where the page stands. */
export type OrgMemoryPhase = "disconnected" | "connected" | "synced";

export function orgMemoryPhase(state: OrgMemoryState | null): OrgMemoryPhase {
  if (!state?.connected) return "disconnected";
  return state.cloned && state.lastSyncAt ? "synced" : "connected";
}

/** The items still waiting, then the ones decided lately (refused first). */
export function orderedItems(items: OrgMemoryItem[]): OrgMemoryItem[] {
  const rank = (i: OrgMemoryItem) => (i.state === "pending" ? 0 : i.state === "refused" ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** The tiers whose last sync needs the person: a refusal, a conflict, an
 * error. */
export function tiersNeedingAttention(state: OrgMemoryState | null): OrgMemoryTier[] {
  return (state?.tiers ?? []).filter((t) => t.status === "refused" || t.status === "conflict" || t.status === "error");
}
