// One level rule for every delegated turn (docs/runtime-contract.md §3):
// level = max(own, inherited) in the order ask < edits < auto < full, with
// the inherited level capped by what the assignee's engine really does.
// Pure: every input is something the harness recorded, never model text,
// and the answer is written on the record once at enqueue (invariant I6).
import { hasNativeAutoReview, supportsApprovalMode } from "../../shared/approval-mode.ts";
import type { Level, LevelSource, OriginKind } from "./types.ts";

export interface LevelInput {
  /** The assignee's own level. */
  own: Level;
  /** The Chief conversation's level, when a Chief is the requester or an
   * ancestor in the same root. */
  chief?: Level;
  origin: OriginKind;
  /** A Chief of Staff conversation is the requester or an ancestor in the
   * same root. */
  chiefLineage: boolean;
  /** The assignee's engine (shared/approval-mode.ts driver kinds). */
  driverKind?: string;
}

/** The levels that travel, lowest first. `custom` is absent on purpose: it
 * is one provider's own rule set, so it never leaves the conversation that
 * set it. Having no rank, it never outranks anything: an inherited custom
 * loses to any own level, and an own custom is kept as it is. */
const TRAVELS: readonly Level[] = ["ask", "edits", "auto", "full"];
const rank = (level: Level): number => TRAVELS.indexOf(level);

/** Whether the engine runs a level as that level, not as something weaker
 * dressed up: Full only where the provider (or the harness, for the chat
 * family) answers residual prompts; Auto only where a native reviewer
 * decides what is safe; Edits only where an auto-accept-edits mode exists.
 * Every engine asks. */
function engineRuns(level: Level, driverKind: string | undefined): boolean {
  if (level === "full") return supportsApprovalMode(driverKind, "full");
  if (level === "auto") return hasNativeAutoReview(driverKind);
  if (level === "edits") return supportsApprovalMode(driverKind, "edits");
  return level === "ask";
}

/** The inherited level stepped down to the highest one the engine runs. */
function engineCap(inherited: Level, driverKind: string | undefined): Level {
  for (let i = rank(inherited); i > 0; i--) {
    if (engineRuns(TRAVELS[i]!, driverKind)) return TRAVELS[i]!;
  }
  return "ask";
}

export function assignmentLevel(input: LevelInput): { level: Level; source: LevelSource } {
  const { own, chief, origin, chiefLineage, driverKind } = input;
  // Outside lineage inherits nothing; neither does a tree without a Chief in it.
  const inherited = chiefLineage && (origin === "person" || origin === "routine") ? chief : undefined;
  if (own === "custom" || inherited === undefined || rank(inherited) <= rank(own)) return { level: own, source: "own" };
  const capped = engineCap(inherited, driverKind);
  if (rank(capped) <= rank(own)) return { level: own, source: "engine_cap" };
  return { level: capped, source: capped === inherited ? "chief" : "engine_cap" };
}
