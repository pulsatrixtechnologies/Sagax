import type { Message } from "@/state/store";

/** Open question cards on a thread (a bot's structured ask), oldest first.
 * Answered, dismissed and expired ones drop out. Permission cards are not
 * questions: they keep taking over the composer (see PendingApproval). */
export function pendingQuestions(messages: readonly Message[]): Message[] {
  return messages.filter(
    (m) =>
      m.kind === "options" &&
      m.card?.requestId &&
      m.card.questionRequest &&
      !m.card.tool &&
      !m.card.answered &&
      !m.card.dismissed &&
      !m.card.expired,
  );
}

/** Whole seconds left before a question closes by itself, or null when it
 * has no countdown. Never negative. */
export function autoDismissSecondsLeft(at: number | undefined, now: number): number | null {
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}
