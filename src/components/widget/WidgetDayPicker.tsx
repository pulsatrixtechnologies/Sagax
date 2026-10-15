// Days of the week, picked by tapping them: seven round toggles, Monday
// first, any number on, with a line under them that says what is picked
// ("Weekdays", "Mon, Thu"). The toggles are one stop for Tab; the arrow
// keys, Home and End move along them, and Space or Enter turns one on or
// off. The value is a comma list in week order ("mon,tue"), "" for none.
import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { WIDGET_WEEKDAYS, type WidgetNode } from "../../../shared/widget";
import { useWidgetField } from "./WidgetControls";

let names: { narrow: string[]; short: string[]; long: string[] } | undefined;

/** The days' names in the person's own language, Monday first (1 January 2024 was a Monday). */
export function widgetDayNames(): { narrow: string[]; short: string[]; long: string[] } {
  if (names) return names;
  const days = WIDGET_WEEKDAYS.map((_, index) => new Date(2024, 0, 1 + index));
  const name = (weekday: "narrow" | "short" | "long") => days.map((day) => new Intl.DateTimeFormat(undefined, { weekday }).format(day));
  names = { narrow: name("narrow"), short: name("short"), long: name("long") };
  return names;
}

/** What is picked, as the person says it: "Every day", "Weekdays", "Weekends", else the days' short names. */
export function widgetDaysCaption(value: string): string {
  const picked = WIDGET_WEEKDAYS.filter((day) => value.split(",").includes(day));
  const key = picked.join(",");
  if (picked.length === 7) return t("widget.days.everyDay");
  if (key === "mon,tue,wed,thu,fri") return t("widget.days.weekdays");
  if (key === "sat,sun") return t("widget.days.weekends");
  if (!picked.length) return t("widget.days.none");
  return picked.map((day) => widgetDayNames().short[WIDGET_WEEKDAYS.indexOf(day)]).join(", ");
}

/** `labelledBy` is the caption drawn above the toggles from the field's own `label`; `end` lines them up at
 * the row's end, beside a label. */
export function WidgetDayPicker({ node, labelledBy, end = false }: { node: WidgetNode; labelledBy?: string; end?: boolean }) {
  const field = useWidgetField(node);
  const [stop, setStop] = useState(0);
  const picked = new Set(field.text.split(",").filter((day) => WIDGET_WEEKDAYS.includes(day)));
  const day = widgetDayNames();
  const { id, required, disabled } = field.control;
  const invalid = field.invalid;
  const toggle = (name: string) => field.set(WIDGET_WEEKDAYS.filter((each) => (each === name ? !picked.has(each) : picked.has(each))).join(","));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = WIDGET_WEEKDAYS.indexOf((event.target as HTMLElement).dataset.day ?? "");
    if (at < 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const next = event.key === "Home" ? 0 : event.key === "End" ? 6
      : event.key === (rtl ? "ArrowLeft" : "ArrowRight") || event.key === "ArrowDown" ? Math.min(6, at + 1)
        : event.key === (rtl ? "ArrowRight" : "ArrowLeft") || event.key === "ArrowUp" ? Math.max(0, at - 1) : -1;
    if (next < 0) return;
    event.preventDefault();
    setStop(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-day="${WIDGET_WEEKDAYS[next]}"]`)?.focus();
  };
  return (
    <div
      role="group"
      id={id}
      aria-label={labelledBy ? undefined : field.control["aria-label"]}
      aria-labelledby={labelledBy}
      aria-invalid={field.control["aria-invalid"]}
      aria-describedby={field.control["aria-describedby"]}
      className={cn("flex min-w-0 flex-col gap-1.5", end ? "items-end" : "items-start", disabled && "opacity-60")}
    >
      <div className="flex flex-wrap gap-1.5" onKeyDown={onKeyDown}>
        {WIDGET_WEEKDAYS.map((name, index) => {
          const on = picked.has(name);
          return (
            <button
              key={name}
              type="button"
              data-day={name}
              // where a press that found it empty sends the focus
              data-widget-field={index === 0 ? field.name : undefined}
              aria-pressed={on}
              aria-label={day.long[index]}
              title={day.long[index]}
              disabled={disabled}
              tabIndex={index === stop ? 0 : -1}
              onFocus={() => setStop(index)}
              onClick={() => toggle(name)}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-composer disabled:cursor-not-allowed",
                on ? "bg-accent text-accent-ink enabled:hover:brightness-110" : "bg-ink/[0.07] text-ink-secondary enabled:hover:bg-ink/[0.12] enabled:hover:text-ink",
                !on && invalid && "shadow-[inset_0_0_0_1.5px_var(--color-danger)]",
              )}
            >
              <span aria-hidden="true">{day.narrow[index]}</span>
            </button>
          );
        })}
      </div>
      <span
        aria-live="polite"
        data-days-caption
        className={cn("text-[12px] leading-4", picked.size ? "text-ink-secondary" : required && invalid ? "text-danger" : "text-ink-tertiary")}
      >
        {widgetDaysCaption(field.text)}
      </span>
    </div>
  );
}
