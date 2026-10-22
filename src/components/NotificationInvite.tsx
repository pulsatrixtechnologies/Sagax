// "Let your bots notify you": a quiet line under a card that is waiting on
// the person, offered once while notifications were never asked for. It is
// the in-thread door to the same permission the settings screen asks for.
import { useState } from "react";
import { Bell } from "lucide-react";
import { requestNotificationPermission } from "@/lib/notify";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { QUESTION_SHEET_WIDTH } from "./QuestionSheet";

const SNOOZE_KEY = "sagax.notificationInvite.snoozed";

/** True while the browser has never been asked and the person did not say
 * "not now" here. Storage can throw (private window): then it just shows. */
export function shouldInviteNotifications(): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return false;
  try {
    return localStorage.getItem(SNOOZE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function NotificationInvite() {
  const [shown, setShown] = useState(shouldInviteNotifications);
  if (!shown) return null;
  const hide = () => setShown(false);
  const later = () => {
    try { localStorage.setItem(SNOOZE_KEY, "1"); } catch { /* stays for this session */ }
    hide();
  };
  return (
    <div data-notification-invite="" className={cn(QUESTION_SHEET_WIDTH, "mt-2 flex min-w-0 items-center gap-2 rounded-2xl bg-ink/[0.04] px-3 py-2 text-[12.5px] leading-snug text-ink-secondary")}>
      <Bell size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1">{t("notifications.invite.title")}</span>
      <button
        type="button"
        onClick={() => { void requestNotificationPermission()?.finally(hide); }}
        className="shrink-0 rounded-full px-2.5 py-1 font-medium text-ink hover:bg-ink/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {t("notifications.invite.enable")}
      </button>
      <button
        type="button"
        onClick={later}
        className="shrink-0 rounded-full px-2 py-1 text-ink-tertiary hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {t("notifications.invite.later")}
      </button>
    </div>
  );
}
