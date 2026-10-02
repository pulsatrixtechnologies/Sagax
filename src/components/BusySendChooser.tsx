// The choice offered when a person sends while the conversation is working
// (shared/parallel-tasks.ts): join the running work, run in parallel as its
// own task, or wait until the running work is done. The suggested choice is
// highlighted and Enter picks it; Settings > General sets a default that
// skips the question.
import { Clock, GitFork, CornerDownRight, X } from "lucide-react";

import type { BusySendMode } from "../../shared/parallel-tasks";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export const BUSY_SEND_ORDER: readonly BusySendMode[] = ["steer", "parallel", "after"];

/** The next highlighted choice for an arrow key. */
export function moveBusyChoice(current: BusySendMode, delta: 1 | -1): BusySendMode {
  const index = BUSY_SEND_ORDER.indexOf(current);
  return BUSY_SEND_ORDER[(index + delta + BUSY_SEND_ORDER.length) % BUSY_SEND_ORDER.length]!;
}

const ICONS = { steer: CornerDownRight, parallel: GitFork, after: Clock } as const;
const LABELS = {
  steer: () => t("composer.busy.choice.steer"),
  parallel: () => t("composer.busy.choice.parallel"),
  after: () => t("composer.busy.choice.after"),
} as const;
const HINTS = {
  steer: () => t("composer.busy.choice.steer.hint"),
  parallel: () => t("composer.busy.choice.parallel.hint"),
  after: () => t("composer.busy.choice.after.hint"),
} as const;

export function BusySendChooser({
  highlighted,
  onHighlight,
  onPick,
  onClose,
  name,
}: {
  highlighted: BusySendMode;
  onHighlight: (mode: BusySendMode) => void;
  onPick: (mode: BusySendMode) => void;
  onClose: () => void;
  name: string;
}) {
  return (
    <div
      role="listbox"
      aria-label={t("composer.busy.choice.title", { name })}
      data-busy-send-chooser=""
      className="mb-2 rounded-xl border border-hairline/40 bg-panel p-2 shadow-sm"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="text-[12px] font-medium text-ink-secondary">{t("composer.busy.choice.title", { name })}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("composer.busy.choice.cancel")}
          className="flex size-6 items-center justify-center rounded-full text-ink-tertiary hover:bg-raised hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>
      <div className="grid gap-1 sm:grid-cols-3">
        {BUSY_SEND_ORDER.map((mode) => {
          const Icon = ICONS[mode];
          const active = mode === highlighted;
          return (
            <button
              key={mode}
              type="button"
              role="option"
              aria-selected={active}
              data-busy-send={mode}
              onMouseEnter={() => onHighlight(mode)}
              onClick={() => onPick(mode)}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                active ? "border-accent/50 bg-accent/10" : "border-transparent hover:bg-raised",
              )}
            >
              <Icon size={15} className={cn("mt-0.5 shrink-0", active ? "text-accent" : "text-ink-secondary")} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{LABELS[mode]()}</span>
                <span className="block text-[11px] leading-snug text-ink-secondary">{HINTS[mode]()}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-ink-tertiary">{t("composer.busy.choice.keys")}</p>
    </div>
  );
}
