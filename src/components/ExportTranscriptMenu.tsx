import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Share } from "lucide-react";

import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
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
}

/**
 * A dropdown menu button in the chat header allowing users to export the current
 * conversation transcript either by copying to clipboard or downloading as Markdown.
 */
export function ExportTranscriptMenu({
  title,
  messages,
  botName,
  isGroup = false,
  className,
}: ExportTranscriptMenuProps) {
  const [open, setOpen] = useState(false);
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
        aria-label="Export conversation"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(CIRCLE_BUTTON, open && "bg-elevated-hover", className)}
        title="Export conversation as Markdown"
      >
        <Share size={18} strokeWidth={1.75} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Export options"
          className="absolute right-0 top-full z-40 mt-1 flex w-[220px] min-w-[200px] flex-col gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px]"
        >
          <div className="px-2 py-1 text-[12px] leading-4 text-ink-secondary">
            Export Conversation
          </div>

          {!hasMessages ? (
            <div className="px-2 py-1.5 text-[12px] text-ink-secondary">
              No messages to export yet.
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
                  {copied ? "Copied to clipboard!" : "Copy as Markdown"}
                </span>
              </button>

              {copyFailed && (
                <div role="status" className="px-2 py-1.5 text-[12px] text-ink-secondary">
                  Clipboard unavailable. Download the Markdown file instead.
                </div>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={handleDownload}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover"
              >
                <Download size={16} className="shrink-0 text-ink" />
                <span className="flex-1 truncate">Download as .md</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
