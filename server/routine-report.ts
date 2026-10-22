/** Routine runs work in the background (JC 2026-10-22): "simply let it run
 * in the background, just letting know by 'Handling it' is sufficient. If the
 * routine explicitly says to stay silent you don't tell me anything in the
 * chat. I can view the logs and status in the automation page anyway."
 *
 * A run executes in its own hidden task; nothing reaches the person's
 * conversation while it is queued or running. When it ends, one concise
 * message (the bot's report, never the routine's instructions) is posted
 * only when there is something for the person: a result, a question or
 * approval waiting on them, or an error. A run that ends with nothing to
 * report posts nothing, rings nothing and marks nothing unread; its full
 * record stays in Automations > Logs.
 *
 * The bot says "nothing to report" explicitly by ending its final message
 * with ROUTINE_QUIET_MARKER (the contract is in ROUTINE_EXECUTION_PROMPT).
 * A short final message that only says nothing happened ("nothing to
 * report", "rien à signaler") counts too, so a bot that forgets the marker
 * does not ring the person for nothing. */

import type { RoutineGoalStatus, RoutineRunStatus } from "../shared/routines.ts";

export const ROUTINE_QUIET_MARKER = "NOTHING_TO_REPORT";

/** What the bot reads in its system prompt on every routine run. */
export const ROUTINE_REPORT_CONTRACT =
  ` This run works in the background: the person does not see this conversation, only your final message, and only when it needs them. Do the routine's work, then end with a short report of what you found or did that the person should know. Never restate or quote the routine's instructions. If nothing needs the person (nothing found, nothing changed, nothing to decide, or the instructions say to stay silent in this case), end your final message with the line ${ROUTINE_QUIET_MARKER} on its own: nothing is posted to their chat and the run stays in the routine logs.`;

/** The marker on a line of its own, in the shapes models write it in. */
const MARKER_LINE = /^[\s`*_[(<"']*nothing[\s_-]to[\s_-]report[\s`*_\])>"'.!]*$/i;

/** A final message that only says nothing happened. */
const NO_OP = new RegExp([
  "nothing (?:new |else |more )?to (?:report|do|flag|signal)",
  "no (?:action|follow[- ]up|change)s? (?:is |are )?(?:needed|required)",
  "nothing (?:found|changed|happened|new)",
  "rien (?:de nouveau |d'autre |de plus )?à (?:signaler|faire|rapporter)",
  "rien de (?:nouveau|neuf)",
  "aucune? (?:action|suivi|changement)s? (?:n'est |requis|requise|nécessaire)",
].join("|"), "i");

/** The routine asks to stay quiet when it has nothing ("silent if 0"). */
const ASKS_SILENCE = /\b(?:silent|silence|silently|stay quiet|keep quiet|say nothing|silencieu(?:x|se)|ne (?:rien )?dis rien|sans rien dire)\b/i;

/** How long a no-op report may be and still be only that. */
const NO_OP_MAX = 240;
const NO_OP_MAX_WHEN_ASKED = 600;

export interface RoutineReportOutcome {
  /** Nothing for the person: post nothing. */
  quiet: boolean;
  /** The bot's final message without the marker, for the logs and the post. */
  report: string;
}

export function routineReportOutcome(output: string | undefined, prompt?: string): RoutineReportOutcome {
  const text = (output ?? "").trim();
  if (!text) return { quiet: true, report: "" };
  const lines = text.split(/\r?\n/);
  const last = lines.findLastIndex((line) => line.trim() !== "");
  if (last >= 0 && MARKER_LINE.test(lines[last]!.trim())) {
    return { quiet: true, report: lines.slice(0, last).join("\n").trim() };
  }
  if (MARKER_LINE.test(lines[0]!.trim())) {
    return { quiet: true, report: lines.slice(1).join("\n").trim() };
  }
  const limit = prompt && ASKS_SILENCE.test(prompt) ? NO_OP_MAX_WHEN_ASKED : NO_OP_MAX;
  // a question is for the person, whatever else the message says
  const quiet = text.length <= limit && !text.includes("?") && NO_OP.test(text);
  return { quiet, report: text };
}

export interface RoutineRunReportFacts {
  status: RoutineRunStatus;
  goalStatus?: RoutineGoalStatus;
  /** The run ended with nothing for the person (routineReportOutcome). */
  quiet?: boolean;
  /** An approval or question card in the run's task waits on the person. */
  needsPerson?: boolean;
}

/** Whether a run has something for the person's conversation now. */
export function routineRunReportable(run: RoutineRunReportFacts): boolean {
  if (run.goalStatus === "needs-input") return true;
  switch (run.status) {
    case "waiting": return run.needsPerson === true;
    case "failed": return true;
    case "completed": return run.quiet !== true;
    default: return false;
  }
}
