// "Download logs" (Settings > General > Advanced, 2026-10-16): one text file
// of the recent logs, saved where the person picks, never sent anywhere.
// Sections: the app, the server's log window (server-log-ring.ts on disk:
// previous.jsonl then current.jsonl), the server.log tail, the window's own
// console (src/lib/console-ring.ts), the updater log and the crash events.
// The server's window and the console were redacted when they were kept
// (shared/redact.ts); every line goes through redactSecretsInLine here again
// before it reaches the file, so a collector's mistake still cannot leak a
// credential. Pure, so the redaction is unit tested without Electron.
import { redactSecretsInLine } from "./diagnostics.mjs";

export const RENDERER_LINES_MAX = 1_000;
export const RENDERER_LINE_MAX_CHARS = 4_000;
const SERVER_RING_MAX_LINES = 2_000;
const APP_KEYS = ["version", "platform", "arch", "osRelease", "electron", "node", "packaged", "uptimeSeconds"];

/** The renderer's lines, checked: strings only, bounded in count and length. */
export function sanitizeRendererLines(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line) => typeof line === "string")
    .slice(-RENDERER_LINES_MAX)
    .map((line) => (line.length > RENDERER_LINE_MAX_CHARS ? `${line.slice(0, RENDERER_LINE_MAX_CHARS)}…` : line));
}

/** server-log-ring JSON lines -> "ISO LEVEL [area] message", oldest first.
 * A line that is not one of the ring's is dropped, never copied raw. */
export function formatServerRing(jsonl) {
  const out = [];
  for (const raw of String(jsonl ?? "").split("\n")) {
    if (!raw.trim()) continue;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!value || typeof value.message !== "string" || typeof value.at !== "number" || !Number.isFinite(value.at)) continue;
    const level = value.level === "warn" || value.level === "error" ? value.level : "info";
    const area = typeof value.area === "string" && /^[A-Za-z0-9_.:/-]{1,40}$/.test(value.area) ? `[${value.area}] ` : "";
    let at;
    try {
      at = new Date(value.at).toISOString();
    } catch {
      continue;
    }
    out.push(`${at} ${level.toUpperCase()} ${area}${value.message}`);
  }
  return out.slice(-SERVER_RING_MAX_LINES);
}

function section(lines, title, body, empty) {
  lines.push(`## ${title}`);
  const text = Array.isArray(body) ? body.join("\n") : String(body ?? "");
  if (text.trim()) {
    for (const line of text.split(/\r?\n/)) lines.push(redactSecretsInLine(line));
  } else {
    lines.push(empty);
  }
  lines.push("");
}

export function buildLogBundle({
  appInfo = {},
  serverRing = "",
  serverLogTail = "",
  rendererLines = [],
  updaterLogTail = "",
  desktopLogTail = "",
  now = new Date().toISOString(),
} = {}) {
  const lines = ["Sagax logs", `Generated: ${now}`, "Known credential patterns are masked in every section.", ""];
  lines.push("## App");
  for (const key of APP_KEYS) {
    const value = appInfo[key];
    if (value === undefined || value === null) continue;
    lines.push(redactSecretsInLine(`${key}=${String(value)}`));
  }
  lines.push("");
  section(lines, "Server log window (server-log-ring)", formatServerRing(serverRing), "(no server log window on this computer)");
  section(lines, "Server log tail (server.log)", serverLogTail, "(server.log unavailable)");
  section(lines, "Window console", sanitizeRendererLines(rendererLines), "(no console lines kept)");
  section(lines, "Updater log tail", updaterLogTail, "(updater log unavailable)");
  section(lines, "Desktop crash events", desktopLogTail, "(no desktop crash events)");
  return lines.join("\n");
}

export function logBundleFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `sagax-logs-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.txt`
  );
}
