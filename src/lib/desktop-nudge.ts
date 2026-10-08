import type { ServerFrame } from "../../shared/wire";
import { nudgeAttention } from "@/lib/attention";
import { t } from "@/lib/i18n";
import { attentionSettings } from "@/lib/notification-preferences";
import { presentNotification } from "@/lib/notify";
import { playNudgeSound } from "@/lib/nudge-sound";

type NudgeFrame = Extract<ServerFrame, { kind: "nudge" }>;

function windowFocused(): boolean {
  try {
    return typeof document !== "undefined" && document.hasFocus();
  } catch {
    return false;
  }
}

/** A nudge addressed to this person reached this computer (the server sends
 * the `nudge` frame to that person's streams only, never to the sender).
 * Plays the nudge sound, asks the desktop shell to bounce the Dock / flash
 * the taskbar and shake the window, and, when the window is not the one in
 * front, shows a notification that stays and opens the conversation on a
 * click. A stale replay (the stream came back after a while) does nothing:
 * its line is already in the chat. Each part follows this computer's
 * switches in Settings > Notifications. */
export async function onNudgeReceived(
  frame: Pick<NudgeFrame, "fromName" | "at" | "open">,
  openConversation: (target: { botId: string; threadId: string }) => void,
  now: number = Date.now(),
): Promise<void> {
  const settings = attentionSettings();
  const focused = windowFocused();
  const decision = nudgeAttention({ at: frame.at, now, windowFocused: focused, settings });
  if (!decision.fresh) return;
  if (typeof window !== "undefined") window.ogb?.nudgeWindow?.({ shake: decision.shake });
  const rang = decision.sound ? await playNudgeSound() : false;
  if (!decision.notify) return;
  const threadId = frame.open?.threadId;
  const name = frame.fromName.trim() || t("nudge.notify.someone");
  presentNotification({
    title: t("nudge.notify.title", { name }),
    body: t("nudge.notify.body"),
    attention: {
      // the nudge sound already rang: the banner does not ring twice
      sound: !rang && settings.nudgeSound,
      persistent: settings.persistent,
      bounce: "critical",
      flash: true,
    },
    open: () => {
      if (threadId) openConversation({ botId: "", threadId });
    },
    web: { tag: "sagax:nudge" },
  });
}
