// "Send feedback" (Settings > General > Advanced): a mail draft to the
// public Pulsatrix mailbox with the app version and the system, written in
// the person's own mail app. Nothing is attached or sent by the app; logs
// travel only if the person downloads them and attaches the file.
import { emailMailtoUrl } from "./rich-blocks";
import { t } from "./i18n";

export const FEEDBACK_ADDRESS = "hello@pulsatrix.ca";

export function feedbackMailto({ version, system }: { version: string; system: string }): string {
  return emailMailtoUrl({
    to: [FEEDBACK_ADDRESS],
    cc: [],
    bcc: [],
    subject: t("settings.feedback.subject", { version }),
    body: t("settings.feedback.body", { version, system }),
  }).url;
}
