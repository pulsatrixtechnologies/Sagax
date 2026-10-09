// The model picker's one model control (2026-10-09, JC): a compact
// select-like menu listing the provider's models under two headings, Cloud
// and Local, the current model checked and the provider's default marked. A
// model the provider cannot run is shown disabled with a short tooltip.
// The open state belongs to the caller (ModelPicker), so the rows it builds
// stay plain children here.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { EngineGroupLabel } from "./EngineGroupLabel";

const OPTION = '[role="option"]:not([disabled])';

export function ModelDropdown({ open, onOpenChange, label, disabled = false, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the closed control reads: the current model. */
  label: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Opening lands on the checked model (else the first one); a click
  // outside closes the menu without closing the dialog.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    (list?.querySelector<HTMLElement>(`${OPTION}[aria-selected="true"]`) ?? list?.querySelector<HTMLElement>(OPTION))?.focus();
    const outside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target instanceof Node ? event.target : null)) onOpenChange(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open, onOpenChange]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "Escape") {
      // The dialog closes on Escape too: this one only closes the menu.
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>(OPTION) ?? [])];
    if (!options.length) return;
    event.preventDefault();
    const at = options.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? options.length - 1
      : event.key === "ArrowDown" ? (at + 1) % options.length
      : (at <= 0 ? options.length : at) - 1;
    options[next]?.focus();
  };

  return (
    <div ref={rootRef} data-model-dropdown className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        data-model-dropdown-trigger
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-left text-[13px] text-ink hover:bg-control/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2">{label}</span>
        <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={t("model.models")}
          data-model-list
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-[min(320px,45dvh)] overflow-y-auto rounded-xl border border-hairline/50 bg-card p-1 shadow-xl shadow-black/30"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** One heading of the menu (Cloud, Local) and its models. */
export function ModelMenuGroup({ label, children, ...data }: { label: string; children: ReactNode } & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div role="group" aria-label={label} className="py-0.5" {...data}>
      <EngineGroupLabel className="px-2 pb-0.5 pt-1">{label}</EngineGroupLabel>
      {children}
    </div>
  );
}

/** One model of the menu. */
export function ModelMenuRow({ id, label, provider, current, isDefault, loaded = false, botModel = false, unavailable, onPick }: {
  id: string;
  label: string;
  /** The model's own provider, when the engine serves several (OpenRouter). */
  provider?: string;
  current: boolean;
  isDefault: boolean;
  loaded?: boolean;
  /** The bot's model, in a thread's picker. */
  botModel?: boolean;
  /** Why this provider cannot run it: disabled, the reason as a tooltip. */
  unavailable?: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={current}
      data-model-option={id}
      data-model-unavailable={unavailable ? "" : undefined}
      disabled={Boolean(unavailable)}
      title={unavailable}
      onClick={onPick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink outline-none hover:bg-control/60 focus-visible:bg-control/60",
        "disabled:cursor-not-allowed disabled:text-ink-secondary/50 disabled:hover:bg-transparent",
        current && "bg-control",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{label}</span>
        {provider && (
          <span className="shrink-0 rounded bg-inset px-1.5 py-px text-[10px] text-ink-secondary" title={t("model.provider", { name: provider })}>{provider}</span>
        )}
        {isDefault && <span data-model-default className="shrink-0 rounded bg-inset px-1.5 py-px text-[10px] text-ink-secondary">{t("model.defaultTag")}</span>}
        {loaded && <span className="shrink-0 rounded bg-accent/10 px-1.5 py-px text-[10px] text-accent">{t("model.loadedTag")}</span>}
        {botModel && <span data-bot-model className="shrink-0 text-[11px] text-ink-secondary">{t("model.botModelTag")}</span>}
      </span>
      {current && <Check size={14} aria-hidden="true" className="shrink-0 text-accent" />}
    </button>
  );
}
