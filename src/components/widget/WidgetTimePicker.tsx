// A time of day, picked and never typed. The trigger is drawn like the
// DatePicker beside it and opens a list of times every `step` minutes from
// `min` to `max`. Focus stays on the trigger, as on a select-only combobox:
// the arrow keys, Page Up and Down (an hour), Home and End walk the list,
// typing a time ("9", "14", "930") jumps to it, Enter or Space takes it and
// Escape closes it. The value is "HH:MM" on a 24-hour clock; what is shown
// is the person's own way of writing a time.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Clock, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { widgetNumber, widgetString, type WidgetNode } from "../../../shared/widget";
import { useWidgetField, WIDGET_BARE, WIDGET_FIELD, WIDGET_FIELD_ACTION } from "./WidgetControls";

const DAY = 24 * 60;
/** One row of the list, and the list's own padding top and bottom. */
const ROW = 32;
const LIST_PAD = 10;
const LIST_MAX = ROW * 8 + LIST_PAD;
const EDGE = 8;

function minutesOf(time: string | undefined): number | undefined {
  const match = time ? /^(\d{1,2}):(\d{2})$/.exec(time) : null;
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
  return minutes !== undefined && minutes < DAY && Number(match![2]) < 60 ? minutes : undefined;
}

const timeOf = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "HH:MM", zero-padded, for any time a tree or an older record holds ("9:05" too); "" for anything else. */
export function widgetTime(value: string): string {
  const minutes = minutesOf(value.trim());
  return minutes === undefined ? "" : timeOf(minutes);
}

/** Every time on offer, in order: each `step` minutes (15 when it names none)
 * from `min` to `max` (the whole day when they are left out), and the time
 * the field holds where that falls between two steps. */
export function widgetTimeSlots(node: WidgetNode, held = ""): string[] {
  const from = minutesOf(widgetString(node, "min")) ?? 0;
  const to = minutesOf(widgetString(node, "max")) ?? DAY - 1;
  const step = Math.min(60, Math.max(1, Math.round(widgetNumber(node, "step") ?? 15)));
  const slots: string[] = [];
  for (let at = from; at <= to; at += step) slots.push(timeOf(at));
  const value = minutesOf(held);
  if (value !== undefined && value >= from && value <= to && !slots.includes(timeOf(value))) {
    slots.push(timeOf(value));
    slots.sort();
  }
  return slots;
}

let format: Intl.DateTimeFormat | undefined;

