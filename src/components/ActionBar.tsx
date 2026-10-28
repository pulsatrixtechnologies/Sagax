// Action bar that follows the width of its own container (2026-10-28), not the
// viewport: a routine's page sits in a narrow side panel, so the buttons
// there fold to round icon buttons (with a tooltip and an aria-label) when the
// panel is too tight for their labels. A label is never cut or wrapped.
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Container width under which the labels fold away. */
export const ACTION_BAR_COMPACT = "38rem";

/** Applied to a label span: hidden once the bar is compact. */
export const ACTION_LABEL = "whitespace-nowrap @max-[38rem]/actionbar:hidden";

const BASE = "flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-hairline/50 text-[13px] font-medium hover:bg-raised disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 @max-[38rem]/actionbar:w-10 @max-[38rem]/actionbar:px-0";

/** Classes of one action button. `wide` grows to share the row while labels show. */
export function actionButtonClass(tone: "primary" | "default" | "danger" = "default", wide = true): string {
  return cn(
    BASE,
    wide ? "flex-1 px-3 @max-[38rem]/actionbar:flex-none" : "w-10",
    tone === "primary" ? "bg-panel text-ink" : tone === "danger" ? "bg-panel text-danger hover:bg-danger/10" : "bg-panel text-ink",
  );
}

export function ActionBar({ children, className, ...rest }: { children?: ReactNode; className?: string } & Record<`data-${string}`, string | boolean | undefined>) {
  return <div {...rest} className={cn("@container/actionbar border-t border-hairline/40 px-3 py-3", className)}>
    <div className="flex items-center gap-2 @max-[38rem]/actionbar:justify-center">{children}</div>
  </div>;
}

export function ActionButton({ icon, label, tone = "default", wide = true, onClick, disabled, danger, ...rest }: {
  icon: ReactNode;
  label: string;
  tone?: "primary" | "default" | "danger";
  wide?: boolean;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return <button type="button" {...rest} aria-label={label} title={label} onClick={onClick} disabled={disabled}
    className={cn(actionButtonClass(danger ? "danger" : tone, wide), danger && "ml-1 @max-[38rem]/actionbar:ml-0")}>
    {icon}
    {wide && <span className={ACTION_LABEL}>{label}</span>}
  </button>;
}
