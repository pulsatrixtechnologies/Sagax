// The full-window shell of the in-app viewers (PDF, diagram, table cell):
// a native modal dialog, so focus containment, Escape, the inert background
// and focus return come from the platform, the same way TableDialog does it.
// The header holds the title, the viewer's own actions and Close.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export interface ViewerDialogProps {
  title: string;
  onClose: () => void;
  /** Gets focus back when the dialog closes (the button that opened it). */
  returnFocus: HTMLElement | null;
  /** Buttons shown in the header before Close. */
  actions?: ReactNode;
  /** "full" fills the window; "compact" sizes to its content (a cell). */
  size?: "full" | "compact";
  bodyClassName?: string;
  children: ReactNode;
}

export function ViewerDialog({ title, onClose, returnFocus, actions, size = "full", bodyClassName, children }: ViewerDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [returnFocus]);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      // Escape closes this dialog only, never a panel or dialog under it.
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
      className={cn(
        "m-auto flex max-w-none flex-col overflow-hidden rounded-2xl border border-hairline bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60",
        size === "full" ? "h-[96dvh] max-h-none w-[min(98vw,1600px)]" : "max-h-[85dvh] w-[min(94vw,720px)]",
      )}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline/40 px-3 py-2 sm:px-4">
        <h2 id={id} className="me-auto min-w-0 max-w-full truncate text-sm font-medium" title={title}>{title}</h2>
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-1">{actions}</div>}
        <button type="button" autoFocus onClick={onClose} className="table-action" aria-label={t("viewer.close")} title={t("viewer.close")}><X size={16} /></button>
      </header>
      <div className={cn("relative min-h-0 flex-1", bodyClassName)}>{children}</div>
    </dialog>,
    document.body,
  );
}