/** A time as the person writes one: "9:30 AM", "09:30", "9:30 am", by their locale. */
export function widgetTimeLabel(time: string): string {
  const minutes = minutesOf(time);
  if (minutes === undefined) return time;
  format ??= new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return format.format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

/** Where the list opens before anything is picked: at the first time from now on. */
function nearNow(slots: string[]): number {
  const now = new Date();
  const at = slots.findIndex((slot) => (minutesOf(slot) ?? 0) >= now.getHours() * 60 + now.getMinutes());
  return at >= 0 ? at : slots.length - 1;
}

/** The time whose written form, or whose digits, begin with what was typed. */
function seek(slots: string[], typed: string): number {
  const text = typed.toLowerCase().replace(/[\s:.]/g, "");
  const digits = typed.replace(/\D/g, "");
  return slots.findIndex((slot) => {
    const plain = slot.replace(":", "");
    return widgetTimeLabel(slot).toLowerCase().replace(/[\s:.]/g, "").startsWith(text)
      || (digits.length > 0 && (plain.startsWith(digits) || plain.replace(/^0/, "").startsWith(digits)));
  });
}

interface Place {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export function WidgetTimePicker({ node, bare }: { node: WidgetNode; bare: boolean }) {
  const field = useWidgetField(node);
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place>();
  const typed = useRef({ text: "", at: 0 });
  const value = widgetTime(field.text);
  const slots = useMemo(() => widgetTimeSlots(node, value), [node, value]);
  const chosen = value ? slots.indexOf(value) : -1;
  const showing = open && !field.disabled && slots.length > 0;

  // a field that locks (its press is on its way, the card settled) closes its list
  useEffect(() => {
    if (field.disabled) setOpen(false);
  }, [field.disabled]);

  const show = (at?: number) => {
    if (field.disabled || !slots.length) return;
    setActive(at ?? (chosen >= 0 ? chosen : nearNow(slots)));
    setOpen(true);
  };
  const take = (index: number) => {
    const slot = slots[index];
    if (slot) field.set(slot);
    setOpen(false);
  };

  // below the trigger, or above it where there is more room there; never past the window's edges
  useLayoutEffect(() => {
    if (!showing) return;
    const measure = (event?: Event) => {
      if (event?.target instanceof Node && list.current?.contains(event.target)) return;
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(Math.max(box.width, 168), window.innerWidth - EDGE * 2);
      const want = Math.min(LIST_MAX, slots.length * ROW + LIST_PAD);
      const below = window.innerHeight - box.bottom - EDGE - 4;
      const above = box.top - EDGE - 4;
      const down = below >= want || below >= above;
      const rtl = getComputedStyle(trigger.current!).direction === "rtl";
      const left = Math.max(EDGE, Math.min(rtl ? box.right - width : box.left, window.innerWidth - width - EDGE));
      const maxHeight = Math.max(ROW * 3, Math.min(want, down ? below : above));
      setPlace(down ? { left, width, maxHeight, top: box.bottom + 4 } : { left, width, maxHeight, bottom: window.innerHeight - box.top + 4 });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [showing, slots.length]);

  // a click anywhere else closes the list
  useEffect(() => {
    if (!showing) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !trigger.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [showing]);

  // the time it opens on sits in the middle of the list; after that the list follows the keys
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (!showing || !place) {
      opened.current = false;
      return;
    }
    const row = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView?.({ block: opened.current ? "nearest" : "center" });
    opened.current = true;
  }, [showing, place, active]);

  const jump = (key: string): boolean => {
    if (key.length !== 1 || !/[\d:apm.]/i.test(key)) return false;
    const now = Date.now();
    const text = (now - typed.current.at < 900 ? typed.current.text : "") + key;
    typed.current = { text, at: now };
    const at = seek(slots, text);
    if (at < 0) return true;
    if (showing) setActive(at);
    else show(at);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Alt with an arrow opens or closes the list, as on a select; other chords are not this field's
    if (field.disabled || event.ctrlKey || event.metaKey || (event.altKey && event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    const last = slots.length - 1;
    const hour = Math.max(1, Math.round(60 / Math.max(1, widgetNumber(node, "step") ?? 15)));
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: hour, PageUp: -hour };
    if (!showing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show();
      } else if (jump(event.key)) event.preventDefault();
      return;
    }
    if (event.key in step) setActive((at) => Math.min(last, Math.max(0, at + step[event.key]!)));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter" || event.key === " ") take(active);
    else if (event.key === "Escape") {
      // closes the list only: the chat's own Escape does not see it
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
      return;
    } else if (!jump(event.key)) return;
    event.preventDefault();
  };

  const { required, ...control } = field.control;
  const shown = value ? widgetTimeLabel(value) : widgetString(node, "placeholder") ?? t("widget.time.choose");
  return (
    <span className={cn("min-w-0 items-center gap-1", bare ? "inline-flex" : "flex w-full")}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        {...control}
        aria-required={required || undefined}
        aria-haspopup="listbox"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing ? `${listId}-${active}` : undefined}
        // what the field holds, as it is sent
        value={value}
        onClick={() => (showing ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        // Space is taken on keydown: its keyup must not click the trigger again
        onKeyUp={(event) => event.key === " " && event.preventDefault()}
        className={cn(
          bare ? WIDGET_BARE : WIDGET_FIELD, "relative flex items-center gap-2 text-start focus-visible:border-focus focus-visible:outline-none",
          bare ? "px-2" : "pe-8", showing && "border-focus",
        )}
      >
        <Clock aria-hidden="true" size={14} className="shrink-0 text-ink-secondary" />
        <span className={cn("min-w-0 truncate tabular-nums", !bare && "flex-1", !value && "font-normal text-ink-tertiary")}>{shown}</span>
        {!bare && <ChevronDown aria-hidden="true" size={14} className="pointer-events-none absolute end-3 text-ink-tertiary" />}
      </button>
      {node.clearable === true && value && !field.disabled && (
        <button type="button" aria-label={t("widget.clear", { label: control["aria-label"] })} onClick={() => field.set("")} className={WIDGET_FIELD_ACTION}>
          <X aria-hidden="true" size={14} />
        </button>
      )}
      {showing && createPortal(
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={t("widget.time.options", { label: control["aria-label"] })}
          // a press in the list keeps the focus on the trigger
          onMouseDown={(event) => event.preventDefault()}
          style={{ position: "fixed", ...place, visibility: place ? undefined : "hidden" }}
          // the app's popover menu (SidebarPopoverMenu): the menu tone, a hairline, the deep shadow
          className="z-[70] animate-pop-in overflow-y-auto overscroll-contain rounded-xl border border-hairline/50 bg-menu py-1 shadow-2xl shadow-black/50"
        >
          {slots.map((slot, index) => (
            <div
              key={slot}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === chosen}
              data-index={index}
              data-value={slot}
              onMouseMove={() => index !== active && setActive(index)}
              onClick={() => take(index)}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-2 px-3 text-[14px] leading-5 tabular-nums text-ink",
                index === active && "bg-raised", index === chosen && "font-medium",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{widgetTimeLabel(slot)}</span>
              {index === chosen && <Check aria-hidden="true" size={14} className="shrink-0 text-accent-text" />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
