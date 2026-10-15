// The discreet thread line a bot on Auto leaves when its Workspace changes
// (server/auto-computer.ts autoStartTarget): "On your computer", "In the
// cloud", or "Moved to the cloud: your computer is offline" when the place it
// wanted was not available. The server writes these exact activity names;
// the client shows them in the person's language (src/lib/activity-runs.ts
// statusActivity), like shared/sandbox-wake.ts. An older client shows the
// English text after "notice:".
import type { SelectedComputer } from "./execution-target.ts";

export type WorkspaceFallbackReason = "offline" | "routine-not-allowed" | "unavailable";

const PLACE: Record<SelectedComputer, string> = {
  this_computer: "your computer",
  browser: "the browser",
  cloud: "the cloud",
  local_vm: "the Local VM",
};
const ON: Record<SelectedComputer, string> = {
  this_computer: "On your computer",
  browser: "In the browser",
  cloud: "In the cloud",
  local_vm: "In the Local VM",
};
const WHY: Record<WorkspaceFallbackReason, (wanted: SelectedComputer) => string> = {
  offline: () => "your computer is offline",
  "routine-not-allowed": () => "routines may not use your computer",
  unavailable: (wanted) => `${PLACE[wanted]} is not available`,
};

export interface WorkspaceLine {
  target: SelectedComputer;
  /** Present when the bot wanted another place and could not use it. */
  fallback?: { wanted: SelectedComputer; reason: WorkspaceFallbackReason };
}

/** The activity name the server stores for one line. */
export function workspaceLineName(line: WorkspaceLine): string {
  if (!line.fallback) return `notice: Workspace: ${ON[line.target]}`;
  return `notice: Workspace: moved to ${PLACE[line.target]}: ${WHY[line.fallback.reason](line.fallback.wanted)}`;
}

const TARGETS = Object.keys(PLACE) as SelectedComputer[];
const REASONS = Object.keys(WHY) as WorkspaceFallbackReason[];
const BY_NAME = new Map<string, WorkspaceLine>();
for (const target of TARGETS) {
  BY_NAME.set(workspaceLineName({ target }), { target });
  for (const wanted of TARGETS) {
    if (wanted === target) continue;
    for (const reason of REASONS) {
      // "offline" and "routines may not" read the same for this computer
      // and the Local VM: the first (this computer) stands for both.
      const line = { target, fallback: { wanted, reason } };
      const name = workspaceLineName(line);
      if (!BY_NAME.has(name)) BY_NAME.set(name, line);
    }
  }
}

/** The line an activity name stands for, or null when it is not one. */
export function parseWorkspaceLine(name: string | undefined | null): WorkspaceLine | null {
  return name ? BY_NAME.get(name) ?? null : null;
}
