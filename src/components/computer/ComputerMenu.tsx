// The Computer tab's machine menu. One control, the width of the panel:
// the chosen machine's icon, its full name (never cut off), and its power
// (a dot and Éteint / Allumé, or the other states). The list does the same
// for every machine. Arrow keys, Home, End, Enter, Space and Escape work
// while focus stays on the button. Picking one only changes the screen.
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { computerMenuOnKey, powerLabelKey, type ComputerPower } from "@/lib/computer-menu";
import { t } from "@/lib/i18n";

/** One machine, or the browser, in the menu. */
export interface ScreenPickerItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** The bot works here. */
  here?: boolean;
  /** Unknown until the computer has been asked: the row then has no power. */
  status?: ComputerPower;
}

const POWER_DOT: Record<ComputerPower, string> = {
  on: "bg-success",
  off: "bg-ink-secondary",
  paused: "bg-warning",
  starting: "bg-accent",
  error: "bg-danger",
  unavailable: "bg-ink-secondary",
};

/** Cloud and each of the person's computers by name, then the browser.
 * The closed control shows the chosen machine; the list shows every one. */
export function ScreenPicker({ items, chosen, onPick, initiallyOpen = false }: {
  items: ScreenPickerItem[];
  chosen: string | null;
  onPick: (key: string) => void;
  /** Tests and the screenshot page start it open. */
  initiallyOpen?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = Math.max(0, items.findIndex((item) => item.key === chosen));
  const [open, setOpen] = useState(initiallyOpen);
  const [active, setActive] = useState(selectedIndex);
  const selected = items.find((item) => item.key === chosen) ?? items[0];

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target instanceof Node ? event.target : null)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  if (!selected) return null;

  const optionId = (index: number) => `${listId}-opt-${index}`;
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };
  const choose = (index: number) => {
    const item = items[index];
    if (item) onPick(item.key);
    close(true);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const result = computerMenuOnKey({
      key: event.key,
      open,
      count: items.length,
      active,
      chosen: selectedIndex,
      labels: items.map((item) => item.label),
      altKey: event.altKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    });
    if (!result.handled && !result.close) return;
    if (result.handled) event.preventDefault();
    if (result.handled && event.key === "Escape") event.stopPropagation();
    setActive(result.active);
    if (result.select !== null) choose(result.select);
    else if (result.close) close(event.key === "Escape");
    else setOpen(result.open);
  };

  return (
    <div
      ref={rootRef}
      data-computer-picker=""
      data-computer-options={items.map((item) => item.key).join(" ")}
      className={cn("relative w-full", open && "z-20")}
      onKeyDown={onKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        data-computer-choice={selected.key}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        title={selected.here ? t("orgComputer.choice.worksHere", { name: selected.label }) : selected.label}
        onClick={() => {
          if (open) close(false);
          else { setActive(selectedIndex); setOpen(true); }
        }}
        className="flex w-full items-center gap-2.5 rounded-xl border border-hairline bg-card px-3 py-2 text-left text-ink hover:bg-raised-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <MachineRow item={selected} surface="panel" />
        <ChevronDown size={16} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={t("orgComputer.choice.label")}
          data-computer-menu=""
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-popover-hairline popover-surface bg-popover p-1 shadow-2xl shadow-black/50"
        >
          {items.map((item, index) => {
            const isChosen = item.key === chosen;
            return (
              <button
                key={item.key}
                type="button"
                role="option"
                id={optionId(index)}
                aria-selected={isChosen}
                data-computer-choice={item.key}
                data-active={index === active ? "" : undefined}
                title={item.here ? t("orgComputer.choice.worksHere", { name: item.label }) : item.label}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-popover-ink outline-none hover:bg-popover-hover",
                  (isChosen || index === active) && "bg-popover-hover",
                  index === active && "ring-2 ring-inset ring-accent/60",
                )}
              >
                <MachineRow item={item} surface="menu" />
                <Check size={15} aria-hidden="true" className={cn("shrink-0 text-popover-accent", isChosen ? "opacity-100" : "opacity-0")} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MachineRow({ item, surface }: { item: ScreenPickerItem; surface: "panel" | "menu" }) {
  const menu = surface === "menu";
  const Icon = item.icon;
  const secondary = menu ? "text-popover-ink-secondary" : "text-ink-secondary";
  return (
    <>
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", menu ? "bg-popover-field text-popover-ink" : "bg-control text-ink-secondary")} aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-computer-name="" className="break-words text-[13px] leading-5">{item.label}</span>
        {item.here && <span className={cn("text-[11px] leading-4", secondary)}>{t("orgComputer.choice.worksHereShort")}</span>}
      </span>
      {item.status && (
        <span data-computer-power={item.status} className={cn("inline-flex shrink-0 items-center gap-1.5 text-[12px] leading-none", secondary)}>
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", POWER_DOT[item.status])} />
          {t(powerLabelKey(item.status))}
        </span>
      )}
    </>
  );
}
