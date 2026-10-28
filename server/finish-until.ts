// The person's own condition for one bot: "do not finish until...".
// One sentence. It is not a task list. Empty means off.
// The same sentence is put back onto a compaction summary, because a fold
// would otherwise drop it with the older turns.

export const FINISH_UNTIL_MAX = 400;

/** One line, or empty when the person has not set a condition. */
export function finishUntilText(value: string | null | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, FINISH_UNTIL_MAX);
}

/** The line a turn reads. Empty when the condition is off. */
export function finishUntilPrompt(value: string | null | undefined): string {
  const text = finishUntilText(value);
  if (!text) return "";
  return `Do not finish until: ${text}\nThis is the person's own condition for this bot. It is not a task list. Keep going until it is true, then you may finish. A compaction does not retire it.`;
}

/** Put the condition back on a summary that no longer contains it. */
export function remindAfterCompaction(summary: string, value: string | null | undefined): string {
  const line = finishUntilPrompt(value).split("\n")[0] ?? "";
  if (!line || summary.includes(line)) return summary;
  return `${summary}\n\n${line}`;
}
