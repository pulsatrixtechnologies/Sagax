import { isUltracodeEffort } from "../../shared/ultracode-effort";
import type { EffortLevel, ModelSelection } from "../../shared/wire";

export function ultracodeActive(effort: EffortLevel | undefined): boolean {
  return isUltracodeEffort(effort);
}

export function ultracodeFromSelection(selection: Pick<ModelSelection, "effort"> | undefined): boolean {
  return ultracodeActive(selection?.effort);
}
