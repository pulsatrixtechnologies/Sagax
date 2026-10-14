// A folded stretch of finished tool steps: one quiet row, "Used 4 tools",
// that opens to the steps themselves, each on its own row of the same kind.
//
// Collapsed by default. A search hit inside a run opens it, and a run stays
// open once the user has opened it. Failed steps never enter a folded run.
import type { Message } from "@/state/store";
import { describeRun } from "@/lib/activity-runs";
import { stepDuration, stepGroupLabel } from "@/lib/step-label";
import { StepRow } from "./StepRow";

/** The time the steps ran, added up, when every step knows its own. */
export function runDuration(messages: Message[]): number | undefined {
  let total = 0;
  for (const message of messages) {
    const ms = message.tool?.durationMs;
    if (ms === undefined) return undefined;
    total += ms;
  }
  return total;
}

export function ActivityRun({
  messages,
  forceOpen = false,
  children,
}: {
  messages: Message[];
  /** landing on a step inside this run — a search hit cannot scroll to a
   * row that a fold has kept out of the DOM */
  forceOpen?: boolean;
  /** the individual steps, rendered by whichever transcript owns them */
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-start" data-testid="activity-run">
      <StepRow
        label={stepGroupLabel(messages.length)}
        duration={stepDuration(runDuration(messages))}
        title={describeRun(messages)}
        forceOpen={forceOpen}
      >
        {() => <div className="flex flex-col gap-0.5 py-0.5">{children}</div>}
      </StepRow>
    </div>
  );
}
