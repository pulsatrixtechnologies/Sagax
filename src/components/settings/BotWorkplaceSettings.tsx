// Settings > Organization > Where bots work, on an organization server: each
// bot's Works on decides (Auto and Cloud: the person's server environment;
// Local VM and This computer: their own computer through this desktop app);
// here, whether their computer is connected, whether routines may use it,
// which destinations bots may reach through it, and what bots recently did
// there (src/lib/desktop-bridge.ts, server/desktop-bridge.ts).
import { useEffect, useState } from "react";

import { activeLocale, t } from "@/lib/i18n";
import { readWorkplace, useDesktopBridgeStatus, writeWorkplace, type DesktopBridgeActivity } from "@/lib/desktop-bridge";
import type { BotWorkplace } from "../../../shared/bot-workplace";
import { Card } from "../SettingsPrimitives";

function when(ms: number): string {
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
}

export function activityLine(entry: DesktopBridgeActivity): string {
  const where = entry.target === "user-desktop" ? t("botWorkplace.activity.computer") : entry.target === "user-sandbox" ? t("botWorkplace.activity.server") : t("botWorkplace.activity.direct");
  return `${entry.detail} · ${where}${entry.ok ? "" : ` · ${t("botWorkplace.activity.failed")}`}`;
}

export function BotWorkplaceSettings() {
  const status = useDesktopBridgeStatus(15_000);
  const [workplace, setWorkplace] = useState<BotWorkplace>(() => readWorkplace());
  useEffect(() => { if (status?.workplace) setWorkplace(status.workplace); }, [status?.workplace?.routines, status?.workplace?.network]);
  if (!status) return null;
  const change = (next: Partial<BotWorkplace>) => {
    const value = { ...workplace, ...next };
    setWorkplace(value);
    writeWorkplace(value);
  };
  const online = status.desktops.filter((desktop) => desktop.online);
  const summary = status.connected ? t("orgComputer.connected") : t("orgComputer.notConnected");
  return (
    <Card cardId="organization.botWorkplace" title={t("botWorkplace.title")} summary={summary}>
      <div className="flex flex-col gap-3 text-[13px]" data-desktop-connected={status.connected ? "yes" : "no"}>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("botWorkplace.help")}</p>
        <p role="status" className={status.connected ? "text-ink" : "text-ink-secondary"}>
          {status.connected
            ? t("botWorkplace.connected", { name: online[0]?.name ?? "" })
            : t("botWorkplace.notConnected")}
        </p>
        <label className="flex min-h-[44px] items-center gap-2 md:min-h-0">
          <input type="checkbox" checked={workplace.routines} onChange={(event) => change({ routines: event.target.checked })} />
          <span>{t("botWorkplace.routines")}</span>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-ink-secondary">{t("botWorkplace.network")}</legend>
          <label className="flex min-h-[44px] items-center gap-2 md:min-h-0">
            <input type="radio" name="bot-network" checked={workplace.network === "all"} onChange={() => change({ network: "all" })} />
            <span>{t("botWorkplace.network.all")}</span>
          </label>
          <label className="flex min-h-[44px] items-center gap-2 md:min-h-0">
            <input type="radio" name="bot-network" checked={workplace.network === "lan"} onChange={() => change({ network: "lan" })} />
            <span>{t("botWorkplace.network.lan")}</span>
          </label>
        </fieldset>
        {status.activity.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-ink-secondary">{t("botWorkplace.activity")}</span>
            <ul className="flex flex-col gap-0.5 text-[12px]">
              {status.activity.slice(0, 10).map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={entry.ok ? "text-ink" : "text-danger"}>
                  <span className="text-ink-secondary">{when(entry.at)}</span> {activityLine(entry)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
