import type { ServerFrame } from "../../shared/wire";
import { nudgeAttention } from "@/lib/attention";
import { t } from "@/lib/i18n";
import { attentionSettings } from "@/lib/notification-preferences";
import { presentNotification } from "@/lib/notify";
import { playNudgeSound } from "@/lib/nudge-sound";

type NudgeFrame = Extract<ServerFrame, { kind: "nudge" }>;
type NudgeSentFrame = Extract<ServerFrame, { kind: "nudge.sent" }>;

/** The nudges this window already played, by id: the window that clicked
 * plays its own nudge at once, then skips the server's echo of it. */
const played = new Set<string>();
const PLAYED_KEEP = 50;

function markPlayed(id: string | undefined): boolean {
  if (!id) return true;
  if (played.has(id)) return false;
  played.add(id);
  if (played.size > PLAYED_KEEP) played.delete(played.values().next().value!);
  return true;
}

/** Test seam. */
export function resetPlayedNudges(): void {
  played.clear();
}

const PAGE_SHAKE_CLASS = "sagax-page-nudge";
const PAGE_SHAKE_MS = 1_500;
const PAGE_SHAKE_CSS = [
  `html.${PAGE_SHAKE_CLASS}{animation:sagax-page-nudge 420ms linear 4}`,
  "@keyframes sagax-page-nudge{",
  "0%,100%{transform:none}",
  "16%{transform:translate(6px,0)}",
  "33%{transform:translate(-6px,1px)}",
  "50%{transform:translate(4px,-1px)}",
  "66%{transform:translate(-3px,0)}",
  "83%{transform:translate(2px,0)}",
  "}",
].join("");

/** A browser (no desktop shell): shake the page itself, a few pixels, the
 * same wiggle the desktop gives its window. */
export function shakePage(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (!doc?.documentElement) return false;
  try {
    if (!doc.getElementById("sagax-page-nudge-style")) {
      const style = doc.createElement("style");
      style.id = "sagax-page-nudge-style";
      style.textContent = PAGE_SHAKE_CSS;
      (doc.head ?? doc.documentElement).appendChild(style);
    }
    const root = doc.documentElement;
    root.classList.remove(PAGE_SHAKE_CLASS);
    // restart the animation when a second nudge lands during the first
    void root.offsetWidth;
    root.classList.add(PAGE_SHAKE_CLASS);
    setTimeout(() => root.classList.remove(PAGE_SHAKE_CLASS), PAGE_SHAKE_MS);
    return true;
  } catch {
    return false;
  }
}

/** Shake this window and bring it to the very front. The desktop shell
 * does it natively (electron/window-nudge.mjs: restore, show, top most for
 * a moment, focus stolen from the other app, Dock bounce or taskbar flash
 * for a nudge received). A browser shakes the page and asks for focus,
 * which a browser may refuse. */
function shakeAndFront(role: "received" | "sent", shake: boolean): void {
  if (typeof window === "undefined") return;
  const shell = window.ogb?.nudgeWindow;
  if (shell) {
    shell({ shake, role });
    return;
  }
  if (shake) shakePage();
  try {
    window.focus();
  } catch {
    // a browser may refuse
  }
}

function windowFocused(): boolean {
  try {
    return typeof document !== "undefined" && document.hasFocus();
  } catch {
    return false;
  }
}

/** Fired on the window when a fresh nudge reached this person (once per nudge). */
export const NUDGE_RECEIVED_EVENT = "sagax:nudge-received";

/** A nudge addressed to this person reached this computer (the server sends
 * the `nudge` frame to that person's streams only). Brings the window to
 * the very front and shakes it (the shell also bounces the Dock / flashes
 * the taskbar), plays the nudge sound, and, when the window was not the one
 * in front, shows a notification that stays and opens the conversation on a
 * click. A stale replay (the stream came back after a while) does nothing:
 * its line is already in the chat. The shake and the sound follow this
 * computer's switches in Settings > Notifications; the window always comes
 * forward. */
export async function onNudgeReceived(
  frame: Pick<NudgeFrame, "fromName" | "at" | "open"> & { id?: string },
  openConversation: (target: { botId: string; threadId: string }) => void,
  now: number = Date.now(),
): Promise<void> {
  const settings = attentionSettings();
  const focused = windowFocused();
  const decision = nudgeAttention({ at: frame.at, now, windowFocused: focused, settings });
  if (!decision.fresh) return;
  if (!markPlayed(frame.id)) return;
  // the desktop mascots react too (a Shiba barks): floating-bots/FloatingBots.tsx
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent(NUDGE_RECEIVED_EVENT));
  shakeAndFront("received", decision.shake);
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

/** This window just sent a nudge (POST /api/nudges answered): the sender's
 * own window shakes and rings at once, as the other person's does. `id` is
 * the server's: the `nudge.sent` echo of it is then skipped here. */
export async function onNudgeSent(
  sent: { id?: unknown; at?: unknown } | null | undefined,
  now: number = Date.now(),
): Promise<void> {
  const id = typeof sent?.id === "string" ? sent.id : undefined;
  const at = typeof sent?.at === "number" && Number.isFinite(sent.at) ? sent.at : now;
  await playSent(id, at, now);
}

/** The server's echo of a nudge this person sent, on each of their streams.
 * A window that did not click (another computer of the sender, a second
 * window) shakes and rings too; the one that clicked already did. */
export async function onNudgeSentEcho(
  frame: Pick<NudgeSentFrame, "id" | "at">,
  now: number = Date.now(),
): Promise<void> {
  await playSent(frame.id, frame.at, now);
}

async function playSent(id: string | undefined, at: number, now: number): Promise<void> {
  const settings = attentionSettings();
  // the window is in front: no notification for one's own nudge
  const decision = nudgeAttention({ at, now, windowFocused: true, settings });
  if (!decision.fresh) return;
  if (!markPlayed(id)) return;
  shakeAndFront("sent", decision.shake);
  if (decision.sound) await playNudgeSound();
}
