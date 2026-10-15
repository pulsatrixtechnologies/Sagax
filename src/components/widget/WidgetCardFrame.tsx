// The card a chat widget is drawn in, for anything else that shows a card in
// the transcript: the same width steps, surface, header and error line as a
// declarative widget (WidgetMessage), with the content left to the caller.
// The MCP Apps host (a `ui://` resource in a sandboxed iframe) is meant to
// sit in it, so both kinds of card look and fold the same way. Sagax only:
// WidgetMessage itself stays as upstream wrote it and only lends its WIDTH
// and SURFACE here.
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { MessageBoundary } from "../MessageBoundary";
import { SURFACE, WIDTH } from "./WidgetMessage";

export interface WidgetCardFrameProps {
  /** What a screen reader calls the card. Defaults to the title. */
  label: string;
  title?: string;
  caption?: string;
  /** A short note on the right of the header, such as a count or a time. */
  meta?: string;
  /** "sm" 360px, "md" 440px, "lg" and "full" 600px; never wider than the chat column. */
  size?: "sm" | "md" | "lg" | "full";
  /** Dims the card and marks it busy while something it sent is on its way. */
  busy?: boolean;
  /** A sentence shown inside the card, under the content, as an alert. */
  problem?: string;
  /** Buttons under the card (the place a widget's confirm and cancel go). */
  footer?: ReactNode;
  /** The text the card falls back to if its content throws while drawing. */
  fallbackText: string;
  /** Lets a caller name the card for tests and live updates (data-widget-frame). */
  frameId?: string;
  /** No padding around the content: an iframe or an image that runs to the edges. */
  flush?: boolean;
  children: ReactNode;
}

export function WidgetCardFrame({ label, title, caption, meta, size = "lg", busy = false, problem, footer, fallbackText, frameId, flush = false, children }: WidgetCardFrameProps) {
  const headed = Boolean(title || caption || meta);
  return (
    <MessageBoundary fallbackText={fallbackText}>
      <div role="group" aria-label={label} aria-busy={busy || undefined} data-widget-frame={frameId} className={cn("w-full text-start", WIDTH[size] ?? WIDTH.lg)}>
        <div className={cn(SURFACE, busy && "opacity-[0.55]")}>
          {headed && (
            <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
              <div className="min-w-0 flex-1">
                {title && <div title={title} className="truncate text-[15px] font-semibold leading-6 text-ink"><bdi dir="auto">{title}</bdi></div>}
                {caption && <div dir="auto" className="mt-0.5 text-[13px] leading-snug text-ink-secondary">{caption}</div>}
              </div>
              {meta && <span dir="auto" className="mt-1 shrink-0 whitespace-nowrap text-[12px] leading-4 tabular-nums text-ink-tertiary">{meta}</span>}
            </div>
          )}
          <div className={cn("min-w-0", !flush && (headed ? "px-4 pb-4" : "p-4"))}>{children}</div>
          {problem && (
            <div role="alert" className="mx-4 flex items-start gap-2 border-t border-ink/[0.12] pb-3.5 pt-3 text-[13px] leading-[18px] text-danger">
              <CircleAlert aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
              <span dir="auto" className="min-w-0 break-words">{problem}</span>
            </div>
          )}
        </div>
        {footer && <div className="mt-2.5 flex flex-wrap items-center gap-2">{footer}</div>}
      </div>
    </MessageBoundary>
  );
}
