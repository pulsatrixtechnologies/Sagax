// The keyboard shortcuts cheat sheet. 2026-10-16 (JC): drawn like Settings
// and like Grok Bot's own sheet: the title and the round close button, a
// search field, then each category as a grey heading over one card of
// compact rows (what the shortcut does at the left, its keys at the right).
import { useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import {
  filterShortcutGroups,
  isMacPlatform,
  shortcutGroupsFor,
  shortcutKeysForPlatform,
  type ShortcutGroup,
  type ShortcutItem,
} from "@/lib/keyboard-shortcuts";
import { t } from "@/lib/i18n";
import { useSendKey } from "@/lib/send-key";
import type { LocaleKey } from "@/locales";
import { DIALOG, DialogCloseButton, PILL, SettingsGroup } from "./SettingsPrimitives";

/** Props for the KeyboardShortcutsModal component. */
export interface KeyboardShortcutsModalProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Callback fired when the user requests closing the dialog. */
  onClose: () => void;
}

/** The catalog is written in English (lib/keyboard-shortcuts.ts); the sheet
 * shows it in the app language, and searches what it shows. */
const GROUP_KEY: Record<string, LocaleKey> = {
  Navigation: "shortcuts.group.navigation",
  "Chat & Composer": "shortcuts.group.chat",
  Calls: "shortcuts.group.calls",
  "Management & Groups": "shortcuts.group.management",
};

const ITEM_KEY: Record<string, LocaleKey> = {
  "command-palette": "shortcuts.item.commandPalette",
  "new-bot": "shortcuts.item.newBot",
  "jump-bot": "shortcuts.item.jumpBot",
  "switch-bot": "shortcuts.item.switchBot",
  "find-conversation": "shortcuts.item.findConversation",
  "send-message": "shortcuts.item.sendMessage",
  dictate: "shortcuts.item.dictate",
  "new-line": "shortcuts.item.newLine",
  "edit-last-message": "shortcuts.item.editLastMessage",
  "close-panel": "shortcuts.item.closePanel",
  "shortcuts-cheat-sheet": "shortcuts.item.cheatSheet",
  "live-call-mute": "shortcuts.item.liveCallMute",
  "live-call-hang-up": "shortcuts.item.liveCallHangUp",
  "save-bulletin": "shortcuts.item.saveBulletin",
  "reorder-section": "shortcuts.item.reorderSection",
};

export function localizedShortcutGroups(groups: readonly ShortcutGroup[]): ShortcutGroup[] {
  return groups.map((group) => ({
    category: GROUP_KEY[group.category] ? t(GROUP_KEY[group.category]!) : group.category,
    items: group.items.map((item) => (ITEM_KEY[item.id] ? { ...item, description: t(ITEM_KEY[item.id]!) } : item)),
  }));
}

/** One shortcut: what it does at the left, its keycaps at the right. */
function ShortcutRow({ item, isMac }: { item: ShortcutItem; isMac: boolean }) {
  const keys = shortcutKeysForPlatform(item, isMac);

  return (
    <div className="flex min-h-[36px] items-center justify-between gap-4 px-3.5 py-1.5" data-shortcut={item.id}>
      <span className="min-w-0 text-[13px] leading-[18px] text-ink">{item.description}</span>
      <div className="flex shrink-0 items-center gap-1">
        {keys.map((key, index) => (
          <kbd
            key={index}
            className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border-[0.5px] border-border bg-inset px-1.5 font-sans text-[12px] leading-none text-ink-secondary"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}

/**
 * A modal cheat sheet displaying all available keyboard shortcuts categorized
 * into Navigation, Chat & Composer, Calls and Management.
 */
export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = isMacPlatform();
  const sendKey = useSendKey();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    setQuery("");
    dialog.showModal();
    inputRef.current?.focus();
    // Close before unmount so the browser restores focus to the opener.
    return () => dialog.close();
  }, [open]);

  if (!open) return null;

  const groups = filterShortcutGroups(localizedShortcutGroups(shortcutGroupsFor(sendKey)), query, isMac);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="shortcuts-dialog-title"
      className={`m-auto h-auto max-h-[min(700px,calc(100dvh-48px))] w-[min(560px,calc(100%-24px))] max-w-none overflow-hidden rounded-[14px] border border-border bg-app p-0 text-ink backdrop:bg-black/50`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[min(700px,calc(100dvh-48px))] flex-col">
        <DialogCloseButton label={t("shortcuts.close")} onClick={onClose} />
        <div className={DIALOG.header}>
          <h2 id="shortcuts-dialog-title" className={DIALOG.title}>
            {t("shortcuts.title")}
          </h2>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 focus-within:border-border-strong">
            <Search size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("shortcuts.search")}
              aria-label={t("shortcuts.searchLabel")}
              className="w-full min-w-0 bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
        </div>

        <div className={DIALOG.body}>
          {groups.length === 0 ? (
            <p role="status" className="py-8 text-center text-[13px] text-ink-secondary">
              {t("shortcuts.none", { query })}
            </p>
          ) : (
            groups.map((group) => (
              <SettingsGroup key={group.category} title={group.category} groupId={`shortcuts.${group.category}`}>
                {group.items.map((item) => (
                  <ShortcutRow key={item.id} item={item} isMac={isMac} />
                ))}
              </SettingsGroup>
            ))
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-5">
          <span className="min-w-0 text-[12px] leading-4 text-ink-secondary">
            {t("shortcuts.hintBefore")}{" "}
            <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border-[0.5px] border-border bg-inset px-1 font-sans text-[11px] text-ink-secondary">?</kbd>{" "}
            {t("shortcuts.hintAfter")}
          </span>
          <button type="button" onClick={onClose} className={PILL}>
            {t("shortcuts.done")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
