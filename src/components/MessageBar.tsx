import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis, SmilePlus } from "lucide-react";
import { popoverClosesOnKey, usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useMenuMotion } from "./MenuMotion";
import { ReactButton, ReactionPicker } from "./Reactions";

const CloseMenu = createContext<() => void>(() => {});

/** One entry of the "…" menu: an icon and a label, so what a control does is
 * said in words instead of guessed from a glyph. Choosing it closes the menu. */
export function MessageMenuItem({
  label,
  icon,
  onSelect,
  disabled = false,
  active = false,
  hidden = false,
  shortcut,
}: {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** A mode that is on (raw markdown, speaking). */
  active?: boolean;
  hidden?: boolean;
  /** One letter that chooses this entry while the menu is open. */
  shortcut?: string;
}) {
  const close = useContext(CloseMenu);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-checked={active || undefined}
      aria-keyshortcuts={shortcut ? shortcut.toUpperCase() : undefined}
      data-shortcut={shortcut?.toLowerCase()}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
        active ? "text-accent" : "text-ink",
        hidden && "hidden",
      )}
    >
      <span className="flex shrink-0 items-center" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <kbd className="shrink-0 font-sans text-[11px] text-ink-tertiary">{shortcut.toUpperCase()}</kbd>}
    </button>
  );
}

/** The quiet controls beside a chat message: the copy button and a "…" menu on
 * one row, the time under them. The rest (raw markdown, read aloud,
 * regenerate, edit, reply, pin) lives in the menu, so the column stays about
 * two buttons wide and never pushes into the bubble, even in the phone layout
 * or the narrow desktop panel.
 *
 * Hover or keyboard focus on the message reveals it, touch screens always show
 * it. `visible` keeps it out while a mode the menu turned on needs to be seen
 * (raw markdown, a message being read aloud). */
export function MessageBar({
  side,
  time,
  copy,
  react,
  visible = false,
  children,
}: {
  side: "user" | "bot";
  time: string;
  /** The copy button, when the message has text to copy. */
  copy?: ReactNode;
  /** Emoji reactions (src/components/Reactions.tsx): the smiley beside copy,
   * its picker, and "Add reaction" (E) first in the menu. */
  react?: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (emoji: string) => void; mine?: readonly string[] };
  visible?: boolean;
  /** The menu's entries, as MessageMenuItem. */
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const picking = Boolean(react?.open);
  const motion = useMenuMotion(open);
  const mirrored = side === "user";
  usePopoverDismiss(open, rootRef, () => setOpen(false));
  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);
  return (
    <div
      ref={rootRef}
      data-testid="message-actions"
      data-message-bar
      data-open={open ? "true" : undefined}
      className={cn(
        "relative flex shrink-0 flex-col self-end pb-0.5 transition-opacity",
        mirrored ? "items-end" : "items-start",
        open || visible || picking
          ? "opacity-100"
          : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100",
      )}
      onKeyDown={(event) => {
        if (!open) return;
        // a letter chooses the menu entry that carries it (E: Add reaction)
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const entry = rootRef.current?.querySelector<HTMLElement>(`[role="menuitem"][data-shortcut="${CSS.escape(event.key.toLowerCase())}"]:not(:disabled)`);
          if (entry) {
            event.preventDefault();
            entry.click();
            return;
          }
        }
        if (!popoverClosesOnKey(event.nativeEvent)) return;
        event.preventDefault();
        setOpen(false);
      }}
    >
      <div className={cn("flex items-center", mirrored && "flex-row-reverse")}>
        {react && <ReactButton open={react.open} onToggle={() => react.onOpenChange(!react.open)} />}
        {copy}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={t("chat.messageActions")}
          title={t("chat.messageActions")}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            "rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink",
            open && "bg-raised text-ink",
          )}
        >
          <Ellipsis size={14} aria-hidden="true" />
        </button>
      </div>
      <span data-message-time className="px-1.5 text-[11px] tabular-nums leading-4 whitespace-nowrap text-ink-tertiary">
        {time}
      </span>
      {react?.open && (
        <ReactionPicker
          align={mirrored ? "end" : "start"}
          mine={react.mine}
          onPick={react.onPick}
          onClose={() => react.onOpenChange(false)}
        />
      )}
      {motion.shown && (
        <CloseMenu.Provider value={() => setOpen(false)}>
          <div
            role="menu"
            aria-label={t("chat.messageActions")}
            className={cn(
              "absolute bottom-full z-40 mb-1 flex w-max min-w-[11rem] max-w-[min(16rem,calc(100vw-2rem))] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5",
              mirrored ? "left-0" : "right-0",
              motion.className,
            )}
            {...motion.exitProps}
          >
            {react && (
              <MessageMenuItem label={t("reactions.add")} icon={<SmilePlus size={14} />} shortcut="e" onSelect={() => react.onOpenChange(true)} />
            )}
            {children}
          </div>
        </CloseMenu.Provider>
      )}
    </div>
  );
}
