import { useEffect, useId, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { Check, ChevronDown, CircleHelp, Copy } from "lucide-react";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

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
        "relative h-5 w-11 shrink-0 rounded-full transition-colors enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        checked ? "bg-success" : "bg-ink/10",
        className,
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-1/2 h-4 w-[26px] -translate-y-1/2 rounded-full bg-ink transition-transform motion-reduce:transition-none",
          checked ? "translate-x-[14px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

type CountKey = "people" | "devices" | "backups" | "turns" | "computers" | "entries" | "workspaces" | "profiles";

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
  chooseCardOpen(id, true);
  let frames = 0;
  const reveal = () => {
    try {
      const card = [...document.querySelectorAll<HTMLElement>("[data-settings-card]")].find((node) => node.dataset.settingsCard === id);
      if (card) card.scrollIntoView?.({ block: "nearest" });
      else if (++frames < 30) requestAnimationFrame(reveal);
    } catch {
      /* no document outside the renderer */
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal);
}

/** Test seam: drop the in-memory choices so storage is read again. */
export function resetSettingsCards(): void {
  cardChoices = null;
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
      <div className="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-hairline bg-panel p-3 text-[12px] leading-[17px] text-ink-secondary shadow-xl">
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
}: {
  title: string;
  subtitle?: React.ReactNode;
  help?: React.ReactNode;
  children: React.ReactNode;
  message?: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="setting-row px-3.5 py-2.5">
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
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard permission can be denied; leave the button unchanged */
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2">
      <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-[12px] text-ink">
        {command}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copyLabel}
        className="ui-icon-button shrink-0"
      >
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>
    </div>
  );
}
