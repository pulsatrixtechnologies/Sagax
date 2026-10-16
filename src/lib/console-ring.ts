// The window's own console, kept for "Download logs" (Settings > General >
// Advanced): the last lines this page wrote (log, info, warn, error) and its
// uncaught errors, in memory only, never sent anywhere. Every line is
// redacted when it is kept (shared/redact.ts, the server's own redaction),
// and the bundle redacts again on the way out (electron/log-bundle.mjs).
import { redactSecretsInText } from "../../shared/redact";

export const CONSOLE_RING_MAX_LINES = 500;
export const CONSOLE_LINE_MAX_CHARS = 2_000;

type Level = "log" | "info" | "warn" | "error";
const LEVELS: readonly Level[] = ["log", "info", "warn", "error"];

const lines: string[] = [];
let installed = false;

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** One kept line: time, level, the arguments, redacted and bounded. */
export function formatConsoleLine(level: string, args: readonly unknown[], at = new Date()): string {
  const text = args.map(describe).join(" ");
  const bounded = text.length > CONSOLE_LINE_MAX_CHARS ? `${text.slice(0, CONSOLE_LINE_MAX_CHARS)}…` : text;
  return `${at.toISOString()} ${level.toUpperCase()} ${redactSecretsInText(bounded)}`;
}

export function rememberConsoleLine(level: string, args: readonly unknown[], at?: Date): void {
  try {
    lines.push(formatConsoleLine(level, args, at));
    if (lines.length > CONSOLE_RING_MAX_LINES) lines.splice(0, lines.length - CONSOLE_RING_MAX_LINES);
  } catch {
    // keeping a log line must never break the page
  }
}

/** The kept lines, oldest first. */
export function consoleRingLines(): string[] {
  return [...lines];
}

export function clearConsoleRing(): void {
  lines.length = 0;
}

/** Wraps the console once; the original methods still print. */
export function installConsoleRing(target: Pick<Console, Level> = console, events: Pick<Window, "addEventListener"> | null = typeof window === "undefined" ? null : window): void {
  if (installed) return;
  installed = true;
  for (const level of LEVELS) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      rememberConsoleLine(level, args);
      original(...args);
    };
  }
  events?.addEventListener("error", (event) => {
    const failure = event as ErrorEvent;
    rememberConsoleLine("error", [failure.error ?? failure.message ?? "uncaught error"]);
  });
  events?.addEventListener("unhandledrejection", (event) => {
    rememberConsoleLine("error", ["unhandled rejection", (event as PromiseRejectionEvent).reason]);
  });
}
