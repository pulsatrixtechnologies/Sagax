// Small shared pieces for the chat's rich blocks: the block frame and its
// header, a toolbar button, copy-with-feedback, and the skin scheme lookup.
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import { cn } from "@/lib/cn";

/** Scheme of the nearest skin, read from the --code-color-scheme token the
 * Shiki and mermaid blocks already follow. Unreadable means dark, the
 * default skin's value. */
export function skinScheme(element: Element | null): "light" | "dark" {
  if (!element || typeof window === "undefined" || typeof window.getComputedStyle !== "function") return "dark";
  try {
    return window.getComputedStyle(element).getPropertyValue("--code-color-scheme").trim() === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Follow skin changes (data-skin on any element) for renderers that bake
 * the scheme into their output, like widget documents and chart palettes. */
export function useSkinScheme(ref: { current: Element | null }): "light" | "dark" {
  const [scheme, setScheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    setScheme(skinScheme(ref.current));
    if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    const observer = new MutationObserver(() => setScheme(skinScheme(ref.current)));
    observer.observe(document.documentElement, { subtree: true, attributeFilter: ["data-skin", "class", "data-theme"] });
    return () => observer.disconnect();
  }, [ref]);
  return scheme;
}

/** Copy text (or rich HTML with a text fallback) and flag success briefly. */
export function useCopyFeedback(): { copied: string | null; copy: (id: string, text: string, html?: string) => Promise<boolean> } {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = useCallback(async (id: string, text: string, html?: string) => {
    try {
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (html && clipboard?.write && typeof ClipboardItem !== "undefined") {
        await clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
      } else if (clipboard?.writeText) {
        await clipboard.writeText(text);
      } else return false;
      setCopied(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
      return true;
    } catch {
      return false;
    }
  }, []);
  return { copied, copy };
}

export function BlockFrame({ children, className, frameRef, label }: {
  children: ReactNode;
  className?: string;
  frameRef?: Ref<HTMLDivElement>;
  label?: string;
}) {
  return (
    <div
      ref={frameRef}
      dir="ltr"
      role={label ? "group" : undefined}
      aria-label={label}
      className={cn("my-2 min-w-0 overflow-hidden rounded-lg border border-hairline/40 bg-inset", className)}
    >
      {children}
    </div>
  );
}

export function BlockHeader({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-hairline/30 bg-raised/30 px-3 py-1.5 text-xs">
      <span className="flex min-w-0 items-center gap-1.5">
        {icon}
        <span title={title} className="min-w-0 truncate rounded border border-hairline/40 bg-raised px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink select-none">
          {title}
        </span>
      </span>
      {children && <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">{children}</span>}
    </div>
  );
}

export function ToolButton({ onClick, label, children, pressed, disabled, className }: {
  onClick: () => void;
  label: string;
  children: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 motion-reduce:transition-none",
        pressed ? "bg-accent/15 font-medium text-accent" : "text-ink-secondary hover:bg-raised hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
