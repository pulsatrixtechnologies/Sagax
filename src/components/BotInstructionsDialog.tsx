import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { BookOpen, X } from "lucide-react";

import { BotAvatar } from "./Avatar";
import { normalizeState } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { PRIMARY_PILL, SettingsGroup, DIALOG } from "./SettingsPrimitives";
import type { Bot } from "@/state/store";

export function BotInstructionsDialog({ bot, onClose, inline = false }: { bot: Bot; onClose: () => void; inline?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
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
      previousFocus?.focus();
    };
  }, [close]);

  const content = (
    <div
      className={cn(DIALOG.backdrop, "z-50")}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-instructions-title"
        tabIndex={-1}
        className={`animate-pop-in ${DIALOG.frame} max-w-[680px]`}
      >
        <header className={DIALOG.header}>
          <div className="flex min-w-0 items-center gap-3">
            <BotAvatar
              bot={bot}
              state={normalizeState(bot.mascotExpression) ?? "idle"}
              size={36}
              motion="none"
              motionKey={0}
              animated={false}
            />
            <div className="min-w-0">
              <h2 id="bot-instructions-title" className={`${DIALOG.title} truncate`}>
                {bot.name}
              </h2>
              <p className={`${DIALOG.subtitle} truncate`}>{bot.title || t("botInstructions.title")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("botInstructions.close")}
            className={cn(DIALOG.close, "disabled:opacity-40")}
          >
            <X size={18} className="pointer-events-none" />
          </button>
        </header>

        <div className={DIALOG.body}>
          <SettingsGroup groupId="bot-instructions" title={t("botInstructions.title")} plain>
            {bot.description.trim() ? (
              <div className="whitespace-pre-wrap break-words rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3 text-[13px] leading-6 text-ink">
                {bot.description}
              </div>
            ) : (
              <div className="rounded-xl border-[0.5px] border-dashed border-border bg-elevated px-5 py-10 text-center">
                <BookOpen size={20} aria-hidden="true" className="mx-auto text-ink-tertiary" />
                <p className="mt-3 text-[13px] text-ink">{t("botInstructions.empty")}</p>
                <p className="mt-1 text-[12px] text-ink-secondary">{t("botInstructions.emptyHint")}</p>
              </div>
            )}
          </SettingsGroup>
          <p className="-mt-3 px-1 text-[12px] text-ink-secondary">{t("botInstructions.everyTurn")}</p>
        </div>

        <footer className={DIALOG.footer}>
          <button type="button" onClick={close} className={PRIMARY_PILL}>
            {t("botInstructions.done")}
          </button>
        </footer>
      </div>
    </div>
  );
  return inline ? content : createPortal(content, document.body);
}
