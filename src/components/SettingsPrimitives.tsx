import { useId, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { Check, ChevronDown, CircleHelp, Copy, X } from "lucide-react";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SWITCH_OFF, SWITCH_ON, SWITCH_THUMB_OFF, SWITCH_THUMB_ON } from "@/lib/status-tones";
import { useCopyFeedback } from "@/lib/copy-text";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";

export function Switch({
  checked,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children" | "role" | "aria-checked"> & { checked: boolean }) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        "relative h-5 w-11 shrink-0 cursor-pointer rounded-full transition-colors enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        checked ? SWITCH_ON : SWITCH_OFF,
        className,
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-1/2 h-4 w-[26px] -translate-y-1/2 rounded-full transition-transform motion-reduce:transition-none",
          checked ? `translate-x-[14px] ${SWITCH_THUMB_ON}` : `translate-x-0 ${SWITCH_THUMB_OFF}`,
        )}
      />
    </button>
  );
}

/** A standalone on/off setting: label (and optional description) at the left,
 * the Switch at the right. The whole row is a <label>, so a click on the text
 * toggles and Space on the focused switch toggles. */
export function SwitchRow({
  label,
  description,
  help,
  checked,
  disabled,
  onChange,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** The longer explanation, behind an info button after the label. */
  help?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 items-center justify-between gap-4 text-[13px] text-ink", disabled ? "cursor-not-allowed" : "cursor-pointer", className)}>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 leading-[18px]">
          <span className="min-w-0">{label}</span>
          {help && <HelpTip label={t("settings.moreAbout", { title: typeof label === "string" ? label : "" })}>{help}</HelpTip>}
        </span>
        {description && <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-secondary">{description}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onClick={() => onChange(!checked)} />
    </label>
  );
}

type CountKey = "servers" | "people" | "devices" | "backups" | "turns" | "computers" | "entries" | "workspaces" | "profiles" | "ready";

/** "1 person" / "3 people" for a collapsed card's summary, by the active
 * language's plural rule (French says "0 personne"). */
export function cardCount(key: CountKey, count: number): string {
  let one = count === 1;
  try {
    one = new Intl.PluralRules(activeLocale()).select(count) === "one";
  } catch {
    /* an unknown locale keeps the English rule */
  }
  return one ? t(`settings.card.${key}One`, { count }) : t(`settings.card.${key}`, { count });
}

const CARD_STATE_KEY = "openmausbot.settingsCards.v1";

type CardStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): CardStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readCardStates(storage: CardStorage | null): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(CARD_STATE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

/** The remembered open state of a settings card, or `fallback` when this
 * device never toggled it (or storage is unavailable). */
export function loadCardOpen(id: string, fallback: boolean, storage: CardStorage | null = defaultStorage()): boolean {
  return readCardStates(storage)[id] ?? fallback;
}

export function saveCardOpen(id: string, open: boolean, storage: CardStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(CARD_STATE_KEY, JSON.stringify({ ...readCardStates(storage), [id]: open }));
  } catch {
    /* private windows and full quotas keep the in-memory state only */
  }
}

// One shared store of explicit choices (toggles, remembered states, deep
// links), read from storage once. A card without a choice follows its
// `defaultOpen`, which may change once the card's data loads. Keeping the
// state here rather than in component state lets a deep link open a card
// that has not mounted yet, with no event wiring.
let cardChoices: Record<string, boolean> | null = null;
const ANONYMOUS_CARD = "anonymous:";
const cardListeners = new Set<() => void>();

function choices(): Record<string, boolean> {
  return (cardChoices ??= readCardStates(defaultStorage()));
}

function subscribeCards(listener: () => void): () => void {
  cardListeners.add(listener);
  return () => cardListeners.delete(listener);
}

function chooseCardOpen(id: string, open: boolean): void {
  cardChoices = { ...choices(), [id]: open };
  // A card without a cardId still folds, for this session only.
  if (!id.startsWith(ANONYMOUS_CARD)) saveCardOpen(id, open);
  for (const listener of cardListeners) listener();
}

/** Opens the collapsible settings card `id` and scrolls it into view, now if
 * it is mounted or as soon as it mounts (a deep link opens Settings first). */
