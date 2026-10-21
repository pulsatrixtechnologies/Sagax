// Stuck-loop detector for agent runs. A run that repeats the same tool call,
// gets the same result or the same error again and again, or cycles through
// a short sequence of calls whose results never change, is not making
// progress: today only spend and depth caps end it. This module is pure and
// engine-independent: it is fed one settled tool call at a time and answers
// whether the run is stuck, with a reason a person can read.
//
// RepeatDetector (server/repeat-detector.ts) only observes and shows a chip;
// this one decides that the run stops (makeLoopStopSubscriber).
import { createHash } from "node:crypto";
import { z } from "zod";
import type { RuntimeEvent } from "../shared/runtime-events.ts";

export interface LoopThresholds {
  /** The same tool with the same input, this many times in a row, whatever
   * it returned (default 5: a poll may legitimately repeat a few times). */
  identicalCall: number;
  /** The same tool with the same input returning the same result, this many
   * times in a row (default 3). */
  identicalResult: number;
  /** The same tool failing with the same error this many times in a row,
   * whatever its input (default 3). */
  sameError: number;
  /** A sequence of 2 to maxPeriod calls repeating this many times with
   * unchanged results (default 6). */
  cycles: number;
  /** The longest repeating sequence looked for (default 4). */
  maxPeriod: number;
}

export const DEFAULT_LOOP_THRESHOLDS: Readonly<LoopThresholds> = Object.freeze({
  identicalCall: 5,
  identicalResult: 3,
  sameError: 3,
  cycles: 6,
  maxPeriod: 4,
});

/** `loopDetector` in config.json. Every field optional; absent means the
 * default, `enabled: false` turns the detector off. */
export const loopDetectorConfigSchema = z.object({
  enabled: z.boolean().optional(),
  identicalCall: z.number().int().min(2).max(1_000).optional(),
  identicalResult: z.number().int().min(2).max(1_000).optional(),
  sameError: z.number().int().min(2).max(1_000).optional(),
  cycles: z.number().int().min(2).max(100).optional(),
  maxPeriod: z.number().int().min(2).max(10).optional(),
}).strict();

export type LoopDetectorConfig = z.infer<typeof loopDetectorConfigSchema>;

/** The thresholds a config gives, or null when the detector is off. */
export function loopThresholds(config: LoopDetectorConfig | undefined): LoopThresholds | null {
  if (config?.enabled === false) return null;
  return {
    identicalCall: config?.identicalCall ?? DEFAULT_LOOP_THRESHOLDS.identicalCall,
    identicalResult: config?.identicalResult ?? DEFAULT_LOOP_THRESHOLDS.identicalResult,
    sameError: config?.sameError ?? DEFAULT_LOOP_THRESHOLDS.sameError,
    cycles: config?.cycles ?? DEFAULT_LOOP_THRESHOLDS.cycles,
    maxPeriod: config?.maxPeriod ?? DEFAULT_LOOP_THRESHOLDS.maxPeriod,
  };
}

export type LoopKind = "identical-call" | "identical-result" | "same-error" | "cycle";

export interface LoopVerdict {
  stuck: true;
  kind: LoopKind;
  reason: string;
  count: number;
}

export interface ToolCallObservation {
  tool: string;
  /** Raw input: an object, or a string (JSON text is parsed first). */
  input: unknown;
  /** The result text or value; hashed, never kept. */
  result?: unknown;
  error?: boolean;
}

/** JSON with object keys sorted at every depth, so key order never makes
 * two inputs differ. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function normalize(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try { return JSON.parse(text); } catch { /* plain text */ }
  }
  return text.replace(/\s+/g, " ");
}

export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(normalize(value))).digest("hex").slice(0, 24);
}

interface Entry { tool: string; call: string; result: string; error: boolean }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export class LoopDetector {
  private readonly thresholds: LoopThresholds;
  private readonly history: Entry[] = [];
  private readonly keep: number;
  private verdict: LoopVerdict | null = null;

  constructor(thresholds: LoopThresholds) {
    this.thresholds = thresholds;
    this.keep = Math.max(thresholds.identicalCall, thresholds.identicalResult, thresholds.sameError,
      thresholds.maxPeriod * thresholds.cycles) + 1;
  }

  /** The first stuck verdict, once reached (it stays). */
  get stuck(): LoopVerdict | null {
    return this.verdict;
  }

  /** Record one settled call. Returns a verdict the first time the run is
   * found stuck, null otherwise (and on every later call). */
  observe(observation: ToolCallObservation): LoopVerdict | null {
    if (this.verdict) return null;
    const tool = observation.tool.trim() || "tool";
    const call = `${tool}\u0000${digest(observation.input)}`;
    this.history.push({ tool, call, result: digest(observation.result ?? ""), error: observation.error === true });
    if (this.history.length > this.keep) this.history.splice(0, this.history.length - this.keep);
    this.verdict = this.check();
    return this.verdict;
  }

