// Desktop notifications, driven by the harness's {kind:"notify"} frames.
// The server decides *whether* something is worth an interruption (it owns
// the per-bot toggle); this only decides how to show it here.
import type { Notification } from "../../shared/notification";
import { createNotificationTargets, messageAttention, type MessageAttention } from "./attention";
import { attentionSettings } from "./notification-preferences";

export type NotifyFrame = Notification;

export type NotificationTarget = Pick<NotifyFrame, "botId" | "threadId" | "routineRunId">;

/** Ask while handling the settings click. Browsers may reject permission
 * requests that are triggered later by an incoming SSE frame. */
export function requestNotificationPermission(): Promise<NotificationPermission> | null {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return null;
  return Notification.requestPermission();
}

/** The identity a notification groups under: one bot, wherever it was
 * working. Keyed by bot rather than thread so a single bot running across
 * tasks and rooms coalesces into one stack instead of stacking banners. */
export interface NotificationBotIdentity {
  id: string;
  avatarUrl?: string | null;
}

/** Presentation options for one bot's notifications: the stable per-bot
 * coalescing key platforms replace on (`tag`) and its avatar, when the
 * profile has one. Pure so the grouping rule stays testable on its own. */
export function buildNotificationOptions(bot: NotificationBotIdentity): NotificationOptions {
  return { tag: `openmausbot:${bot.id}`, icon: bot.avatarUrl ?? undefined };
}

interface PendingClick {
  open: () => void;
}

const pendingClicks = createNotificationTargets<PendingClick>();
let clicksWired = false;

/** The shell tells the page which of its notifications was clicked; the
 * page knows where that one goes. Wired once, on the first notification. */
function wireDesktopClicks(): void {
  if (clicksWired || typeof window === "undefined") return;
  const listen = window.ogb?.onNotificationClick;
  if (!listen) return;
  clicksWired = true;
  listen((id) => pendingClicks.take(id)?.open());
}

function windowFocused(): boolean {
  try {
    return typeof document !== "undefined" && document.hasFocus();
  } catch {
    return false;
  }
}

/** Hand one notification to the desktop shell (it can stay until dismissed,
 * bounce the Dock, flash the taskbar), or to the browser's Notification API.
 * False when neither can show it. */
export function presentNotification(input: {
  title: string;
  body: string;
  attention: Omit<MessageAttention, "show">;
  open: () => void;
  web?: NotificationOptions;
}): boolean {
  if (typeof window !== "undefined" && window.ogb?.notify) {
    wireDesktopClicks();
    window.ogb.notify({
      id: pendingClicks.add({ open: input.open }),
      title: input.title,
      body: input.body,
      sound: input.attention.sound,
      persistent: input.attention.persistent,
      bounce: input.attention.bounce,
      flash: input.attention.flash,
    });
    return true;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const options: NotificationOptions = {
    ...input.web,
    body: input.body,
    // Chromium keeps it on screen until the person acts on it.
    requireInteraction: input.attention.persistent,
    // The banner still lands; only the platform's alert sound is held back,
    // which is what a person on a call with the bot asked for.
    ...(input.attention.sound ? {} : { silent: true }),
  };
  new Notification(input.title, options).onclick = () => {
    window.focus();
    input.open();
  };
  return true;
}

/** Show one unless the exact destination conversation is already visible
 * in a focused window. A focused app may still be showing another task
 * (routine runs are detached), so window focus alone is not proof that the
 * actionable card can be seen. */
export function showNotification(
  frame: NotifyFrame,
  onOpen: (target: NotificationTarget) => void,
  avatarUrl?: string | null,
  visibleThreadId?: string | null,
) {
  const attention = messageAttention({
    kind: frame.kind,
    threadId: frame.threadId,
    windowFocused: windowFocused(),
    activeThreadId: visibleThreadId ?? null,
    settings: attentionSettings(),
  });
  if (!attention.show) return;
  const spend = frame.kind === "spend";
  presentNotification({
    title: frame.title,
    body: frame.body,
    attention,
    open: () => onOpen({ botId: frame.botId, threadId: frame.threadId, ...(frame.routineRunId ? { routineRunId: frame.routineRunId } : {}) }),
    web: {
      ...buildNotificationOptions({ id: frame.botId, avatarUrl }),
      // its own stack, so a bot's next "finished" never replaces it
      ...(spend ? { tag: "openmausbot:spend", icon: undefined } : {}),
    },
  });
}
