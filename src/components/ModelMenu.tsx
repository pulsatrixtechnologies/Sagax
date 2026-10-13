// The model list (2026-10-12, JC: "like Cursor's model menu"): a search
// field on top that filters as one types, the rows grouped under headings,
// each row the model's name in primary ink and its effort or variant in
// secondary ink, the current choice checked. The arrow keys move over the
// rows that are left, Enter picks, Escape belongs to the caller. The same
// list sits in the composer's model menu (`popover`) and, always open, in
// the model window (`window`). The rules are src/lib/model-menu.ts.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activeRowKey, filterModelSections, pickableRows, stepRow, type ModelMenuRow, type ModelMenuSection } from "@/lib/model-menu";

export type { ModelMenuRow, ModelMenuSection };

const STYLE = {
  popover: {
    field: "mx-1.5 mb-1 flex items-center gap-2 border-b border-popover-hairline px-2 py-2",
    input: "w-full bg-transparent text-[13px] text-popover-ink placeholder:text-popover-placeholder focus:outline-none",
    icon: "text-popover-ink-secondary",
    list: "max-h-[min(400px,56dvh)] overflow-y-auto overscroll-contain px-1.5 pb-1",
    heading: "px-2 pb-1 pt-2 text-[11.5px] text-popover-ink-secondary",
    divider: "border-t border-popover-hairline",
    row: "text-popover-ink",
    active: "bg-popover-hover",
    detail: "text-popover-ink-secondary",
    tag: "bg-popover-field text-popover-ink-secondary",
    check: "text-popover-accent",
    empty: "px-3 py-5 text-center text-[12.5px] text-popover-ink-secondary",
  },
  window: {
    field: "sticky top-0 z-10 mb-1 flex items-center gap-2 rounded-lg border border-hairline/50 bg-inset px-3 py-2 focus-within:border-accent/60",
    input: "w-full bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none",
    icon: "text-ink-secondary",
    list: "",
    heading: "px-2.5 pb-1 pt-3 text-[11.5px] text-ink-secondary",
    divider: "",
    row: "text-ink",
    active: "bg-hover",
    detail: "text-ink-secondary",
    tag: "bg-inset text-ink-secondary",
    check: "text-accent",
    empty: "px-3 py-5 text-center text-[12.5px] text-ink-secondary",
  },
} as const;

export function ModelSearchList({ sections, onPick, variant, autoFocus = false, onEscape, disabled = false, label }: {
  sections: ModelMenuSection[];
  onPick: (row: ModelMenuRow) => void;
  variant: "popover" | "window";
  /** The composer's menu types straight into the search. */
  autoFocus?: boolean;
  /** Escape with an empty search (a non-empty one is cleared first). */
  onEscape?: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const style = STYLE[variant];
  const [query, setQuery] = useState("");
  const [moved, setMoved] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const shown = filterModelSections(sections, query);
  const rows = pickableRows(shown);
  const active = activeRowKey(rows, moved, query.trim().length > 0);
  const optionId = (key: string) => `${baseId}-${shown.flatMap((section) => section.rows).findIndex((row) => row.key === key)}`;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (!active) return;
    const element = listRef.current?.querySelector<HTMLElement>(`[data-model-row-key="${CSS.escape(active)}"]`);
    element?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setMoved(stepRow(rows, active, event.key));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = rows.find((candidate) => candidate.key === active);
      if (row && !disabled) onPick(row);
      return;
    }
    if (event.key === "Escape") {
      if (query) {
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        setMoved(null);
        return;
      }
      if (onEscape) {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }
    }
  };

  const listboxId = `${baseId}-list`;
  return (
    <div data-model-search-list={variant} className={cn("flex flex-col", variant === "popover" ? "min-h-0 min-w-0" : "shrink-0")}>
      <label className={style.field}>
        <Search size={13} aria-hidden="true" className={cn("shrink-0", style.icon)} />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-label={t("model.search")}
          data-model-search
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={t("model.search")}
          onChange={(event) => {
            setQuery(event.target.value);
            setMoved(null);
          }}
          onKeyDown={onKeyDown}
          className={style.input}
        />
      </label>
      <div ref={listRef} id={listboxId} role="listbox" aria-label={label ?? t("model.models")} data-model-list className={style.list}>
        {shown.length === 0 && <div data-model-no-match className={style.empty}>{t("model.noMatch")}</div>}
        {shown.map((section, index) => (
          <div key={section.key} role="group" aria-label={section.label} data-model-section={section.key}
            className={cn("py-0.5", index > 0 && style.divider)}>
            {section.label && (
              <div aria-hidden="true" className={cn("flex items-baseline gap-1.5", style.heading)}>
                <span className="truncate">{section.label}</span>
                {section.note && <span data-model-section-note className="truncate opacity-80">· {section.note}</span>}
              </div>
            )}
            {section.rows.map((row) => (
              <ModelSearchRow key={row.key} row={row} id={optionId(row.key)} active={row.key === active} style={style}
                disabled={disabled} onHover={() => setMoved(row.key)} onPick={() => onPick(row)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelSearchRow({ row, id, active, style, disabled, onHover, onPick }: {
  row: ModelMenuRow;
  id: string;
  active: boolean;
  style: (typeof STYLE)[keyof typeof STYLE];
  disabled: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const blocked = Boolean(row.unavailable) || disabled;
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-current={row.current || undefined}
      aria-disabled={blocked || undefined}
      data-model-row-key={row.key}
      data-model-option={row.kind === "model" ? row.modelId : undefined}
      data-model-auto-row={row.kind === "auto" || undefined}
      data-follow-bot-model={row.kind === "follow" || undefined}
      data-model-unavailable={row.unavailable ? "" : undefined}
      title={row.unavailable}
      // keep the focus in the search field
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={row.unavailable ? undefined : onHover}
      onClick={blocked ? undefined : onPick}
      className={cn(
        "flex min-h-8 cursor-default items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px]",
        style.row,
        active && !row.unavailable && style.active,
        blocked && "opacity-50",
      )}
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate">{row.label}</span>
        {row.detail && <span data-model-row-detail className={cn("min-w-0 shrink truncate", style.detail)}>{row.detail}</span>}
        {row.tags?.map((tag) => <span key={tag} data-model-row-tag className={cn("shrink-0 self-center rounded px-1.5 py-px text-[10.5px]", style.tag)}>{tag}</span>)}
      </span>
      {row.current && <Check size={14} aria-hidden="true" className={cn("shrink-0", style.check)} />}
    </div>
  );
}

/** A plain item below the list (Edit…), styled like a row. */
export function ModelMenuItem({ children, onClick, variant, ...data }: { children: ReactNode; onClick: () => void; variant: "popover" | "window" } & Record<`data-${string}`, string | boolean | undefined>) {
  const style = STYLE[variant];
  return (
    <button type="button" onClick={onClick} {...data}
      className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-focus",
        style.row, variant === "popover" ? "hover:bg-popover-hover" : "hover:bg-hover")}>
      {children}
    </button>
  );
}
