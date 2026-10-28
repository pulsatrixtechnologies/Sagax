// The conversation panel's two counters. They live on the conversation, not
// in a message. Nothing is shown until a number exists.
import { t } from "@/lib/i18n";

export function turnTimingLabel(timing: { queueMs?: number; firstResponseMs?: number } | undefined): string | null {
  if (!timing) return null;
  const parts: string[] = [];
  if (typeof timing.queueMs === "number") parts.push(t("chat.turnTiming.wait", { ms: timing.queueMs }));
  if (typeof timing.firstResponseMs === "number") parts.push(t("chat.turnTiming.first", { ms: timing.firstResponseMs }));
  return parts.length ? parts.join(" ") : null;
}

export function TurnTimingLine({ timing }: { timing?: { queueMs?: number; firstResponseMs?: number } }) {
  const label = turnTimingLabel(timing);
  if (!label) return null;
  return <p className="px-5 pt-1 text-[11.5px] text-ink-tertiary" data-turn-timing="">{label}</p>;
}
