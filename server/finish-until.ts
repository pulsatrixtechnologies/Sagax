// The person's own condition for one bot: "do not finish until...".
// One sentence. It is not a task list. Empty means off.
// The same sentence is put back onto a compaction summary, because a fold
// would otherwise drop it with the older turns.
//
// #1329 (2026-10-29): the condition is checked, not only said. The bot ends
// a reply with a marker once the condition is true (or when it cannot go on
// without the person). After each 1:1 turn of a bot with a condition, Sagax
// reads that marker (FinishUntilRuns.settle): no marker means "not met", and
// Sagax starts the next turn on its own in the same conversation, up to the
// bot's bound (finishUntilMaxRounds, default 5). A marker was chosen over a
// second judging call: it costs nothing, it is read from the same reply the
// person sees, and the bot is the one that ran the checks (tests, a file, a
// reply) the condition names. The marker never reaches the person.

import {
  finishUntilRounds,
  type FinishUntilLine,
} from "../shared/finish-until-line.ts";
export { withoutFinishUntilMarker, finishUntilRounds } from "../shared/finish-until-line.ts";

export const FINISH_UNTIL_MAX = 400;

/** One line, or empty when the person has not set a condition. */
export function finishUntilText(value: string | null | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, FINISH_UNTIL_MAX);
}

/** The line a turn reads. Empty when the condition is off. */
export function finishUntilPrompt(value: string | null | undefined): string {
  const text = finishUntilText(value);
  if (!text) return "";
  return [
    `Do not finish until: ${text}`,
    "This is the person's own condition for this bot. It is not a task list. Keep going until it is true, then you may finish. A compaction does not retire it.",
    "Sagax checks it after each of your replies. When the condition is true, end your reply with exactly this line, with a short detail in it:",
    '<sagax-finish>{"status":"met","detail":"how you know it is true"}</sagax-finish>',
    "When you cannot make it true without the person (a decision, an access, an answer), say what you need and end your reply with:",
    '<sagax-finish>{"status":"blocked","detail":"what you need"}</sagax-finish>',
    "Without that line Sagax starts your next turn on its own to keep going. The person never sees the line. Do not write it before the condition is actually true or you are actually blocked.",
  ].join("\n");
}

/** Put the condition back on a summary that no longer contains it. */
export function remindAfterCompaction(summary: string, value: string | null | undefined): string {
  const line = finishUntilPrompt(value).split("\n")[0] ?? "";
  if (!line || summary.includes(line)) return summary;
  return `${summary}\n\n${line}`;
}

export interface FinishUntilOutcome {
  status: "met" | "blocked";
  detail: string;
}

const MARKER = /<sagax-finish>\s*(\{[\s\S]*?\})\s*<\/sagax-finish>/g;

/** The last marker of a reply, or null when it has none (or none valid). */
export function finishUntilOutcome(text: string): FinishUntilOutcome | null {
  if (!text.includes("<sagax-finish>")) return null;
  let found: FinishUntilOutcome | null = null;
  for (const match of text.matchAll(MARKER)) {
    try {
      const parsed = JSON.parse(match[1]!) as { status?: unknown; detail?: unknown };
      if (parsed.status !== "met" && parsed.status !== "blocked") continue;
      const detail = typeof parsed.detail === "string" ? parsed.detail.replace(/\s+/g, " ").trim().slice(0, 240) : "";
      found = { status: parsed.status, detail };
    } catch {
      // a broken marker is no marker
    }
  }
  return found;
}

/** The words of a relaunch. They reach the model only, never the transcript. */
export function finishUntilContinuePrompt(condition: string, round: number, max: number): string {
  return [
    `The condition is not met yet. Do not finish until: ${finishUntilText(condition)}`,
    `Sagax started this turn on its own (relaunch ${round} of ${max}). Pick up where you left off and keep working toward it. Do not repeat what is already done.`,
    'When it is true, end your reply with <sagax-finish>{"status":"met","detail":"..."}</sagax-finish>. When you need the person, end it with <sagax-finish>{"status":"blocked","detail":"..."}</sagax-finish>.',
  ].join("\n");
}

export type FinishUntilStep =
  | { kind: "none" }
  | { kind: "relaunch"; line: FinishUntilLine; prompt: string }
  | { kind: "met" | "blocked" | "limit" | "stopped"; line: FinishUntilLine };

/** Per conversation: relaunches spent and the marker of the turn that just
 * ran. Memory only: a restart forgets a count, never the condition. */
export class FinishUntilRuns {
  private readonly spent = new Map<string, number>();
  private readonly outcomes = new Map<string, FinishUntilOutcome>();

  /** Read one reply of the running turn. The last marker wins. */
  noteReply(threadId: string, text: string): void {
    const outcome = finishUntilOutcome(text);
    if (outcome) this.outcomes.set(threadId, outcome);
  }

  /** Relaunches already spent in this conversation since the person last wrote. */
  rounds(threadId: string): number {
    return this.spent.get(threadId) ?? 0;
  }

  /** The person wrote: a fresh count, and no marker carried over. */
  reset(threadId: string): void {
    this.spent.delete(threadId);
    this.outcomes.delete(threadId);
  }

  /** A turn settled. Says what Sagax does next and counts a relaunch when
   * it is one. A stop by the person, a failed turn, a met or blocked marker
   * and the bound each end the run. */
  settle(threadId: string, args: { condition: string | null | undefined; maxRounds?: number | null; ok: boolean; stopped: boolean }): FinishUntilStep {
    const outcome = this.outcomes.get(threadId);
    const spent = this.rounds(threadId);
    this.outcomes.delete(threadId);
    const condition = finishUntilText(args.condition);
    if (!condition) {
      this.reset(threadId);
      return { kind: "none" };
    }
    const max = finishUntilRounds(args.maxRounds);
    if (args.stopped) {
      this.reset(threadId);
      return spent > 0 ? { kind: "stopped", line: { status: "stopped", condition, round: spent, max } } : { kind: "none" };
    }
    if (!args.ok) {
      this.reset(threadId);
      return { kind: "none" };
    }
    if (outcome?.status === "blocked") {
      this.reset(threadId);
      return { kind: "blocked", line: { status: "blocked", condition, max, ...(outcome.detail ? { detail: outcome.detail } : {}) } };
    }
    if (outcome?.status === "met") {
      this.reset(threadId);
      // A first reply that meets it needs no row: nothing was relaunched.
      return spent > 0
        ? { kind: "met", line: { status: "met", condition, round: spent, max, ...(outcome.detail ? { detail: outcome.detail } : {}) } }
        : { kind: "none" };
    }
    if (spent >= max) {
      this.reset(threadId);
      return { kind: "limit", line: { status: "limit", condition, round: spent, max } };
    }
    const round = spent + 1;
    this.spent.set(threadId, round);
    return { kind: "relaunch", line: { status: "relaunch", condition, round, max }, prompt: finishUntilContinuePrompt(condition, round, max) };
  }
}
