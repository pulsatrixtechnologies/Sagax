// The working line's step in the reader's language (shared/working-step.ts):
// the server names the step once, as a key and a short detail, and every
// client words it here, so a Claude Code turn and a Codex turn read alike.
import type { LocaleKey } from "@/locales";
import { WORKING_STEP_DETAIL_KEYS, quietAge, type WorkingStep } from "../../shared/working-step";
import { t } from "./i18n";

export function workingStepLabel(step: WorkingStep): string {
  if (step.detail && WORKING_STEP_DETAIL_KEYS.includes(step.key)) {
    return t(`chat.step.${step.key}.detail` as LocaleKey, { detail: step.detail });
  }
  return t(`chat.step.${step.key}` as LocaleKey);
}

/** "last output 2 min ago", or null while the step is young. */
export function quietAgeLabel(since: number | undefined, now: number): string | null {
  const age = quietAge(since, now);
  if (!age) return null;
  const amount = age.unit === "min" ? t("chat.step.age.minutes", { count: age.count }) : t("chat.step.age.hours", { count: age.count });
  return t("chat.step.lastOutput", { age: amount });
}
