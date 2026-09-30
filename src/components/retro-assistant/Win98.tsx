// Late-90s desktop chrome, drawn from scratch in CSS (retro-assistant.css):
// bevelled silver windows with a navy title bar, raised push buttons, sunken
// fields and square checkboxes. The shapes are the era's shared UI language;
// no vendor art, logo or font is used.
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function Win98Button({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn("r98-btn", className)} {...rest}>
      {children}
    </button>
  );
}

export function Win98Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <label className="r98-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="r98-check-box" aria-hidden="true">
        <svg viewBox="0 0 7 7" width="7" height="7">
          <path d="M0 2h1v1h1v1h1v-1h1v-1h1v-1h1v-1h1v2h-1v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1z" fill="currentColor" />
        </svg>
      </span>
      <span>{children}</span>
    </label>
  );
}

/** A draggable-looking (but fixed) dialog window, modal to the assistant only. */
export function Win98Window({
  title,
  onClose,
  children,
  width = 340,
  icon,
  label,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  icon?: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    // focus the first control so the keyboard lands inside the dialog
    const first = ref.current?.querySelector<HTMLElement>(".r98-window-body button, .r98-window-body input");
    first?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="r98-dialog-layer">
      <div className="r98-window-wrap" style={{ width }}>
        <span className="r98-window-shade" aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-label={label} className="r98-window">
          <div className="r98-titlebar">
            {icon && <span className="r98-titlebar-icon" aria-hidden="true">{icon}</span>}
            <span id={titleId} className="r98-titlebar-text">{title}</span>
            <button type="button" className="r98-titlebar-btn" aria-label={t("retro.button.close")} onClick={onClose}>
              <svg viewBox="0 0 8 7" width="8" height="7" aria-hidden="true">
                <path d="M0 0h2v1h1v1h2v-1h1v-1h2v1h-1v1h-1v1h-1v1h1v1h1v1h1v1h-2v-1h-1v-1h-2v1h-1v1h-2v-1h1v-1h1v-1h1v-1h-1v-1h-1v-1h-1z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <div className="r98-window-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
