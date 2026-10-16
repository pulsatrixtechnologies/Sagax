// "More options": the technical part of a bot editor page, folded by default
// (JC 2026-10-14). Nothing in it is gone: one click opens it, and a search
// or a link that needs it can pass `open`. Drawn as a Settings fold row
// (2026-10-16): a card row with its chevron pill at the right.
import { type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { t } from "@/lib/i18n";

export function AdvancedFold({ children, id, open }: { children: ReactNode; id: string; open?: boolean }) {
  return (
    <details data-advanced-fold={id} open={open} className="group/fold flex flex-col">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-2 text-[13px] leading-[18px] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none md:min-h-[40px] [&::-webkit-details-marker]:hidden">
        <span>{t("botPanel.moreOptions")}</span>
        <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-ink-secondary transition-transform group-open/fold:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </details>
  );
}
