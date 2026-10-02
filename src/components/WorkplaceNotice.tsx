// Above the composer, on an organization server: where this person's bots
// work right now. On their computer (and its network: traffic goes through
// it), or, when they want their computer but it is not connected, a plain
// line saying the server environment is used instead. Nothing on a solo
// server (src/lib/desktop-bridge.ts).
import { Laptop, Server } from "lucide-react";

import { t } from "@/lib/i18n";
import { useDesktopBridgeStatus, workplaceNotice } from "@/lib/desktop-bridge";

export function WorkplaceNotice() {
  const status = useDesktopBridgeStatus();
  const kind = status ? workplaceNotice(status, status.workplace) : null;
  if (!kind) return null;
  if (kind === "fallback") {
    return (
      <div role="status" data-workplace="fallback" className="mb-2 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-[12px] text-warning">
        <Server size={13} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1">{t("botWorkplace.notice.fallback")}</span>
      </div>
    );
  }
  return (
    <div role="status" data-workplace="computer" className="mb-2 flex items-center gap-2 px-1 text-[11.5px] text-ink-secondary">
      <Laptop size={12} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{status?.tunnel ? t("botWorkplace.notice.computerTraffic") : t("botWorkplace.notice.computer")}</span>
    </div>
  );
}
