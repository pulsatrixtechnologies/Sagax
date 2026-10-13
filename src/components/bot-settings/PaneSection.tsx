// One section of a persona editor pane: a short title, an optional info
// button for the longer explanation, an optional action at the right, then
// the controls. Sections are separated by a hairline, never boxed in a card,
// so a pane reads as one page (Settings layout rule: one card level).
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { HelpTip } from "../SettingsPrimitives";

export function PaneSection({
  title,
  help,
  action,
  children,
  className,
  ...rest
}: {
  title?: ReactNode;
  /** The detail behind the info button next to the title. */
  help?: ReactNode;
  /** A button or link at the right of the title. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const label = typeof title === "string" ? title : "";
  return (
    <section {...rest} className={cn("border-t border-hairline/40 pt-5 first:border-t-0 first:pt-0", className)}>
      {(title || action) && (
        <div className="mb-3 flex min-h-6 items-center gap-1.5">
          {title && <h3 className="min-w-0 text-[13px] font-medium text-ink">{title}</h3>}
          {help && <HelpTip label={t("settings.moreAbout", { title: label })}>{help}</HelpTip>}
          {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A section's quiet one-line state ("No topic files yet."). */
export function PaneEmpty({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] text-ink-secondary">{children}</p>;
}
