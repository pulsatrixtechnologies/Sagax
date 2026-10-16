// The composer's round controls, measured on Grok Bot's prompt bar (0.71):
// 28 px circles 8 px apart, a quiet "secondary" circle (+, mic) and a filled
// call to action (Voice, or Send once something is typed) whose glyphs
// cross-fade (opacity and scale .5 -> 1, 200 ms, cubic-bezier(.22,1,.36,1)).
// While dictating, the mic and the CTA give way to a pill: a 10 px stop
// square, the timer (14/22, tabular) and an 18 x 13 px level meter, then a
// Send arrow. The + opens a menu above it, aligned on its start edge.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Check, Clock, Loader2, Mic, Paperclip, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatDictationTime } from "@/lib/composer-dictation";
import { focusFirstMenuItem, moveMenuFocus } from "@/lib/menu-keys";
import { CTA_CIRCLE, CTA_DEFAULT, CTA_TONED, ctaStyle, type BotCtaColors } from "@/lib/voice-cta";
import { useMenuMotion } from "./MenuMotion";

/** The quiet circle: a translucent ink wash, a 0.5 px inner hairline, tertiary ink brightening on hover. */
export const SECONDARY_CIRCLE = cn(
  CTA_CIRCLE,
  "bg-ink/[0.06] text-ink-tertiary shadow-[inset_0_0_0_0.5px_var(--color-border)] hover:bg-ink/[0.1] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
);

/** Grok Bot's glyph cross-fade. */
const GLYPH = "absolute inset-0 m-auto transition-[opacity,transform] duration-200 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none";
const glyphShown = (shown: boolean) => (shown ? "opacity-100 scale-100" : "opacity-0 scale-50");
/** The seat's fade: no transform once shown, so the Voice button's popover is not trapped in a stacking context. */
const seatShown = (shown: boolean) => (shown ? "opacity-100" : "opacity-0 scale-50");

/** The "Teach a task" mark: a ring and a dot, in the danger red (a recording). */
export function RecordMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" fill="none" className={cn("shrink-0 text-danger", className)}>
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="8" r="2.9" fill="currentColor" />
    </svg>
  );
}

export interface PlusMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Rows of one group sit together; a hairline separates the groups. */
  group?: "add" | "modes";
  /** A mode: a checkbox row, checked while it is on. */
  checked?: boolean;
  /** What else reaches it (`/goal`), at the row's end. */
  hint?: string;
}

/** The + at the start of the composer and its menu, in groups (Grok Bot's
 * composer actions, Cursor's grouped menus): add (Attach files, Teach a
 * task), modes (Goal, Setup), then the conversation's own settings as rows
 * that open beside it (`rows`, rendered by their owners: approval level,
 * workspace). */
