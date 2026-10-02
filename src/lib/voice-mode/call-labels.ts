// What a call pill says: its running time and its state. Shared by the app's
// pill (VoiceModeBar.tsx) and the desktop mascot's (floating-bots/MascotCall.tsx),
// which must not pull the app's store into its window.
import { t } from "@/lib/i18n";
import type { CallPhase } from "./call-machine";

/** The call's running time, as a phone shows it: m:ss, then h:mm:ss.
 * Exported for tests. */
export function formatCallTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** What the bar says for each state of the call. Exported for tests. */
export function phaseLabel(phase: CallPhase, muted: boolean): string {
  if (phase === "held") return t("voiceMode.phase.held");
  if (muted) return t("voiceMode.muted");
  switch (phase) {
    case "connecting": return t("voiceMode.phase.connecting");
    case "listening": return t("voiceMode.listening");
    case "hearing": return t("voiceMode.phase.hearing");
    case "thinking": return t("voiceMode.phase.thinking");
    case "speaking": return t("voiceMode.phase.speaking");
    case "interrupted": return t("voiceMode.phase.interrupted");
    default: return "";
  }
}

