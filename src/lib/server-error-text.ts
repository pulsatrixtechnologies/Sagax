// A refusal the server words in its own language (English sentences, a few
// French ones) is shown in the app's language instead. The server always
// sends a stable `code`; the app translates by code, as for `no_engine`
// (engine-error-text.ts). A code not listed keeps the server's sentence.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

const BY_CODE: Readonly<Record<string, LocaleKey>> = {
  not_group_owner: "serverError.notGroupOwner",
  not_channel_editor: "serverError.notChannelEditor",
  thread_busy: "serverError.threadBusy",
  thread_limit: "serverError.threadLimit",
  approval_desktop_required: "serverError.approvalDesktopRequired",
  misuse_blocked: "serverError.misuseBlocked",
  misuse_approval_required: "serverError.misuseApprovalRequired",
  misuse_locked: "serverError.misuseLocked",
  safety_blocked: "serverError.safetyBlocked",
};

/** The sentence, in the app's language, for a refusal body that carries one
 * of the codes above, or null for any other body. */
export function serverErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  const key = typeof code === "string" && Object.hasOwn(BY_CODE, code) ? BY_CODE[code] : undefined;
  return key ? t(key) : null;
}
