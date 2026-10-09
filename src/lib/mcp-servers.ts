// The app-wide MCP server list (Plugins → MCP servers), shared by every
// place that shows it per bot, such as the Access section's switches.
// One fetch, cached for the window; `refresh` after
// the Plugins panel changes the list.
import { useEffect, useSyncExternalStore } from "react";

import { api } from "@/state/store";

export interface McpServerSummary {
  name: string;
  enabled: boolean;
  /** its saved sign-ins, the default account first; absent with one or none */
  accounts?: Array<{ id: string; label?: string; connected: boolean }>;
}

/** A server as the list route answers it (or as already summed up). */
interface McpServerInput {
  name: string;
  enabled: boolean;
  accounts?: Array<{ id: string; label?: string; auth?: string; connected?: boolean }>;
}

function summary(server: McpServerInput): McpServerSummary {
  const accounts = (server.accounts ?? []).map((account) => ({
    id: account.id,
    ...(account.label ? { label: account.label } : {}),
    connected: account.connected ?? account.auth === "connected",
  }));
  return { name: server.name, enabled: Boolean(server.enabled), ...(accounts.length > 1 ? { accounts } : {}) };
}

let cached: { servers: McpServerSummary[] | null; error: boolean } = { servers: null, error: false };
let inflight: Promise<McpServerSummary[]> | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const snapshot = () => cached;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Publish an authoritative read or mutation result without another request. */
export function updateMcpServers(servers: McpServerInput[]): void {
  generation += 1;
  inflight = null;
  cached = { servers: servers.map(summary), error: false };
  for (const listener of listeners) listener();
}

export function loadMcpServers(force = false): Promise<McpServerSummary[]> {
  if (!force && cached.servers && !cached.error) return Promise.resolve(cached.servers);
  if (!force && inflight) return inflight;
  const requestGeneration = ++generation;
  inflight = api("/api/mcp/servers")
    .then((result) => {
      if (requestGeneration === generation) updateMcpServers(result.servers ?? []);
      return cached.servers ?? [];
    })
    .catch(() => {
      if (requestGeneration === generation) {
        cached = { ...cached, error: true };
        for (const listener of listeners) listener();
      }
      return cached.servers ?? [];
    })
    .finally(() => {
      if (requestGeneration === generation) inflight = null;
    });
  return inflight;
}

/** The list, or null until the first load settles. Re-renders when any
 * caller refreshes it. */
export function useMcpServers(): { servers: McpServerSummary[] | null; error: boolean; refresh: () => Promise<McpServerSummary[]> } {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    // Keep the instant cached view, but pick up edits from another window
    // or the config CLI whenever Access is opened again.
    void loadMcpServers(true);
  }, []);
  return { ...current, refresh: () => loadMcpServers(true) };
}

/** The servers a bot actually mounts: its own list when it has one (names
 * that no longer exist fall away), else every enabled server. Mirrors
 * server/config.ts customMcpServers so the controls and the turn agree. */
export function mcpServersForBot(all: McpServerSummary[], own: string[] | null | undefined): McpServerSummary[] {
  const enabled = all.filter((server) => server.enabled);
  if (own == null) return enabled;
  return enabled.filter((server) => own.includes(server.name));
}

/** A bot's account choices after picking `account` for `server`: the
 * default account is the absence of a choice, and no choice left is null
 * (how a clear travels over PATCH). */
export function withMcpAccount(current: Record<string, string> | null | undefined, server: string, account: string): Record<string, string> | null {
  const next = { ...current };
  if (account === "default") delete next[server];
  else next[server] = account;
  return Object.keys(next).length ? next : null;
}

/** The account a bot uses on a server: its choice while that account is
 * still saved, else the default one. */
export function mcpAccountFor(server: McpServerSummary, choices: Record<string, string> | null | undefined): string {
  const chosen = choices?.[server.name];
  return chosen && server.accounts?.some((account) => account.id === chosen) ? chosen : "default";
}
