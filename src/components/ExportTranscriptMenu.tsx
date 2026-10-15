import { useEffect, useRef, useState } from "react";
import { Bug, Check, Copy, Database, Download, MoreHorizontal, Package } from "lucide-react";

import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useMenuMotion } from "./MenuMotion";
import {
  copyTranscriptToClipboard,
  downloadMarkdownTranscript,
  formatTranscriptMarkdown,
  slugifyTranscriptFilename,
} from "@/lib/export-transcript";
import type { Message } from "@/state/store";

export interface ExportTranscriptMenuProps {
  /** Title of the conversation (bot name or channel name). */
  title: string;
  /** Messages to export. */
  messages: readonly Message[];
  /** Optional fallback bot name for 1:1 chats. */
  botName?: string;
  /** Whether this is a group room / channel. */
  isGroup?: boolean;
  /** Optional custom CSS classes for the trigger button. */
  className?: string;
  /** Download the bot as its `.sagaxbot.zip` (shown only when given: the
   * viewer may export this bot, src/lib/bot-zip.ts). */
  onExportBot?: () => void;
  /** Open or close the Inspector (Advanced mode; shown only when given). */
  onToggleInspector?: () => void;
  inspectorOpen?: boolean;
  /** The bot's Data window (Experimental; shown only when given). */
  data?: { label: string; onOpen: () => void };
}

/**
 * The conversation's one "..." button (JC, 2026-10-14): share and export
 * (copy or download the transcript, export the bot as a .zip), then the
 * Inspector and the Data window when they are on. It replaces the separate
 * Share, Inspector and Data buttons of the chat header and the bot panel.
 */
export function ExportTranscriptMenu({
  title,
  messages,
  botName,
  isGroup = false,
  className,
  onExportBot,
  onToggleInspector,
  inspectorOpen = false,
  data,
}: ExportTranscriptMenuProps) {
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const hasMessages = messages && messages.length > 0;

  /** Copy formatted Markdown transcript to clipboard with visual feedback. */
  const handleCopy = async () => {
    if (!hasMessages) return;
    const markdown = formatTranscriptMarkdown({
      title,
      messages,
      botName,
      isGroup,
    });
    const success = await copyTranscriptToClipboard(markdown);
    setCopyFailed(!success);
    if (success) {
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    }
  };

  /** Trigger browser download for the formatted Markdown transcript file. */
  const handleDownload = () => {
    if (!hasMessages) return;
    const markdown = formatTranscriptMarkdown({
      title,
      messages,
      botName,
      isGroup,
    });
    const filename = slugifyTranscriptFilename(title);
    downloadMarkdownTranscript(filename, markdown);
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t("chat.moreMenu.aria")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-conversation-menu=""
        className={cn(CIRCLE_BUTTON, open && "bg-elevated-hover", className)}
        title={t("chat.moreMenu.aria")}
      >
        <MoreHorizontal size={18} strokeWidth={1.75} />
      </button>

      {motion.shown && (
        <div
          role="menu"
          aria-label={t("chat.moreMenu.aria")}
          className={cn("absolute right-0 top-full z-40 mt-1 flex w-[240px] min-w-[200px] flex-col gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 text-[13px] leading-[18px]", motion.className)} {...motion.exitProps}
        >
          <div className="px-2 py-1 text-[12px] leading-4 text-ink-secondary">
            {t("chat.export.conversationHeading")}
          </div>

          {!hasMessages ? (
            <div className="px-2 py-1.5 text-[12px] text-ink-secondary">
              {t("chat.export.empty")}
            </div>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleCopy()}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
              >
                {copied ? (
                  <Check size={16} className="shrink-0 text-success" />
                ) : (
                  <Copy size={16} className="shrink-0 text-ink" />
                )}
                <span className="flex-1 truncate">
                  {copied ? t("chat.export.copied") : t("chat.export.copy")}
                </span>
              </button>

              {copyFailed && (
                <div role="status" className="px-2 py-1.5 text-[12px] text-ink-secondary">
                  {t("chat.export.copyFailed")}
                </div>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={handleDownload}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
              >
                <Download size={16} className="shrink-0 text-ink" />
                <span className="flex-1 truncate">{t("chat.export.download")}</span>
              </button>
            </>
          )}

          {onExportBot && (
            <>
              <div className="mx-2 my-1 h-px bg-hairline" aria-hidden="true" />
              <div className="px-2 py-1 text-[12px] leading-4 text-ink-secondary">
                {t("chat.export.botHeading")}
              </div>
              <button
                type="button"
                role="menuitem"
                data-export-bot-zip=""
                onClick={() => { setOpen(false); onExportBot(); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
              >
                <Package size={16} className="shrink-0 text-ink" />
                <span className="flex-1 truncate">{t("chat.export.botZip")}</span>
              </button>
            </>
          )}

          {(onToggleInspector || data) && <div className="mx-2 my-1 h-px bg-hairline" aria-hidden="true" />}
          {onToggleInspector && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={inspectorOpen}
              data-conversation-inspector=""
              title={t("chat.inspectorHint")}
              onClick={() => { setOpen(false); onToggleInspector(); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
            >
              <Bug size={16} className="shrink-0 text-ink" />
              <span className="flex-1 truncate">{t("chat.inspector")}</span>
              {inspectorOpen && <Check size={14} className="shrink-0 text-accent" />}
            </button>
          )}
          {data && (
            <button
              type="button"
              role="menuitem"
              data-data-window-button=""
              title={data.label}
              onClick={() => { setOpen(false); data.onOpen(); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
            >
              <Database size={16} className="shrink-0 text-ink" />
              <span className="flex-1 truncate">{t("dataWindow.open")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
