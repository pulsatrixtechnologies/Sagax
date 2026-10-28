// The conversation panel's two counters (wait before send, first answer
// text). They live on the conversation, not in a message. 2026-10-28: a
// diagnostic, never part of the conversation: shown only when this device
// turned on Settings > Appearance > Turn timing (a developer setting,
// src/lib/turn-timing-preferences.ts). Nothing is shown until a number exists.
import { t } from "@/lib/i18n";
import { useShowTurnTiming } from "@/lib/turn-timing-preferences";

export function turnTimingLabel(timing: { queueMs?: number; firstResponseMs?: number } | undefined): string | null {
  if (!timing) return null;
  const parts: string[] = [];
  if (typeof timing.queueMs === "number") parts.push(t("chat.turnTiming.wait", { ms: timing.queueMs }));
  if (typeof timing.firstResponseMs === "number") parts.push(t("chat.turnTiming.first", { ms: timing.firstResponseMs }));
  return parts.length ? parts.join(" ") : null;
}

export function TurnTimingLine({ timing }: { timing?: { queueMs?: number; firstResponseMs?: number } }) {
  const shown = useShowTurnTiming();
  const label = shown ? turnTimingLabel(timing) : null;
  if (!label) return null;
  return <p className="px-5 pt-1 text-[11.5px] text-ink-tertiary" data-turn-timing="">{label}</p>;
}
