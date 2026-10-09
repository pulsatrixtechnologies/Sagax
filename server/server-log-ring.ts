// The server log tail (2026-10-08, the Perspicax console's Logs page): the
// last lines this process wrote to its console, kept in memory, secrets
// redacted when they are captured. A container's log driver keeps the
// whole log; this is what an admin reads without a shell on the host.
//
// Bounded twice: at most 2,000 lines, each at most 2,000 characters. A
// restart starts empty. Nothing here is written to disk.
import { format } from "node:util";

import { redactSecretsInText } from "./redact.ts";

export type LogLevel = "info" | "warn" | "error";
export const LOG_LEVELS: readonly LogLevel[] = ["info", "warn", "error"];
const RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

export interface LogLine {
  /** Monotonic within this process, the paging cursor. */
  seq: number;
  at: number;
  level: LogLevel;
  /** The leading `[tag]` of the line, when it has one ("engines", "omb-turn"). */
  area: string | null;
  message: string;
}

export const LOG_RING_MAX_LINES = 2_000;
export const LOG_LINE_MAX_CHARS = 2_000;
const AREA = /^\[([A-Za-z0-9_.:/-]{1,40})\]\s*/;
/** Terminal colour codes (ESC [ ... m). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export class ServerLogRing {
  private readonly lines: LogLine[] = [];
  private seq = 0;
  private readonly max: number;
  private readonly now: () => number;

  constructor(options: { max?: number; now?: () => number } = {}) {
    this.max = options.max ?? LOG_RING_MAX_LINES;
    this.now = options.now ?? Date.now;
  }

  push(level: LogLevel, text: string): void {
    const clean = redactSecretsInText(text.replace(ANSI, ""));
    for (const raw of clean.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const area = AREA.exec(raw);
      const message = (area ? raw.slice(area[0].length) : raw);
      this.lines.push({
        seq: ++this.seq,
        at: this.now(),
        level,
        area: area?.[1] ?? null,
        message: message.length > LOG_LINE_MAX_CHARS ? `${message.slice(0, LOG_LINE_MAX_CHARS - 3)}...` : message,
      });
    }
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }

  /** Newest first: lines at `level` or above, older than `before` (a seq),
   * at most `limit`; `next` is the seq to pass as `before`, or null. */
  read(input: { level?: LogLevel | null; limit: number; before?: number | null }): { lines: LogLine[]; next: number | null } {
    const floor = RANK[input.level ?? "info"];
    const out: LogLine[] = [];
    for (let index = this.lines.length - 1; index >= 0; index--) {
      const line = this.lines[index]!;
      if (input.before && line.seq >= input.before) continue;
      if (RANK[line.level] < floor) continue;
      if (out.length === input.limit) return { lines: out, next: out.at(-1)!.seq };
      out.push(line);
    }
    return { lines: out, next: null };
  }
}

/** Mirror console.log, info, warn and error into the ring; the original
 * output is untouched. Returns the undo. */
export function captureConsole(ring: ServerLogRing, target: Pick<Console, "log" | "info" | "warn" | "error"> = console): () => void {
  const original = { log: target.log, info: target.info, warn: target.warn, error: target.error };
  const wrap = (level: LogLevel, fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
    fn.apply(target, args);
    try {
      ring.push(level, format(...args));
    } catch {
      /* the tail must never break logging */
    }
  };
  target.log = wrap("info", original.log);
  target.info = wrap("info", original.info);
  target.warn = wrap("warn", original.warn);
  target.error = wrap("error", original.error);
  return () => Object.assign(target, original);
}
