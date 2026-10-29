// The steps of a task as the sheet lists them (2026-10-29, task sheet
// redesign): the same step repeated back to back reads once with a count
// ("Run the routine action ×12"), a step still running or a sub-agent's
// step never merges, a failure never hides inside a run of successes, and
// the place a step ran (the person's computer, the server environment) is
// marked once, then only when it changes. Pure: the sheet, the routine
// run detail and any other list of tool calls draw from these groups.
import type { BotActivityStep } from "../../shared/bot-activity";
import { humanStepName, isSubagentStep, stepTree } from "./activity-steps";
import { workingStepFor, type WorkingStep } from "../../shared/working-step";

export type ActivityStepPhase = "running" | "done" | "failed";

export interface ActivityStepGroup {
  /** The first step's id. */
  id: string;
  /** The step's name in words (humanStepName), the same for every step inside. */
  label: string;
  steps: BotActivityStep[];
  count: number;
  phase: ActivityStepPhase;
  /** The one summary when every step inside shares it (or there is one). */
  summary?: string;
  where?: BotActivityStep["where"];
  /** Draw the place: the first group with one, or a place other than the
   * previous group's. */
  whereChanged: boolean;
  subagent: boolean;
  /** A sub-agent's own calls, grouped the same way. */
  substeps?: ActivityStepGroup[];
}

export function activityStepPhase(step: Pick<BotActivityStep, "ok">): ActivityStepPhase {
  return step.ok === undefined ? "running" : step.ok ? "done" : "failed";
}

function groupList(steps: readonly BotActivityStep[], children: Map<string, BotActivityStep[]>, previousWhere: BotActivityStep["where"] | undefined): ActivityStepGroup[] {
  const groups: ActivityStepGroup[] = [];
  let lastWhere = previousWhere;
  for (const step of steps) {
    const phase = activityStepPhase(step);
    const subagent = isSubagentStep(step);
    const label = humanStepName(step);
    const last = groups.at(-1);
    if (last && !subagent && !last.subagent && last.label === label && last.phase === phase && phase !== "running" && last.where === step.where) {
      last.steps.push(step);
      last.count += 1;
      if (last.summary !== step.summary) last.summary = undefined;
      continue;
    }
    const whereChanged = step.where !== undefined && step.where !== lastWhere;
    if (step.where !== undefined) lastWhere = step.where;
    const own = children.get(step.id);
    groups.push({
      id: step.id,
      label,
      steps: [step],
      count: 1,
      phase,
      ...(step.summary ? { summary: step.summary } : {}),
      ...(step.where ? { where: step.where } : {}),
      whereChanged,
      subagent,
      ...(subagent && own?.length ? { substeps: groupList(own, children, undefined) } : {}),
    });
  }
  return groups;
}

/** The top-level steps grouped, each sub-agent's calls grouped under it. */
export function groupActivitySteps(steps: readonly BotActivityStep[]): ActivityStepGroup[] {
  const { top, children } = stepTree(steps);
  return groupList(top, children, undefined);
}

/** How many steps failed, over the groups and their sub-agents' steps. */
export function countFailedSteps(groups: readonly ActivityStepGroup[]): number {
  let failed = 0;
  for (const group of groups) {
    if (group.phase === "failed") failed += group.count;
    if (group.substeps) failed += countFailedSteps(group.substeps);
  }
  return failed;
}

/** The step a running task is on now: the newest call still in flight,
 * named the way the working line names it (shared/working-step.ts), or by
 * its plain name when the table only knows it as "a tool". Null once no
 * call runs. */
export function currentTaskStep(steps: readonly BotActivityStep[]): { step: WorkingStep | null; label: string; since: number } | null {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index]!;
    if (step.ok !== undefined) continue;
    const named = workingStepFor({ name: step.name, ...(step.summary ? { summary: step.summary } : {}), ...(step.input ? { input: step.input } : {}) });
    return { step: named && named.key !== "tool" ? named : null, label: humanStepName(step), since: step.at };
  }
  return null;
}
