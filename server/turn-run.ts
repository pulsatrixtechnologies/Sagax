import type { EffortLevel, ModelSelection } from "../shared/wire.ts";

/** What a turn ran on, stored on each bot text message it wrote. Optional on
 * the wire, so messages from before this field simply do not carry it. */
export interface TurnRun {
  instanceId: string;
  model: string;
  /** Absent when the turn ran on the engine's own default effort. */
  effort?: EffortLevel;
}

/** The record for the selection a turn is dispatched with. For an Auto
 * turn that is the pick, not the bot's stored fallback. */
export function turnRunFor(selection: Pick<ModelSelection, "instanceId" | "model" | "effort">): TurnRun {
  return {
    instanceId: selection.instanceId,
    model: selection.model,
    ...(selection.effort ? { effort: selection.effort } : {}),
  };
}
