import { useEffect } from "react";
import { Lock } from "lucide-react";

import { cn } from "@/lib/cn";
import { confidentialTitle } from "@/lib/confidential-thread";
import { t } from "@/lib/i18n";

/** The classification band of a confidential thread (JC 2026-10-16): a
 * solid, full-width band like a printed marking, at the top of the
 * conversation and again just above the composer. It is permanent for as long
 * as the thread is confidential, which is for good: no close button, no
 * state that hides it. Its height is fixed (CONFIDENTIAL_BANNER_HEIGHT) and
 * it takes its own row, so it never shifts the transcript. Same colors in
 * every skin and theme (--color-confidential in styles.css). */
export const CONFIDENTIAL_BANNER_HEIGHT = 26;

export function ConfidentialBanner({ position, className }: { position: "top" | "bottom"; className?: string }) {
  return (
    <div
      role="note"
      data-confidential-banner={position}
      style={{ height: CONFIDENTIAL_BANNER_HEIGHT }}
      className={cn(
        "pointer-events-none flex w-full shrink-0 select-none items-center justify-center gap-1.5 bg-confidential text-confidential-ink",
        position === "top" ? "border-b-2 border-confidential-edge" : "border-t-2 border-confidential-edge",
        className,
      )}
    >
      <Lock aria-hidden="true" size={12} strokeWidth={2.5} />
      <span aria-hidden="true" className="text-[11.5px] font-bold uppercase leading-none tracking-[0.18em]">{t("confidential.mark")}</span>
      <span className="sr-only">{t("confidential.bannerAria")}</span>
    </div>
  );
}

/** The sidebar and thread picker badge: a lock and the word. */
export function ConfidentialBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      data-confidential-badge=""
      title={t("confidential.badgeTitle")}
      className={cn("inline-flex shrink-0 items-center gap-0.5 rounded bg-confidential px-1 py-px text-[9.5px] font-bold uppercase leading-[14px] tracking-wide text-confidential-ink", className)}
    >
      <Lock aria-hidden="true" size={9} strokeWidth={2.5} />
      {compact ? <span className="sr-only">{t("confidential.mark")}</span> : <span>{t("confidential.mark")}</span>}
    </span>
  );
}

/** While a confidential thread is on screen the window title carries the
 * lock and the word, so the window switcher and a screenshot show it too.
 * The title it found comes back when the thread closes. */
export function useConfidentialDocumentTitle(confidential: boolean): void {
  useEffect(() => {
    if (!confidential || typeof document === "undefined") return;
    const before = document.title;
    document.title = confidentialTitle(before, true, t("confidential.mark"));
    return () => {
      document.title = before;
    };
  }, [confidential]);
}
