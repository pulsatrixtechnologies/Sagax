import type { CloudAgentCompletionEvent } from "./manager.ts";

/** Hidden prompt that resumes the launching thread when a cloud agent settles. */
export function cloudAgentWakePrompt(event: CloudAgentCompletionEvent): string {
  const { record, summary } = event;
  const lines = [
    `A cloud coding agent you launched has finished (${record.provider}: ${record.name}, status ${record.status}).`,
    "",
    summary,
    "",
    "Review the outcome (repository changes, pull request, errors) and tell the person what happened and what they should do next.",
  ];
  if (record.url) lines.splice(2, 0, `Dashboard: ${record.url}`);
  return lines.join("\n");
}
