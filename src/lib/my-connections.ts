// A person's own connections on an organization server (Settings > Mes
// connexions): their GitHub account and their own MCP servers
// (server/routes/person-connections.ts), and a bot's Claude Code plugins
// (server/routes/bot-plugins.ts). Nothing here ever holds a token the
// server sent: the server never sends one.
import { api } from "@/state/store";

export type GithubStatus =
  | { state: "none"; deviceFlow: boolean }
  | { state: "pending"; deviceFlow: true; userCode: string; verificationUri: string; expiresAt: number }
  | { state: "connected"; deviceFlow: boolean; login: string; name?: string; scopes?: string[]; via: "device" | "token"; connectedAt: number }
  | { state: "error"; deviceFlow: boolean; error: string };

export type PersonalAuthState = "connected" | "ready" | "needs_sign_in" | "needs_github" | "needs_token" | "expired" | "error" | "no_environment";

export type PersonalServer =
  | { name: string; kind: "remote"; type: "http" | "sse"; url: string; domain: string; auth: "none" | "token" | "oauth" | "github"; headerName?: string; tokenConfigured: boolean; enabled: boolean; addedAt: number; authState: PersonalAuthState; authError?: string; authPending?: boolean; authClient?: "needed" }
  | { name: string; kind: "stdio"; command: string; args: string[]; envKeys: string[]; runsIn: "environment"; enabled: boolean; addedAt: number; authState: PersonalAuthState };

export interface MyConnections {
  github: GithubStatus;
  servers: PersonalServer[];
  /** This server gives each person a server environment (commands run there). */
  sandbox: boolean;
  /** Perspicax `sagax_integrations: off`: an admin manages this person's
   * connections; they stay usable, read-only (only a sign-in again). */
  managedByAdmin?: boolean;
}

export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

export const loadMyConnections = () => api<MyConnections>("/api/me/connections");
export const startGithubDevice = () => api<{ userCode: string; verificationUri: string; expiresAt: number }>("/api/me/github/device", { method: "POST", body: "{}" });
export const connectGithubToken = (token: string) => api<{ github: GithubStatus }>("/api/me/github/token", { method: "POST", body: JSON.stringify({ token }) });
export const disconnectGithub = () => api<{ github: GithubStatus }>("/api/me/github", { method: "DELETE" });

export type NewPersonalServer =
  | { name: string; url: string; auth: "none" | "token" | "oauth" | "github"; token?: string; headerName?: string }
  | { name: string; command: string; args: string[]; env: Record<string, string> };

export const addPersonalServer = (server: NewPersonalServer) => api<{ servers: PersonalServer[] }>("/api/me/mcp/servers", { method: "POST", body: JSON.stringify(server) });
export const setPersonalServerEnabled = (name: string, enabled: boolean) =>
  api<{ servers: PersonalServer[] }>(`/api/me/mcp/servers/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
export const removePersonalServer = (name: string) => api<{ servers: PersonalServer[] }>(`/api/me/mcp/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
export const startPersonalServerSignIn = (name: string, client?: { clientId: string; clientSecret?: string }) =>
  api<{ authorizationUrl: string; redirectUri: string }>(`/api/me/mcp/servers/${encodeURIComponent(name)}/oauth/start`, { method: "POST", body: JSON.stringify(client ?? {}) });
export const disconnectPersonalServer = (name: string) => api<{ servers: PersonalServer[] }>(`/api/me/mcp/servers/${encodeURIComponent(name)}/oauth/disconnect`, { method: "POST", body: "{}" });

/** A name for a server from its address or command: lowercase, safe. */
export function suggestServerName(source: string): string {
  let base = source.trim();
  try {
    const url = new URL(base);
    base = url.hostname.replace(/^(?:www|mcp|api)\./, "").split(".")[0] ?? "";
  } catch {
    base = base.split(/[\s/@]+/).filter(Boolean).pop() ?? "";
  }
  const name = base.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 32);
  return name || "server";
}

/** "KEY=value" lines into variables; a line without "=" is refused. */
export function parseEnvLines(text: string): { ok: true; env: Record<string, string> } | { ok: false; line: string } {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const index = line.indexOf("=");
    if (index <= 0) return { ok: false, line };
    env[line.slice(0, index).trim()] = line.slice(index + 1);
  }
  return { ok: true, env };
}

/** Arguments typed on one line: spaces split them, quotes keep them whole. */
export function parseArgsLine(text: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of text.matchAll(pattern)) out.push(match[1] ?? match[2] ?? match[3] ?? "");
  return out;
}

// ── a bot's plugins ──────────────────────────────────────────────────────

export interface MarketplaceListing {
  name: string;
  source: string;
  description?: string;
  addedAt: number;
  updatedAt: number;
  plugins: Array<{ name: string; description?: string; version?: string; category?: string; installed: boolean; external: boolean }>;
}

export interface InstalledPlugin {
  key: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  enabled: boolean;
  removed: string[];
  declaredMcpServers: string[];
}

export interface BotPluginsView {
  marketplaces: MarketplaceListing[];
  plugins: InstalledPlugin[];
  policy: { mode: "any" } | { mode: "list"; allow: string[] };
  engine: { loadsPlugins: boolean };
  canChange: boolean;
  /** Perspicax `sagax_integrations: off`: an admin manages this person's
   * plugins (canChange is then false). */
  managedByAdmin?: boolean;
}

const pluginsPath = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/plugins`;
export const loadBotPlugins = (botId: string) => api<BotPluginsView>(pluginsPath(botId));
export const addMarketplace = (botId: string, source: string) => api<BotPluginsView>(`${pluginsPath(botId)}/marketplaces`, { method: "POST", body: JSON.stringify({ source }), timeoutMs: 180_000 });
export const updateMarketplace = (botId: string, name: string) => api<BotPluginsView>(`${pluginsPath(botId)}/marketplaces/${encodeURIComponent(name)}/update`, { method: "POST", timeoutMs: 180_000 });
export const removeMarketplace = (botId: string, name: string) => api<BotPluginsView>(`${pluginsPath(botId)}/marketplaces/${encodeURIComponent(name)}`, { method: "DELETE" });
export const installPlugin = (botId: string, marketplace: string, plugin: string) =>
  api<BotPluginsView>(`${pluginsPath(botId)}/install`, { method: "POST", body: JSON.stringify({ marketplace, plugin }), timeoutMs: 180_000 });
export const setPluginEnabled = (botId: string, key: string, enabled: boolean) =>
  api<BotPluginsView>(`${pluginsPath(botId)}/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
export const uninstallPlugin = (botId: string, key: string) => api<BotPluginsView>(`${pluginsPath(botId)}/${encodeURIComponent(key)}`, { method: "DELETE" });