  private tail(match: (entry: Entry, last: Entry) => boolean): number {
    const last = this.history.at(-1)!;
    let count = 0;
    for (let i = this.history.length - 1; i >= 0 && match(this.history[i]!, last); i--) count++;
    return count;
  }

  private check(): LoopVerdict | null {
    const t = this.thresholds;
    const last = this.history.at(-1)!;
    if (last.error) {
      const count = this.tail((e, l) => e.error && e.tool === l.tool && e.result === l.result);
      if (count >= t.sameError) {
        return { stuck: true, kind: "same-error", count,
          reason: `${last.tool} failed with the same error ${plural(count, "time")} in a row` };
      }
    }
    const sameResult = this.tail((e, l) => e.call === l.call && e.result === l.result && e.error === l.error);
    if (sameResult >= t.identicalResult) {
      return { stuck: true, kind: "identical-result", count: sameResult,
        reason: `${last.tool} returned the same result ${plural(sameResult, "time")} in a row for the same input` };
    }
    const sameCall = this.tail((e, l) => e.call === l.call);
    if (sameCall >= t.identicalCall) {
      return { stuck: true, kind: "identical-call", count: sameCall,
        reason: `the same ${last.tool} call with the same input ran ${plural(sameCall, "time")} in a row` };
    }
    return this.cycle();
  }

  /** A sequence of `period` calls (not all the same call) repeated `cycles`
   * times, each call returning what it returned the previous round. */
  private cycle(): LoopVerdict | null {
    const t = this.thresholds;
    const h = this.history;
    for (let period = 2; period <= t.maxPeriod; period++) {
      const span = period * t.cycles;
      if (h.length < span) break;
      const window = h.slice(h.length - span);
      const block = window.slice(0, period);
      if (block.every((e) => e.call === block[0]!.call)) continue;
      const repeats = window.every((e, i) => i < period
        || (e.call === window[i - period]!.call && e.result === window[i - period]!.result));
      if (!repeats) continue;
      const names = block.map((e) => e.tool).join(" → ");
      return { stuck: true, kind: "cycle", count: t.cycles,
        reason: `the calls ${names} repeated ${plural(t.cycles, "time")} with no change in their results` };
    }
    return null;
  }
}

/** The text recorded when a run is stopped for a loop. */
export function stuckLoopStopReason(verdict: LoopVerdict): string {
  return `stuck-loop: ${verdict.reason}`;
}

export interface LoopStopOptions {
  /** Read on each turn, so a config change applies to the next turn. */
  config: () => LoopDetectorConfig | undefined;
  /** Stop the thread's run with this reason. Called once per turn. */
  stop: (threadId: string, reason: string, verdict: LoopVerdict) => void;
  /** Events to leave out (another turn's late events and the like). */
  ignore?: (event: RuntimeEvent) => boolean;
}

interface PendingCall { tool: string; input: unknown }

/** A bus subscriber: pairs each tool call's start (name, input) with its
 * completion (result, error), feeds one LoopDetector per running turn and
 * stops the turn on the first stuck verdict. A call whose input is unknown
 * (a bare tool name) is not counted: two bare "Bash" may differ. */
export function makeLoopStopSubscriber(options: LoopStopOptions): (event: RuntimeEvent) => void {
  const detectors = new Map<string, LoopDetector | null>();
  const pending = new Map<string, Map<string, PendingCall>>();
  const forget = (threadId: string) => {
    detectors.delete(threadId);
    pending.delete(threadId);
  };
  return (event) => {
    if (options.ignore?.(event)) return;
    const threadId = event.threadId;
    if (event.type === "turn.completed" || event.type === "session.exited") return forget(threadId);
    if (event.type === "item.started" && event.itemType === "tool") {
      const title = (event.title ?? "").trim();
      const input = event.input ?? event.summary;
      const countable = input !== undefined ? input : /\s|\//.test(title) ? title : undefined;
      if (countable === undefined) return;
      let calls = pending.get(threadId);
      if (!calls) pending.set(threadId, (calls = new Map()));
      if (calls.size >= 64) calls.delete(calls.keys().next().value!);
      calls.set(event.itemId ?? "", { tool: title.split(/\s/)[0] || "tool", input: countable });
      return;
    }
    if (event.type !== "item.completed" || event.itemType !== "tool") return;
    const calls = pending.get(threadId);
    const key = event.itemId ?? "";
    const call = calls?.get(key);
    if (!call) return;
    calls!.delete(key);
    let detector = detectors.get(threadId);
    if (detector === undefined) {
      const thresholds = loopThresholds(options.config());
      detector = thresholds ? new LoopDetector(thresholds) : null;
      detectors.set(threadId, detector);
    }
    const verdict = detector?.observe({ tool: call.tool, input: call.input, result: event.output, error: !event.ok });
    if (verdict) options.stop(threadId, stuckLoopStopReason(verdict), verdict);
  };
}
