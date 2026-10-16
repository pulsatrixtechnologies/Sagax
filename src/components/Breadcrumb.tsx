// The trail above a page title in a panel that opens pages inside its own
// window (Connect apps > Browse Bots, Connect apps > Productivity): a round
// back button, then the pages above as links and the current one, as Grok
// Bot's thread breadcrumb (chevron-left, a crumb per level, chevron-right
// between). Escape and Cmd/Ctrl+[ go back in the panels that show it.
import { ChevronLeft, ChevronRight } from "lucide-react";

import { t } from "@/lib/i18n";
import { shortcutBackLabel } from "@/lib/back-shortcut";

export interface Crumb {
  label: string;
  /** Jump back to this level. */
  onSelect: () => void;
}

export function Breadcrumb({ trail, current, onBack, backData }: {
  /** The levels above the current page, the outermost first. */
  trail: readonly Crumb[];
  current: string;
  onBack: () => void;
  /** Extra data attribute on the back button (tests, tours). */
  backData?: Record<string, string>;
}) {
  const label = t("breadcrumb.back");
  return (
    <div className="-ml-1.5 mb-1 flex min-w-0 items-center gap-1" data-breadcrumb="">
      <button
        type="button"
        onClick={onBack}
        aria-label={label}
        title={`${label} (${shortcutBackLabel()})`}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink"
        data-breadcrumb-back=""
        {...backData}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <nav aria-label={t("breadcrumb.aria")} className="min-w-0">
        <ol className="flex min-w-0 items-center gap-0.5 text-[12.5px] leading-[18px]">
          {trail.map((crumb, index) => (
            <li key={`${index}:${crumb.label}`} className="flex min-w-0 items-center gap-0.5">
              <button
                type="button"
                onClick={crumb.onSelect}
                className="truncate rounded-md px-1.5 py-0.5 text-ink-secondary hover:bg-hover hover:text-ink"
                data-breadcrumb-crumb={index}
              >
                {crumb.label}
              </button>
              <ChevronRight size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
            </li>
          ))}
          <li aria-current="page" className="truncate px-1.5 py-0.5 font-medium text-ink" data-breadcrumb-current="">
            {current}
          </li>
        </ol>
      </nav>
    </div>
  );
}
