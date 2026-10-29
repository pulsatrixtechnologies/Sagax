// A routine's run opened from the bot panel (2026-10-29): a large modal over
// the app instead of the narrow panel, so the result in Markdown, the steps
// and Stop, Run again, Continue have room. Escape and the close button
// close it; the routine's page stays under it.
import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useElementWidth } from "@/components/bot-settings/ActivityWindow";
import { RUN_WIDE_PX } from "./RoutineRunDetail";

export function RunDetailModal({ title, subtitle, onClose, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** The run detail, told whether the modal is wide enough for its columns. */
  children: (wide: boolean) => ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [frameRef, width] = useElementWidth<HTMLDivElement>(1000);
  useModalDialog(dialogRef, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={(node) => { dialogRef.current = node; frameRef.current = node; }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-run-detail-modal=""
        className="flex h-[min(860px,calc(100dvh-24px))] w-full max-w-[1100px] flex-col overflow-hidden rounded-[14px] border border-border bg-elevated"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-hairline/40 px-5 py-3.5">
          <span className="size-3.5 shrink-0 rounded bg-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-ink">{title}</div>
            {subtitle && <div className="text-[11.5px] text-ink-secondary">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-ink-secondary hover:bg-raised hover:text-ink" aria-label={t("common.close")}><X size={17} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children(width >= RUN_WIDE_PX)}</div>
      </div>
    </div>
  );
}
