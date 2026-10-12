import { EFFORT_LEVELS, type EffortLevel } from "./wire.ts";

/** Claude Code's dynamic workflow mode (`--effort ultracode`). Stored on the
 * wire like any other effort; non-Claude engines map it at turn time. */
export const ULTRACODE_EFFORT = "ultracode" as const satisfies EffortLevel;

export function isUltracodeEffort(effort: EffortLevel | undefined): boolean {
  return effort === ULTRACODE_EFFORT;
}

/** Levels a driver natively advertises (never includes ultracode). */
export const NATIVE_EFFORT_LEVELS = EFFORT_LEVELS.filter((level) => level !== ULTRACODE_EFFORT);

/** Picker rows: native levels plus Ultracode when the engine supports effort. */
export function pickerEffortLevels(levels: readonly EffortLevel[]): EffortLevel[] {
  if (!levels.length) return [];
  const native = levels.filter((level) => level !== ULTRACODE_EFFORT);
  if (native.length === 0) return [];
  if (native.length !== levels.length) return [...native];
  return [...native, ULTRACODE_EFFORT];
}

/** Whether a stored selection is valid for this engine's offered levels. */
export function effortAcceptedByEngine(effort: EffortLevel, levels: readonly EffortLevel[]): boolean {
  if (isUltracodeEffort(effort)) {
    const native = levels.filter((level) => level !== ULTRACODE_EFFORT);
    return native.length > 0;
  }
  return levels.includes(effort);
}

/** Highest reasoning level the engine offers (for ultracode on non-Claude). */
export function maxNativeEffort(levels: readonly EffortLevel[]): EffortLevel | undefined {
  const native = levels.filter((level) => level !== ULTRACODE_EFFORT);
  if (native.includes("max")) return "max";
  if (native.includes("xhigh")) return "xhigh";
  if (native.includes("high")) return "high";
  return native.at(-1);
}

/** What the engine driver receives for this turn. */
export function resolveEngineTurnEffort(
  effort: EffortLevel | undefined,
  driverKind: string,
  levels: readonly EffortLevel[] | undefined,
): EffortLevel | undefined {
  if (!effort) return undefined;
  if (!isUltracodeEffort(effort)) return effort;
  if (driverKind === "claudeAgent") return ULTRACODE_EFFORT;
  return maxNativeEffort(levels ?? []);
}
