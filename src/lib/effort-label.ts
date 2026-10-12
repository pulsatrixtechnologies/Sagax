import { ULTRACODE_EFFORT } from "../../shared/ultracode-effort";
import type { EffortLevel } from "../../shared/wire";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

const EFFORT_KEYS: Record<Exclude<EffortLevel, typeof ULTRACODE_EFFORT>, LocaleKey> = {
  none: "model.effortLevel.none",
  low: "model.effortLevel.low",
  medium: "model.effortLevel.medium",
  high: "model.effortLevel.high",
  xhigh: "model.effortLevel.xhigh",
  max: "model.effortLevel.max",
};

/** A level as the person reads it, in their language ("xhigh" reads "X-High"). */
export function effortLabel(level: EffortLevel): string {
  if (level === ULTRACODE_EFFORT) return t("model.effort.ultracode");
  return t(EFFORT_KEYS[level]);
}
