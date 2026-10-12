import { ULTRACODE_EFFORT } from "../../shared/ultracode-effort";
import type { EffortLevel } from "../../shared/wire";
import { t } from "@/lib/i18n";

/** The others capitalize cleanly; "xhigh" would read "Xhigh". */
export function effortLabel(level: EffortLevel): string {
  if (level === ULTRACODE_EFFORT) return t("model.effort.ultracode");
  return level === "xhigh" ? "X-High" : level[0].toUpperCase() + level.slice(1);
}
