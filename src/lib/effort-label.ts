import type { EffortLevel } from "../../shared/wire";

/** The others capitalize cleanly; "xhigh" would read "Xhigh". */
export function effortLabel(level: EffortLevel): string {
  return level === "xhigh" ? "X-High" : level[0].toUpperCase() + level.slice(1);
}
