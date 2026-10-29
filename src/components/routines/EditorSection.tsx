// One section of "Edit routine" (2026-10-29): When, What, Where results go.
// A heading with its icon, then the fields, so the important settings are
// found at a glance instead of in one flat stack.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EditorSection({ icon: Icon, title, children, ...rest }: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
} & Record<`data-${string}`, string>) {
  return <section {...rest} className="space-y-3">
    <h3 className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-secondary">
      <Icon size={14} aria-hidden="true" />{title}
    </h3>
    <div className="min-w-0 space-y-3">{children}</div>
  </section>;
}

/** A help text one click away: an info button whose text is also read by
 * assistive technology, instead of a paragraph under every field. */
export function HelpTip({ id, text }: { id: string; text: string }) {
  return <span className="group relative inline-flex">
    <button type="button" aria-label={text} title={text} className="flex size-5 items-center justify-center rounded-full text-[11px] font-semibold text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">?</button>
    <span id={id} className="sr-only">{text}</span>
  </span>;
}
