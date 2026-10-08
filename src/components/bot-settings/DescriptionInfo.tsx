// The small (i) beside a bot's (or group's) name at the top of its side
// panel. It reveals the description in a popover, and someone allowed to
// edit changes it there in a small text box: the panel has no description
// field of its own.
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { inputCls } from "./field";

export function DescriptionInfo({
  value,
  onSave,
  maxLength,
  label,
  emptyText,
  placeholder,
  initiallyOpen = false,
}: {
  value: string;
  /** Absent: read-only. */
  onSave?: (next: string) => void;
  maxLength?: number;
  /** The button's accessible name, e.g. "Description". */
  label: string;
  /** Shown when there is nothing to read. */
  emptyText: string;
  placeholder?: string;
  /** Tests render it open. */
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => {
    if (!open) return;
    // A click elsewhere closes it, as any popover.
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setEditing(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const text = value.trim();
  const close = () => { setOpen(false); setEditing(false); setDraft(value); };
  const save = () => {
    if (onSave && draft !== value) onSave(draft);
    setEditing(false);
    setOpen(false);
  };

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={text || label}
        data-description-info="button"
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "flex size-6 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          open && "bg-hover text-ink",
        )}
      >
        <Info size={14} strokeWidth={1.75} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          data-description-info="popover"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation?.();
            close();
          }}
          className="absolute left-1/2 top-full z-30 mt-2 w-[min(280px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-hairline-weak popover-surface bg-elevated p-3 text-left shadow-xl"
        >
          <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{label}</div>
          {editing ? (
            <>
              <textarea
                autoFocus
                aria-label={label}
                value={draft}
                maxLength={maxLength}
                placeholder={placeholder}
                rows={4}
                onChange={(event) => setDraft(event.target.value)}
                className={cn(inputCls, "resize-y text-[12.5px] leading-relaxed")}
              />
              <div className="mt-2 flex justify-end gap-1.5">
                <button type="button" onClick={() => { setEditing(false); setDraft(value); }} className="rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink">{t("common.cancel")}</button>
                <button type="button" onClick={save} className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90">{t("common.save")}</button>
              </div>
            </>
          ) : (
            <>
              <p className={cn("max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed", text ? "text-ink" : "text-ink-secondary")}>
                {text || emptyText}
              </p>
              {onSave && (
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => setEditing(true)} className="rounded-md px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent/10">{t("botPanel.description.edit")}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
