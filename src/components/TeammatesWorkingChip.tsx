// The chat header's "Teammates working" chip: an entry point, not a second
// list. Ongoing work is drawn in one place only, the bot panel's Details tab
// (Ongoing activities, above History). The chip shows while the bot waits on
// teammates and its panel is closed; a click opens the panel, which lands on
// Details. With the panel open the chip is gone, so the work is never shown
// twice.
import { Layers } from "lucide-react";

import { t } from "@/lib/i18n";

export function TeammatesWorkingChip({ busy, waitingForTeammates, panelOpen, onOpen }: {
  busy?: boolean;
  waitingForTeammates?: boolean;
  panelOpen: boolean;
  onOpen: () => void;
}) {
  if (busy || !waitingForTeammates || panelOpen) return null;
  return (
    <button
      type="button"
      data-teammates-working=""
      onClick={onOpen}
      title={t("chat.teammatesWorking.open")}
      className="flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-[12px] text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Layers size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate" role="status">{t("chat.teammatesWorking")}</span>
    </button>
  );
}
