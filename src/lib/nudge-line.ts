import type { WireMessage } from "../../shared/wire";
import { t } from "@/lib/i18n";

export type NudgeNote = NonNullable<WireMessage["nudge"]>;

/** The one line a person reads for an accepted nudge. The sender is named
 * in the first person. Everyone else reads who sent it. A group line names
 * the chat instead of the other person. */
export function nudgeLineText(note: NudgeNote, viewerId: string): string {
  const self = viewerId.trim().toLowerCase();
  const sender = note.fromId.trim().toLowerCase() === self;
  if (note.groupId) {
    return sender
      ? t("nudge.line.sentGroup", { name: note.toName })
      : t("nudge.line.receivedGroup", { name: note.fromName });
  }
  if (sender) return t("nudge.line.sent", { name: note.toName });
  return t("nudge.line.received", { name: note.fromName });
}
