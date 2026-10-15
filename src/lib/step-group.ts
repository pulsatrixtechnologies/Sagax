// One stretch of a bot's work as a single row: "Worked 2m 53s · 12 tools ·
// 5 failed". Opened, the steps in order, each on a row of the same kind,
// with the same step repeated back to back read once with a count ("Read a
// file ×3"). While the bot still works, the row says what it is doing now.
import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { isToolStep } from "@/lib/activity-runs";
import { readStep, stepDuration, stepPhase, type StepNameOf, type StepPhase } from "@/lib/step-label";

type ToolStep = Message & { tool: NonNullable<Message["tool"]> };

export type StepEntry =
  /** one tool step, or the same step repeated back to back */
  | { kind: "steps"; id: string; messages: ToolStep[]; label: string; target?: string; phase: StepPhase; durationMs?: number }
  /** anything else in the group (a settled turn's narration), as it is */
  | { kind: "message"; id: string; message: Message };

/** The steps in order, consecutive identical steps (same words, same
 * state) merged. A step still running is never merged into the ones before. */
export function mergeSteps(messages: readonly Message[], nameOf?: StepNameOf): StepEntry[] {
  const entries: StepEntry[] = [];
  for (const message of messages) {
    if (!isToolStep(message)) {
      entries.push({ kind: "message", id: message.id, message });
      continue;
    }
    const reading = readStep(message.tool, nameOf);
    const phase = stepPhase(message.tool);
    const last = entries.at(-1);
    if (last?.kind === "steps" && last.label === reading.label && last.phase === phase && phase !== "running") {
      last.messages.push(message);
      if (last.target !== reading.target) last.target = undefined;
      last.durationMs = last.durationMs !== undefined && message.tool.durationMs !== undefined ? last.durationMs + message.tool.durationMs : undefined;
      continue;
    }
    entries.push({
      kind: "steps",
      id: message.id,
      messages: [message],
      label: reading.label,
      target: reading.target,
      phase,
      durationMs: message.tool.durationMs,
    });
  }
  return entries;
}

export type StepGroupSummary = {
  /** tool steps in the group */
  tools: number;
  /** of which failed */
  failed: number;
  /** the step running now, when the bot still works */
  running?: ToolStep;
};

export function summarizeSteps(messages: readonly Message[]): StepGroupSummary {
  let tools = 0;
  let failed = 0;
  let running: ToolStep | undefined;
  for (const message of messages) {
    if (!isToolStep(message)) continue;
    tools += 1;
    if (message.tool.ok === false) failed += 1;
    if (message.tool.ok === undefined) running = message;
  }
  return { tools, failed, running };
}

export type StepGroupWords = {
  /** "Worked 2m 53s", or the step running now */
  label: string;
  /** what the running step acts on */
  target?: string;
  /** "12 tools" */
  tools?: string;
  /** "5 failed", drawn in a quiet danger colour */
  failed?: string;
  phase: StepPhase;
};

/** The group's one line, in the person's language. */
export function stepGroupWords(summary: StepGroupSummary, elapsedMs: number | undefined, nameOf?: StepNameOf): StepGroupWords {
  const tools = summary.tools > 0 ? t(summary.tools === 1 ? "step.turn.tools.one" : "step.turn.tools.many", { count: summary.tools }) : undefined;
  const failed = summary.failed > 0 ? t(summary.failed === 1 ? "step.turn.failed.one" : "step.turn.failed.many", { count: summary.failed }) : undefined;
  if (summary.running) {
    const reading = readStep(summary.running.tool, nameOf);
    return { label: reading.label, target: reading.target, tools, failed, phase: "running" };
  }
  const elapsed = elapsedMs !== undefined && elapsedMs >= 1_000 ? stepDuration(elapsedMs) : undefined;
  return {
    label: elapsed ? t("step.turn.workedFor", { elapsed }) : t("step.turn.worked"),
    tools,
    failed,
    phase: "done",
  };
}
