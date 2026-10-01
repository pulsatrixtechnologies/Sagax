import { t } from "@/lib/i18n";
import type { Message } from "@/state/store";

/** What a channel shows for `waiting-on-owner`. No approval control. */
export function OwnerWait({ ownerName }: { ownerName: string }) {
  return (
    <p className="px-4 py-2.5 text-[15px] leading-relaxed text-ink-secondary">
      {`En attente de ${ownerName}`}
    </p>
  );
}

/** What someone who is not the approval audience sees once the card is
 * settled (`owner-settled`): who answered and the verdict, nothing of the
 * request. A dismissed or expired card shows nothing, as before. */
export function OwnerSettled({ message }: { message: Pick<Message, "card" | "ownerName"> }) {
  const card = message.card;
  if (!card?.answered) return null;
  const by = card.answeredBy;
  const name = (by?.kind === "session" && by.name.trim() ? by.name : message.ownerName?.trim()) || t("approval.someone");
  return (
    <p className="px-4 py-2.5 text-[15px] leading-relaxed text-ink-secondary">
      {t(card.answered === "allow" ? "approval.ownerSettled.allowed" : "approval.ownerSettled.denied", { name })}
    </p>
  );
}
