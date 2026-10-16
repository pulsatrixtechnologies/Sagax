// The composer's emoji button: the full catalogue (EmojiCatalogGrid, en +
// fr search words, category tabs) in a popover above the field. A pick is
// inserted at the caret (or replaces the selection) and the field keeps the
// focus, so several emoji can follow one another. Escape or a press outside
// closes it.
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Smile } from "lucide-react";

import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { SECONDARY_CIRCLE } from "./ComposerControls";
import { EmojiCatalogGrid, useEmojiChoices } from "./EmojiCatalogGrid";

/** The text with `emoji` at the selection, and where the caret goes. Pure. */
export function insertEmoji(text: string, emoji: string, start: number, end = start): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return { text: `${text.slice(0, from)}${emoji}${text.slice(to)}`, caret: from + emoji.length };
}

export function ComposerEmojiButton({ inputRef, text, onInsert }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  onInsert: (next: string, caret: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // The selection as it was when the picker opened: focus moves to the search.
  const selection = useRef({ start: text.length, end: text.length });
  const catalog = useEmojiChoices(open ? query : "");
  usePopoverDismiss(open, rootRef, () => setOpen(false));
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery("");
  }, [open]);

  const toggle = () => {
    if (!open) {
      const input = inputRef.current;
      selection.current = { start: input?.selectionStart ?? text.length, end: input?.selectionEnd ?? text.length };
    }
    setOpen((value) => !value);
  };
  const pick = (emoji: string) => {
    const next = insertEmoji(text, emoji, selection.current.start, selection.current.end);
    selection.current = { start: next.caret, end: next.caret };
    onInsert(next.text, next.caret);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.setSelectionRange(next.caret, next.caret);
    });
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = catalog.choices[0];
      if (first) pick(first.emoji);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      rootRef.current?.querySelector<HTMLElement>("[data-emoji-result]")?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      inputRef.current?.focus();
    }
  };
  return (
    <span ref={rootRef} className="relative flex shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-label={t("emoji.insert")}
        title={t("emoji.insert")}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-composer-emoji
        className={cn(SECONDARY_CIRCLE, open && "bg-raised text-ink")}
      >
        <Smile size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("emoji.insert")}
          data-composer-emoji-picker
          className="absolute bottom-full right-0 z-40 mb-2 flex w-[18rem] max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5"
        >
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
            placeholder={t("reactions.search")}
            aria-label={t("reactions.search")}
            className="h-7 rounded-md border-[0.5px] border-border bg-inset px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
          />
          <EmojiCatalogGrid state={catalog} onPick={pick} labelFor={(choice) => t("emoji.insertOne", { emoji: choice.emoji })} />
        </div>
      )}
    </span>
  );
}