export function requestSettingsCard(id: string): void {
  lastRequestedCard = id;
  chooseCardOpen(id, true);
  let frames = 0;
  const reveal = () => {
    try {
      const card = [...document.querySelectorAll<HTMLElement>("[data-settings-card]")].find((node) => node.dataset.settingsCard === id);
      if (card) {
        card.scrollIntoView?.({ block: "nearest" });
        if (lastRequestedCard === id) lastRequestedCard = null;
      } else if (++frames < 30) requestAnimationFrame(reveal);
      else if (lastRequestedCard === id) lastRequestedCard = null;
    } catch {
      /* no document outside the renderer */
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal);
}

let lastRequestedCard: string | null = null;

/** The card a link asked for last, read once: Settings uses it to send a
 * link to a moved card where that card is shown on this computer. */
export function takeRequestedSettingsCard(): string | null {
  const id = lastRequestedCard;
  lastRequestedCard = null;
  return id;
}

/** Test seam: drop the in-memory choices so storage is read again. */
export function resetSettingsCards(): void {
  cardChoices = null;
  lastRequestedCard = null;
}

function useCardOpen(id: string, defaultOpen: boolean) {
  const read = () => choices()[id];
  const chosen = useSyncExternalStore(subscribeCards, read, read);
  const open = chosen ?? defaultOpen;
  const toggle = () => chooseCardOpen(id, !open);
  return [open, toggle] as const;
}

type CardProps = {
  title?: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  collapsible?: boolean;
  cardId?: string;
  defaultOpen?: boolean;
  summary?: React.ReactNode;
};

/** A settings form card. With `collapsible`, the title becomes a disclosure
 * button: collapsed it shows one `summary` line, open it shows the subtitle
 * and the body. The body stays mounted while collapsed so drafts, saves and
 * loads are unaffected. `cardId` keys the remembered state on this device
 * and is the target of `requestSettingsCard`. */
export function Card(props: CardProps) {
  // A plain card stays hook-free; only a collapsible one needs state.
  if (props.collapsible && props.title) return <CollapsibleCard {...props} title={props.title} />;
  const { title, subtitle, children, cardId } = props;
  return (
    <div data-settings-card={cardId} className="rounded-[14px] border-[0.5px] border-border px-3.5 py-3">
      {title && (
        <div className="text-[13px] font-normal leading-[18px] text-ink">{title}</div>
      )}
      {subtitle && <div className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">{subtitle}</div>}
      {children && <div className={title || subtitle ? "mt-2.5" : undefined}>{children}</div>}
    </div>
  );
}

function CollapsibleCard({ title, subtitle, children, cardId, defaultOpen = true, summary }: CardProps & { title: string }) {
  const bodyId = useId();
  const [open, toggle] = useCardOpen(cardId ?? `${ANONYMOUS_CARD}${bodyId}`, defaultOpen);
  return (
    <div data-settings-card={cardId} data-open={open ? "true" : "false"} className="rounded-[14px] border-[0.5px] border-border">
      <h3 className="text-[13px] font-normal leading-[18px]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          className="flex w-full min-w-0 items-center gap-3 rounded-[14px] px-3.5 py-3 text-left text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none"
        >
          <span className="min-w-0 truncate">{title}</span>
          {!open && summary ? (
            <span data-card-summary className="ml-auto min-w-0 truncate text-right text-[12.5px] text-ink-secondary">{summary}</span>
          ) : (
            <span className="ml-auto" />
          )}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-180")}
          />
        </button>
      </h3>
      <div id={bodyId} hidden={!open} className="px-3.5 pb-3">
        {subtitle && <div className="-mt-1 mb-2.5 text-[13px] leading-[18px] text-ink-secondary">{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

/** The longer explanation behind a short setting line, on demand: a
 * keyboard-reachable disclosure rather than a hover-only title. */
export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="relative inline-block align-middle">
      <summary
        aria-label={label}
        title={label}
        className="flex size-5 cursor-pointer list-none items-center justify-center rounded-md text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 [&::-webkit-details-marker]:hidden"
      >
        <CircleHelp size={13} aria-hidden="true" />
      </summary>
      <div className="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-hairline popover-surface bg-panel p-3 text-[12px] leading-[17px] text-ink-secondary shadow-xl">
        {children}
      </div>
    </details>
  );
}

/** Simple preferences share an aligned row; forms with several fields keep a Card.
 * `help` keeps the subtitle to one short line and moves the detail behind a HelpTip. */
export function SettingRow({
  title,
  subtitle,
  help,
  children,
  message,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  help?: React.ReactNode;
  children: React.ReactNode;
  message?: React.ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className={cn("setting-row px-3.5 py-2.5", className)}>
      <div className="grid min-w-0 grid-cols-1 items-center gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div id={titleId} className="text-[13px] font-normal leading-[18px] text-ink">{title}</div>
            {help && <HelpTip label={t("settings.moreAbout", { title })}>{help}</HelpTip>}
          </div>
          {subtitle && <div className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">{subtitle}</div>}
        </div>
        <div className="min-w-0 sm:max-w-[240px]">{children}</div>
      </div>
      {message && <div className="mt-2 text-[12px]">{message}</div>}
    </div>
  );
}

/** A command the user is meant to run, with one-click copy. */
export function CommandLine({ command, copyLabel = "Copy command" }: { command: string; copyLabel?: string }) {
  // The command stays select-all when clipboard permission is denied.
  const { state, copy } = useCopyFeedback(command);

  return (
    <div className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2">
      <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-[12px] text-ink">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={state === "failed" ? t("common.copyFailed") : copyLabel}
        className="ui-icon-button shrink-0"
      >
        {state === "copied" ? <Check size={13} className="text-success" /> : state === "failed" ? <X size={13} className="text-danger" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/** A titled group of settings, as Grok Bot's settings pages draw them: a
 * grey heading outside the card (Account, Appearance, System), then one
 * rounded card of compact rows. An empty group draws nothing. */
export function SettingsGroup({
  title,
  groupId,
  children,
}: {
  title: string;
  /** `data-settings-group`, for tests and deep links */
  groupId: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-settings-group={groupId} className="flex flex-col gap-2 has-[>div:empty]:hidden">
      <h3 id={headingId} className="px-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{title}</h3>
      <div className="flex flex-col rounded-xl border-[0.5px] border-border bg-elevated py-1.5 empty:hidden">{children}</div>
    </section>
  );
}

export type PillOption<T extends string> = { value: T; label: string };

/** Grok Bot's borderless pill menu ("Follow System ⌄"): the current value
 * and a chevron; the choices open in a small list under it. A listbox, so
 * arrows, Home/End, Enter and Escape work as in a native select. */
export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: T;
  options: ReadonlyArray<PillOption<T>>;
  onChange: (next: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((option) => option.value === value);
  const close = (focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };
  usePopoverDismiss(open, rootRef, () => close(true));
  const focusOption = (index: number) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (items.length === 0) return;
    items[(index + items.length) % items.length]?.focus();
  };
  const show = () => {
    setOpen(true);
    const selected = Math.max(0, options.findIndex((option) => option.value === value));
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => focusOption(selected));
  };
  const choose = (next: T) => {
    close(true);
    if (next !== value) onChange(next);
  };
  return (
    <div ref={rootRef} className="relative inline-flex justify-end">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        title={current?.label}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
        data-pill-select=""
        className="inline-flex h-7 max-w-[240px] items-center gap-1 rounded-full px-2.5 text-[13px] leading-[18px] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-hover motion-reduce:transition-none"
      >
        <span className="min-w-0 truncate">{current?.label ?? value}</span>
        <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={(event) => {
            const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "ArrowDown") { event.preventDefault(); focusOption(index + 1); }
            else if (event.key === "ArrowUp") { event.preventDefault(); focusOption(index - 1); }
            else if (event.key === "Home") { event.preventDefault(); focusOption(0); }
            else if (event.key === "End") { event.preventDefault(); focusOption(items.length - 1); }
            else if (event.key === "Tab") close();
            else if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              // Handled here, before the Settings modal's own Escape (a
              // window listener that skips a handled event): close the
              // menu, not Settings.
              event.preventDefault();
              close(true);
            }
          }}
          className="popover-surface absolute right-0 top-full z-40 mt-1 flex max-h-[280px] w-max min-w-[180px] max-w-[min(18rem,calc(100vw-2rem))] flex-col gap-0.5 overflow-y-auto rounded-xl border-[0.5px] border-border bg-elevated p-1.5"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onClick={() => choose(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(option.value);
                  }
                }}
                className="flex min-h-[30px] cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] leading-[18px] text-ink hover:bg-ink/[0.06] focus-visible:bg-ink/[0.06] focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <Check size={14} aria-hidden="true" className={cn("shrink-0 text-ink-secondary", !selected && "invisible")} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A compact Grok-style row: the label at the left, the control at the
 * right, no help text. */
export function CompactRow({ label, children, className, rowId }: { label: string; children: React.ReactNode; className?: string; rowId?: string }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} data-settings-row={rowId} className={cn("flex min-h-[44px] items-center justify-between gap-5 px-3.5 py-2", className)}>
      <div id={labelId} className="min-w-0 text-[13px] leading-[18px] text-ink">{label}</div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}
