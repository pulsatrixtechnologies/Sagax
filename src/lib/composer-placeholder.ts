import { t } from "@/lib/i18n";

export interface ComposerPlaceholderInput {
  approval: boolean;
  attachmentPending: boolean;
  recording: boolean;
  /** The bot or room is working. */
  busy: boolean;
  /** A room or channel: its name, else this is a 1:1 chat. */
  groupName?: string;
  goalMode?: boolean;
  /** Lazy: only a room that is not working shows it. */
  groupHint?: () => string;
  botName: string;
}

/** What the empty composer says. While the bot works it says the same plain
 * thing as ever: how Enter behaves then is shown by the chip or sheet that
 * appears on send, not by a long line in the placeholder. */
export function composerPlaceholder(input: ComposerPlaceholderInput): string {
  if (input.approval) return t("composer.placeholder.approval");
  if (input.attachmentPending) return t("composer.placeholder.attaching");
  if (input.recording) return t("composer.placeholder.listening");
  if (input.busy) return t("composer.placeholder.write");
  if (input.groupName !== undefined) {
    return input.goalMode
      ? t("composer.placeholder.goal", { name: input.groupName })
      : t("composer.placeholder.group", { name: input.groupName, hint: input.groupHint?.() ?? "" });
  }
  return t("composer.placeholder.bot", { name: input.botName });
}
