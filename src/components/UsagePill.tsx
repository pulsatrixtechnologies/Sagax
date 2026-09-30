// The header's spend and context pill: a small ring for how full the model's
// window is, the percentage beside it, a hairline, then what the thread has
// cost. Hover or focus opens a card with the breakdown; a click opens the
// Usage section of the bot's settings, as the plain chip did.
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  contextDetail,
  contextShare,
  contextValue,
  costCaption,
  formatTokens,
  formatUsd,
  hasFiniteCost,
  usageChip,
  usageDetail,
  type ContextTone,
} from "@/lib/usage";
import type { TaskUsage } from "@/state/store";

type Billing = "metered" | "subscription" | undefined;

const TONE_TEXT: Record<ContextTone, string> = {
  quiet: "text-accent",
  warning: "text-warning",
  danger: "text-danger",
};

/** Text colour class for the ring's arc and the percentage. */
export function toneClass(tone: ContextTone): string {
  return TONE_TEXT[tone];
}

/** The pill's accessible name: both figures, spelled out. */
export function usagePillLabel(usage: TaskUsage): string {
  const spend = usageChip(usage);
  return [
    contextDetail(usage),
    spend && hasFiniteCost(usage.costUsd) ? t("chat.usage.costAria", { cost: spend }) : spend,
  ]
    .filter(Boolean)
    .join(", ");
}

/** A donut whose arc fills to `percent`. The arc eases between values; the
 * transition is dropped for reduced motion. Unknown share draws the track only. */
export function ContextRing({ percent, tone, size = 16, stroke = 2.5 }: { percent?: number; tone: ContextTone; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fill = percent === undefined ? 0 : Math.min(100, Math.max(0, percent)) / 100;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 -rotate-90", toneClass(tone))}
      aria-hidden="true"
      data-usage-ring
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={stroke} />
      {fill > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fill)}
          className="transition-[stroke-dashoffset,color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          data-usage-arc
        />
      )}
    </svg>
  );
}

function Row({ label, value, lines }: { label: string; value: string; lines: Array<string | null> }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink">{label}</span>
        {value && <span className="font-medium tabular-nums text-ink">{value}</span>}
      </div>
      {lines.filter((line): line is string => Boolean(line)).map((line) => (
        // break only between figures, never inside "12.4k output"
        <span key={line} className="flex flex-wrap gap-x-1 text-[11.5px] leading-4 tabular-nums text-ink-secondary">
          {line.split(" · ").map((part, index, parts) => (
            <span key={index} className="whitespace-nowrap">{part}{index < parts.length - 1 && <span className="pl-1 text-ink-tertiary">·</span>}</span>
          ))}
        </span>
      ))}
    </div>
  );
}

/** The hover card: the ring larger, context against the window, the thread's
 * cost and the last message on its own. */
export function UsageCard({ usage, billing, id }: { usage: TaskUsage; billing: Billing; id?: string }) {
  const share = contextShare(usage);
  const last = usage.lastTurn;
  const spend = usageChip(usage);
  return (
    <div
      id={id}
      role="tooltip"
      data-testid="usage-card"
      className="w-[324px] rounded-xl border-[0.5px] border-border bg-elevated p-3 text-left text-[12.5px] leading-[18px] text-ink shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)]"
    >
      {share && (
        <div className="flex items-center gap-3 pb-2.5">
          <ContextRing percent={share.percent} tone={share.tone} size={40} stroke={4} />
          <div className="flex min-w-0 flex-col">
            <span className="text-[11.5px] leading-4 text-ink-secondary">{t("chat.usage.cardContext")}</span>
            <span className="flex items-baseline gap-1.5">
              {share.percent !== undefined && <span className={cn("text-[18px] font-semibold leading-6 tabular-nums", toneClass(share.tone))}>{share.percent}%</span>}
              <span className="tabular-nums text-ink-secondary">
                {share.window
                  ? t("chat.usage.cardWindow", { tokens: formatTokens(share.tokens), window: formatTokens(share.window) })
                  : t("chat.usage.cardTokens", { tokens: formatTokens(share.tokens) })}
              </span>
            </span>
          </div>
        </div>
      )}
      <div className={cn("flex flex-col", share && "border-t-[0.5px] border-hairline-weak pt-1")}>
        <Row
          label={t("chat.usage.cardThread")}
          value={hasFiniteCost(usage.costUsd) ? spend : ""}
          lines={[
            [usage.turns === 1 ? t("chat.usage.turnsOne") : t("chat.usage.turnsMany", { count: usage.turns }), hasFiniteCost(usage.costUsd) ? costCaption(billing) : null]
              .filter(Boolean)
              .join(" · "),
            usageDetail(usage),
          ]}
        />
        {last && hasFiniteCost(last.input) && (
          <Row label={t("chat.usage.cardLast")} value={hasFiniteCost(last.costUsd) ? formatUsd(last.costUsd) : ""} lines={[usageDetail(last)]} />
        )}
      </div>
      {share?.tone === "danger" && (
        <p className="mt-1.5 rounded-lg bg-danger/10 px-2 py-1.5 text-[11.5px] leading-4 text-danger">{t("chat.usage.contextNudge")}</p>
      )}
      <p className="mt-2 text-[11px] leading-4 text-ink-tertiary">{t("chat.usage.cardHint")}</p>
    </div>
  );
}

/** Quiet until the first turn settles. `defaultOpen` shows the card at once
 * (tests and visual fixtures). */
export function UsagePill({
  usage,
  billing,
  onOpen,
  defaultOpen = false,
}: {
  usage: TaskUsage;
  billing: Billing;
  onOpen: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardId = useId();
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const spend = usageChip(usage);
  if (!spend) return null;
  const share = contextShare(usage);
  const value = contextValue(usage);
  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // a short grace period so the pointer can cross the gap to the card
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={onOpen}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        aria-label={usagePillLabel(usage)}
        aria-describedby={open ? cardId : undefined}
        data-testid="usage-chip"
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-hairline-weak bg-elevated pl-2.5 pr-3 text-[12.5px] leading-none tabular-nums transition-colors hover:bg-elevated-hover",
          open && "bg-elevated-hover",
          "@max-4xl/chathead:px-3",
        )}
      >
        {share && (
          <span className="flex items-center gap-2 @max-4xl/chathead:hidden" data-testid="usage-context" data-tone={share.tone}>
            <ContextRing percent={share.percent} tone={share.tone} />
            <span className={cn("font-medium", share.tone === "quiet" ? "text-ink" : toneClass(share.tone))}>{value}</span>
            <span className="h-3.5 w-px bg-hairline-weak" aria-hidden="true" data-usage-divider />
          </span>
        )}
        <span className="text-ink-secondary" data-testid="usage-cost">{spend}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 pt-1.5 motion-safe:animate-pop-in">
          <UsageCard usage={usage} billing={billing} id={cardId} />
        </div>
      )}
    </div>
  );
}
