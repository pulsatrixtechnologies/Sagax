// Above the composer, on an organization server, when this conversation's
// bot works on the person's own computer (Works on Local VM or This
// computer): on it (and its network: traffic goes through it), or a plain
// line saying it is not connected. Nothing for Auto and Cloud (the server
// environment) nor on a solo server (src/lib/desktop-bridge.ts).
import { Laptop, Server } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";
import { useDesktopBridgeStatus, workplaceNotice } from "@/lib/desktop-bridge";
import { orgComputerFor, type EffectivePlace } from "@/lib/place";

/** A composer-slot notice sits in the dock's normal flow, above the input, on
 * the same opaque app ground as the composer block (full-bleed, like the
 * composer backdrop). The transcript scrolls behind the whole dock and its
 * bottom padding follows the dock's measured height, so a notice never draws
 * over message text. The bottom padding (not a margin) carries the gap so the
 * ground is continuous down to the input. */
export function ComposerNoticeBand({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div data-composer-notice-band className={`relative pb-2 ${className}`}>
      <div aria-hidden className="pointer-events-none absolute -left-[50vw] -right-[50vw] inset-y-0 bg-app" />
      <div className="relative">{children}</div>
    </div>
  );
}

export function WorkplaceNotice({ place }: { place: EffectivePlace | null }) {
  const status = useDesktopBridgeStatus();
  const kind = status && place ? workplaceNotice(status, orgComputerFor(place)) : null;
  if (!kind) return null;
  if (kind === "fallback") {
    return (
      <ComposerNoticeBand>
      <div role="status" data-workplace="fallback" className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-[12px] text-warning">
        <Server size={13} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1">{t("botWorkplace.notice.fallback")}</span>
      </div>
      </ComposerNoticeBand>
    );
  }
  return (
    <ComposerNoticeBand>
    <div role="status" data-workplace="computer" className="flex items-center gap-2 px-1 text-[11.5px] text-ink-secondary">
      <Laptop size={12} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{status?.tunnel ? t("botWorkplace.notice.computerTraffic") : t("botWorkplace.notice.computer")}</span>
    </div>
    </ComposerNoticeBand>
  );
}