export function ComposerPlusMenu({
  items,
  rows,
  disabled = false,
  initialOpen = false,
}: {
  items: PlusMenuItem[];
  /** Rows that own a menu of their own; each gets `close` to call once picked. */
  rows?: (close: () => void) => ReactNode;
  disabled?: boolean;
  /** Tests and the gallery: render with the menu open. */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const motion = useMenuMotion(open);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // a row's own menu is open: its Escape closes it first
      if (menuRef.current?.querySelector('[aria-expanded="true"]')) return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || initialOpen) return;
    const frame = requestAnimationFrame(() => focusFirstMenuItem(menuRef.current));
    return () => cancelAnimationFrame(frame);
  }, [open, initialOpen]);

  return (
    <div ref={wrapperRef} className="relative flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("composer.plus.aria")}
        title={t("composer.plus.aria")}
        disabled={disabled}
        data-composer-plus=""
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={SECONDARY_CIRCLE}
      >
        <Plus size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {motion.shown && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("composer.plus.aria")}
          data-composer-plus-menu=""
          onKeyDown={(event) => {
            if (moveMenuFocus(event.currentTarget, event.key, document.activeElement)) event.preventDefault();
          }}
          className={cn(
            "absolute bottom-full left-0 z-40 mb-2 flex min-w-[220px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5",
            motion.className,
          )}
          {...motion.exitProps}
        >
          {items.map((item, index) => {
            const startsGroup = index > 0 && (items[index - 1]!.group ?? "add") !== (item.group ?? "add");
            const mode = item.checked !== undefined;
            return (
              <div key={item.id} className="contents">
                {startsGroup && <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />}
                <button
                  type="button"
                  role={mode ? "menuitemcheckbox" : "menuitem"}
                  aria-checked={mode ? item.checked : undefined}
                  disabled={item.disabled}
                  data-composer-plus-item={item.id}
                  data-composer-plus-group={item.group ?? "add"}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                  className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-[18px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 font-mono text-[11px] text-ink-tertiary">{item.hint}</span>}
                  {mode && (
                    <Check size={14} aria-hidden="true" className={cn("shrink-0 text-accent", !item.checked && "invisible")} />
                  )}
                </button>
              </div>
            );
          })}
          {rows && (() => {
            const content = rows(() => close(true));
            return content ? (
              <>
                <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />
                {content}
              </>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}

/** Attach files: the menu's first row. */
export const ATTACH_ICON = <Paperclip size={16} aria-hidden="true" />;

/** The grey mic: dictation into the field. Without an engine it says so and opens the Keys card. */
export function ComposerMicButton({ onClick, hidden = false, needsSetup = false, shortcut }: {
  onClick: () => void;
  /** Folded away (width 0) while the dictation pill shows. */
  hidden?: boolean;
  needsSetup?: boolean;
  /** "⌘D" or "Ctrl+D". */
  shortcut: string;
}) {
  const label = needsSetup ? t("composer.dictation.needsKey") : t("composer.dictation.start");
  return (
    <span
      className={cn(
        "flex shrink-0 overflow-hidden transition-[width,margin] duration-200 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
        hidden ? "me-0 w-0" : "w-7",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={needsSetup ? label : t("composer.dictation.holdHint", { shortcut })}
        data-composer-mic={needsSetup ? "setup" : ""}
        tabIndex={hidden ? -1 : undefined}
        aria-hidden={hidden || undefined}
        className={cn(SECONDARY_CIRCLE, hidden && "invisible opacity-0")}
      >
        <Mic size={15} strokeWidth={2.25} aria-hidden="true" className={cn("transition-transform duration-200", hidden && "scale-50")} />
      </button>
    </span>
  );
}

/** Send, in the CTA's place once something is typed. */
export function ComposerSendButton({ onClick, disabled, tone, queued, label, title }: {
  onClick: () => void;
  disabled: boolean;
  tone?: BotCtaColors | null;
  /** The turn is busy and the message will wait: a clock on the quiet circle. */
  queued: boolean;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      data-composer-send=""
      style={queued ? undefined : ctaStyle(tone)}
      className={cn(
        queued ? SECONDARY_CIRCLE : cn(CTA_CIRCLE, tone ? CTA_TONED : CTA_DEFAULT),
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      <Clock size={15} aria-hidden="true" className={cn(GLYPH, glyphShown(queued))} />
      <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" className={cn(GLYPH, glyphShown(!queued))} />
    </button>
  );
}

/** The CTA seat: Send when something is typed, Voice otherwise, cross-faded. */
export function ComposerCtaSeat({ send, voice, typed }: { send: ReactNode; voice: ReactNode; typed: boolean }) {
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center" data-composer-cta={typed ? "send" : "voice"}>
      <span inert={typed} className={cn("absolute inset-0 flex items-center justify-center", GLYPH, seatShown(!typed), typed && "pointer-events-none")}>{voice}</span>
      <span inert={!typed} className={cn("absolute inset-0 flex items-center justify-center", GLYPH, seatShown(typed), !typed && "pointer-events-none")}>{send}</span>
    </span>
  );
}

/** The level meter: five 2 px bars, 2 px apart, 3..13 px tall, in the secondary ink. */
export function LevelMeter({ levels }: { levels: number[] }) {
  return (
    <span aria-hidden="true" className="flex h-[13px] w-[18px] shrink-0 items-center gap-[2px]" data-dictation-levels="">
      {levels.map((level, index) => (
        <span
          key={index}
          className="w-[2px] rounded-full bg-ink-secondary transition-[height] duration-75 motion-reduce:transition-none"
          style={{ height: `${Math.round(3 + level * 10)}px` }}
        />
      ))}
    </span>
  );
}

/** The dictation pill: stop square, timer and levels (click stops, Escape discards), then Send. */
export function DictationChip({ seconds, levels, processing, onStop, onCancel, onSend, sendTone }: {
  seconds: number;
  levels: number[];
  processing: boolean;
  onStop: () => void;
  onCancel: () => void;
  onSend: () => void;
  sendTone?: BotCtaColors | null;
}) {
  const time = formatDictationTime(seconds);
  if (processing) {
    return (
      <span role="status" aria-label={t("composer.dictation.processing")} title={t("composer.dictation.processing")} className={cn(CTA_CIRCLE, "text-ink-secondary")} data-dictation-chip="processing">
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-2" data-dictation-chip="recording">
      <button
        type="button"
        onClick={onStop}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        aria-label={t("composer.dictation.stopAria", { time })}
        title={t("composer.dictation.stopHint")}
        className="box-border inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-ink/[0.06] py-1 pe-2.5 ps-2.5 text-ink transition-colors duration-[120ms] hover:bg-ink/[0.1] focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px] bg-ink" />
        <span aria-hidden="true" className="shrink-0 text-[14px] leading-[22px] tracking-[-0.15px] tabular-nums">{time}</span>
        <LevelMeter levels={levels} />
      </button>
      <ComposerSendButton onClick={onSend} disabled={false} tone={sendTone} queued={false} label={t("composer.send.message")} title={t("composer.send.message")} />
    </span>
  );
}
