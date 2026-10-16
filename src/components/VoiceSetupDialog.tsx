// Voice set-up, where a call asked for it. The call button's help used to
// send people to the bot's full settings (in Simple mode, the whole Advanced
// fold-out) just to paste a key and pick a voice. This is the same
// VoiceSettings card in a small window over the chat, with the bot's
// full Voice section one link away, and the call one click away once a
// voice is ready.
//
// It saves the way the bot's own settings do (the bot update and the
// workspace voice config). A desktop paired to another computer can't make
// those writes (the host keeps the engine and its key), so the call help
// opens the remote agent settings there instead of this.
import { useEffect, useId, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, Phone } from "lucide-react";

import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot, useStore, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { VoiceSettings } from "./VoiceSettings";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { DIALOG, DialogCloseButton, GROUP_CARD, LinkRow, PRIMARY_PILL } from "./SettingsPrimitives";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const VOICE_PICKER = "[data-voice-picker] button:not([disabled])";
const FIRST_FIELD = "input:not([disabled]), select:not([disabled])";

export function VoiceSetupDialog({
  bot,
  callName,
  ready,
  onClose,
  onStartCall,
  returnFocusRef,
}: {
  /** Whose voice this sets: the bot being called, or in a room the first
   * member still without one. */
  bot: Bot;
  /** Who the call goes to (a room's name for a group call). */
  callName: string;
  /** The call button's own test, live: a call can start now. */
  ready: boolean;
  onClose: () => void;
  /** Starts the call exactly as the call button does. */
  onStartCall: () => void;
  /** Focus goes back here on close: the call button. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  // The patch the bot settings' Voice section hands the same card.
  const { patch } = useBotSettingsDerived(bot);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const subtitleId = useId();
  const close = () => onCloseRef.current();

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.getClientRects().length > 0,
      );
    // The voice picker shows once the engine is set up (its key saved, its
    // server address set), and then a voice is what's missing: start there.
    // Until then, start in the first field: the key, or the server address.
    (
      dialog?.querySelector<HTMLElement>(VOICE_PICKER) ??
      dialog?.querySelector<HTMLElement>(FIRST_FIELD) ??
      dialog
    )?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items.at(-1)!;
      // Focus falls out when the control holding it goes away (switching
      // engines removes the key field): Tab brings it back either way.
      if (document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      (returnFocusRef?.current ?? previousFocus)?.focus();
    };
  }, [returnFocusRef]);

  // Everything the pop-up leaves out (notifications, the rest of the bot's
  // profile) is in the full settings, opened at Voice. In a room the bot is a
  // member, so open its chat first, as the call help always did.
  const openAllSettings = () => {
    close();
    if (state.selectedId !== bot.id) openBot(dispatch, bot, showThreads);
    dispatch({ type: "toggleSettings", open: true, section: "voice" });
  };

  // 2026-10-16 (JC): drawn like Settings: the bot's avatar beside the
  // title, the round close button, the same VoiceSettings card, the call
  // in a pill once the voice is ready, "All voice settings" as a row.
  return createPortal(
    <div
      className={DIALOG.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        tabIndex={-1}
        data-voice-setup-dialog={bot.id}
        className={`${DIALOG.frame} ${DIALOG.width.lg}`}
      >
        <DialogCloseButton label={t("call.voiceSetup.close")} onClick={close} />
        <header className={DIALOG.header}>
          <div className="flex min-w-0 items-center gap-3">
            <BotAvatar bot={bot} state={ready ? "happy" : "listening"} size={36} />
            <div className="min-w-0">
              <h2 id={titleId} className={`${DIALOG.title} truncate`}>
                {t("call.voiceSetup.title", { name: bot.name })}
              </h2>
              <p id={subtitleId} className={DIALOG.subtitle}>
                {t("call.voiceSetup.subtitle")}
              </p>
            </div>
          </div>
        </header>

        <div className={DIALOG.body}>
          {state.config?.tts ? (
            <VoiceSettings bot={bot} onPatch={patch} />
          ) : (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {t("call.voiceSetup.loading")}
            </div>
          )}

          <div className={GROUP_CARD}>
            {/* Mounted before it has anything to say, so the line is
                announced the moment the voice is ready. */}
            <div role="status" aria-live="polite" className="empty:hidden">
              {ready && (
                <div className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-1.5">
                  <CheckCircle2 size={15} className="shrink-0 text-success" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">
                    {t("call.voiceSetup.ready", { name: callName })}
                  </span>
                  <button
                    type="button"
                    data-voice-setup-start
                    onClick={onStartCall}
                    className={PRIMARY_PILL}
                  >
                    <Phone size={14} aria-hidden="true" />
                    {t("call.voiceSetup.startCall")}
                  </button>
                </div>
              )}
            </div>
            <span data-voice-setup-all-settings="" className="contents">
              <LinkRow label={t("call.voiceSetup.allSettings")} onClick={openAllSettings} />
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
