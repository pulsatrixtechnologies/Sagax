/** Terminal-capable resources: one abstraction for every shell provider. */

export const TERMINAL_IDLE_MS = 15 * 60_000;
export const TERMINAL_MAX_SESSIONS_PER_PERSON = 3;
export const TERMINAL_WS_MAX_FRAME_BYTES = 256 * 1024;

/** Stable provider ids; adapters register under these kinds. */
export type TerminalProviderKind =
  | "ssh"
  | "unraid"
  | "sandbox"
  | "docker-exec"
  | "vps"
  | "local-vm"
  | "desktop"
  | "cloud-vm"
  | "test";

export type TerminalResourceStatus = "online" | "offline" | "unknown";

/** A resource the person may open in the in-chat terminal. Credentials never
 * leave the server; the client only sees labels and ids. */
export interface TerminalResource {
  id: string;
  provider: TerminalProviderKind;
  /** Short title ("Serveur unRAID", "Bureau cloud"). */
  label: string;
  /** Host line in the widget header (hostname or alias). */
  hostLabel: string;
  status: TerminalResourceStatus;
  /** Québec-friendly hint when offline. */
  statusNote?: string;
  /** Bot that last offered this resource in the thread, when scoped. */
  botId?: string;
}

export interface TerminalSessionPublic {
  id: string;
  resourceId: string;
  provider: TerminalProviderKind;
  hostLabel: string;
  label: string;
  status: "connecting" | "live" | "ended";
  endedReason?: "idle" | "closed" | "error" | "denied";
  openedAt: number;
  lastActivityAt: number;
  /** When true, the bot may send input only if the person enabled it. */
  botInputAllowed: boolean;
}

/** Embedded terminal block in the chat transcript. */
export interface TerminalEmbed {
  sessionId: string;
  resourceId: string;
  provider: TerminalProviderKind;
  hostLabel: string;
  label: string;
  status: TerminalSessionPublic["status"] | "ended";
  endedReason?: TerminalSessionPublic["endedReason"];
}

export function terminalResourceKey(provider: TerminalProviderKind, id: string): string {
  return `${provider}:${id}`;
}

export function parseTerminalResourceKey(key: string): { provider: TerminalProviderKind; id: string } | null {
  const split = key.indexOf(":");
  if (split <= 0) return null;
  const provider = key.slice(0, split) as TerminalProviderKind;
  const id = key.slice(split + 1);
  if (!id) return null;
  return { provider, id };
}
