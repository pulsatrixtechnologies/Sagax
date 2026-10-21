/** A Tailcat remote-support session as the chat and the bot panel may show it.
 * The tunnel address, the node key and the client key never appear here. */

export const REMOTE_SESSION_ID = /^[a-f0-9]{12}$/;
export const REMOTE_SESSION_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export type RemoteSessionOs = "windows" | "macos" | "linux";
export type RemoteSessionState = "connected" | "ended";

export interface RemoteSessionSuggestion {
  id: string;
}

/** Facts safe to put in the chat. Strings are already trimmed and bounded. */
export interface RemoteSessionFacts {
  hostname?: string;
  osName?: string;
  user?: string;
  model?: string;
  serial?: string;
  cpu?: string;
  /** Display string, for example "16 Go". */
  ram?: string;
  /** Display string, for example "120 Go libres sur 476 Go". */
  disk?: string;
  /** 0 to 100 when both sizes were read. */
  diskFreePercent?: number;
  ramGb?: number;
}

export interface RemoteSessionView {
  id: string;
  code: string;
  state: RemoteSessionState;
  os: RemoteSessionOs;
  elevated: boolean;
  endAt: string;
  hostname?: string;
  osName?: string;
  user?: string;
  model?: string;
  serial?: string;
  cpu?: string;
  ram?: string;
  disk?: string;
  /** The session the Computer tab is showing. Absent on the others. */
  focused?: boolean;
  suggestions: RemoteSessionSuggestion[];
}

const TUNNEL = /tc[0-9A-Za-z_-]{24,}/g;
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Drop a tunnel token and control characters before anything is stored or shown. */
export function publicText(value: unknown, max = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(TUNNEL, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, max);
}

export function parseRemoteSessionId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return REMOTE_SESSION_ID.test(id) ? id : null;
}

export function parseRemoteSessionCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase().replace(/-/g, "") : "";
  return REMOTE_SESSION_CODE.test(code) ? code : null;
}

export function parseRemoteSessionOs(value: unknown): RemoteSessionOs | null {
  return value === "windows" || value === "macos" || value === "linux" ? value : null;
}

/** "17 h 15" in the given zone (the viewer's zone when omitted). */
export function formatEndLabel(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("fr-CA", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  if (!hour || !minute) return "";
  return `${hour} h ${minute}`;
}

export function formatGigabytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text} Go`;
}

/** "120 Go libres sur 476 Go". Empty when the sizes are missing. */
export function formatDisk(freeGb: number, totalGb: number): { text: string; freePercent?: number } {
  if (!Number.isFinite(freeGb) || !Number.isFinite(totalGb) || totalGb <= 0 || freeGb < 0) return { text: "" };
  const text = `${formatGigabytes(freeGb)} libres sur ${formatGigabytes(totalGb)}`;
  return { text, freePercent: Math.round((freeGb / totalGb) * 1000) / 10 };
}

const INVENTORY_KEYS = new Set([
  "hostname", "user", "model", "serial", "cpu", "os", "admin",
  "ramBytes", "diskFreeKb", "diskTotalKb",
]);

/** Read the fixed `key=value` lines a probe prints. Anything else is ignored. */
export function parseInventory(stdout: string): {
  hostname?: string;
  user?: string;
  model?: string;
  serial?: string;
  cpu?: string;
  osName?: string;
  elevated?: boolean;
  ramGb?: number;
  diskFreeGb?: number;
  diskTotalGb?: number;
} {
  const out: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const split = line.indexOf("=");
    if (split <= 0) continue;
    const key = line.slice(0, split).trim();
    if (!INVENTORY_KEYS.has(key)) continue;
    const value = publicText(line.slice(split + 1), 200);
    if (value) out[key] = value;
  }
  const ramBytes = Number(out.ramBytes);
  const freeKb = Number(out.diskFreeKb);
  const totalKb = Number(out.diskTotalKb);
  const admin = out.admin?.toLowerCase();
  return {
    ...(out.hostname ? { hostname: out.hostname } : {}),
    ...(out.user ? { user: out.user } : {}),
    ...(out.model ? { model: out.model } : {}),
    ...(out.serial ? { serial: out.serial } : {}),
    ...(out.cpu ? { cpu: out.cpu } : {}),
    ...(out.os ? { osName: out.os } : {}),
    ...(admin === "true" || admin === "false" ? { elevated: admin === "true" } : {}),
    ...(Number.isFinite(ramBytes) && ramBytes > 0 ? { ramGb: ramBytes / (1024 ** 3) } : {}),
    ...(Number.isFinite(freeKb) && freeKb >= 0 ? { diskFreeGb: freeKb / (1024 ** 2) } : {}),
    ...(Number.isFinite(totalKb) && totalKb > 0 ? { diskTotalGb: totalKb / (1024 ** 2) } : {}),
  };
}

/** Short diagnostic hints from the facts we actually read. Ids only: the UI translates them. */
export function remoteSessionSuggestions(facts: RemoteSessionFacts, elevated: boolean): RemoteSessionSuggestion[] {
  const ids: string[] = [];
  if (facts.diskFreePercent !== undefined && facts.diskFreePercent < 15) ids.push("disk-critical");
  else if (facts.diskFreePercent !== undefined && facts.diskFreePercent < 30) ids.push("disk-low");
  if (facts.ramGb !== undefined && facts.ramGb < 8) ids.push("ram-low");
  if (!elevated) ids.push("rights");
  ids.push("cpu", "errors", "startup");
  return ids.slice(0, 5).map((id) => ({ id }));
}

/** A download path the person typed. No traversal, no tunnel token, no control characters. */
export function safeRemotePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.replace(CONTROL, "").trim();
  if (!path || path.length > 400) return null;
  if (TUNNEL.test(path)) return null;
  TUNNEL.lastIndex = 0;
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => part === "..")) return null;
  return path;
}

/** A file name we choose the destination folder for. */
export function safeUploadName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(CONTROL, "").trim();
  if (!name || name.length > 120 || name.includes("/") || name.includes("\\") || name.startsWith(".")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(name)) return null;
  return name;
}
