// "More options": the technical part of a bot editor page, folded by default
// (JC 2026-10-14). Nothing in it is gone: one click opens it, and a search
// or a link that needs it can pass `open`.
import { type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { t } from "@/lib/i18n";

export function AdvancedFold({ children, id, open }: { children: ReactNode; id: string; open?: boolean }) {
  return (
    <details data-advanced-fold={id} open={open} className="group/fold border-t border-hairline/40 pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink-secondary hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="transition-transform group-open/fold:rotate-90 motion-reduce:transition-none" />
        {t("botPanel.moreOptions")}
      </summary>
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </details>
  );
}
