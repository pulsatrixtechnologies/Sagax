// Settings > Computer > Your computer, on an organization server (0.5.6:
// Grok Bot's Computer page, JC). Each bot's Works on decides (Auto and
// Cloud: the person's server environment; Local VM and This computer: their
// own computer through this desktop app); here, rows of the "Your computer"
// group: whether routines may use it, which destinations bots may reach
// through it (with whether it is connected), the person's other computers,
// and, behind a discreet link, what bots recently did there (#555)
// (src/lib/desktop-bridge.ts, server/desktop-bridge.ts).
import { useEffect, useState } from "react";
import { ChevronDown, Link2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { currentDesktop, readWorkplace, useDesktopBridgeStatus, writeWorkplace, type DesktopBridgeActivity, type DesktopBridgeDesktop, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { DEFAULT_BOT_WORKPLACE, type BotWorkplace } from "../../../shared/bot-workplace";
import { DescribedRow, PillSelect, Switch } from "../SettingsPrimitives";

function when(ms: number): string {
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
}

export function activityLine(entry: DesktopBridgeActivity): string {
  const where = entry.target === "user-desktop" ? t("botWorkplace.activity.computer") : entry.target === "user-sandbox" ? t("botWorkplace.activity.server") : t("botWorkplace.activity.direct");
  // a connection's detail is the platform and host name: never shown
  const what = entry.kind === "connect" ? t("botWorkplace.activity.connected") : entry.detail;
  return `${what} · ${where}${entry.ok ? "" : ` · ${t("botWorkplace.activity.failed")}`}`;
}

/** The person's computers other than the one bots use now, the most
 * recently seen first. */
export function otherComputers(status: DesktopBridgeStatus): DesktopBridgeDesktop[] {
  const current = currentDesktop(status);
  return status.desktops.filter((desktop) => desktop.id !== current?.id).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function seenLine(desktop: DesktopBridgeDesktop): string {
  return desktop.online ? t("orgComputer.connected") : t("computer.lastSeen", { when: when(desktop.lastSeenAt) });
}

export function BotWorkplaceSettings({ status: given }: { status?: DesktopBridgeStatus } = {}) {
  const polled = useDesktopBridgeStatus(15_000);
  const status = given ?? polled;
  const [showActivity, setShowActivity] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [workplace, setWorkplace] = useState<BotWorkplace>(() => {
    if (given?.workplace) return given.workplace;
    try { return readWorkplace(); } catch { return { ...DEFAULT_BOT_WORKPLACE }; }
  });
  useEffect(() => { if (status?.workplace) setWorkplace(status.workplace); }, [status?.workplace?.routines, status?.workplace?.network]);
  if (!status) return null;
  const change = (next: Partial<BotWorkplace>) => {
    const value = { ...workplace, ...next };
    setWorkplace(value);
    writeWorkplace(value);
  };
  const others = otherComputers(status);
  return (
    <div data-settings-card="organization.botWorkplace" data-desktop-connected={status.connected ? "yes" : "no"}>
      <DescribedRow label={t("botWorkplace.routinesShort")} description={t("botWorkplace.routinesHint")} rowId="routines">
        <Switch checked={workplace.routines} aria-label={t("botWorkplace.routines")} onClick={() => change({ routines: !workplace.routines })} />
      </DescribedRow>
      <DescribedRow
        label={t("botWorkplace.network")}
        icon={<Link2 size={14} />}
        description={<span role="status">{t(status.connected ? "botWorkplace.status.connected" : "botWorkplace.status.notConnected")}</span>}
        rowId="network"
      >
        <PillSelect
          value={workplace.network}
          ariaLabel={t("botWorkplace.network")}
          onChange={(network) => change({ network })}
          options={[
            { value: "all", label: t("botWorkplace.network.all") },
            { value: "lan", label: t("botWorkplace.network.lan") },
          ]}
        />
      </DescribedRow>
      {others.length > 0 && (
        <DescribedRow
          label={t("computer.others")}
          description={`${others[0]!.name} · ${seenLine(others[0]!)}`}
          rowId="others"
          below={showOthers && (
            <ul className="mt-2 flex flex-col gap-0.5" aria-label={t("computer.others")} data-other-computers="">
              {others.map((desktop) => (
                <li key={desktop.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-hover">
                  <span className="min-w-0 truncate text-ink">{desktop.name}</span>
                  <span className="shrink-0 text-[12px] text-ink-secondary">{seenLine(desktop)}</span>
                </li>
              ))}
            </ul>
          )}
        >
          <button
            type="button"
            aria-expanded={showOthers}
            aria-label={t(showOthers ? "computer.others.hide" : "computer.others.show")}
            onClick={() => setShowOthers((open) => !open)}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] text-ink tabular-nums transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 aria-expanded:bg-hover motion-reduce:transition-none"
          >
            {others.length}
            <ChevronDown size={13} aria-hidden="true" className={cn("text-ink-secondary transition-transform motion-reduce:transition-none", showOthers && "rotate-180")} />
          </button>
        </DescribedRow>
      )}
      {status.activity.length > 0 && (
        <div className="flex flex-col gap-1 px-3.5 pb-2 pt-1" data-bot-activity={showActivity ? "open" : "closed"}>
          <button type="button" aria-expanded={showActivity} onClick={() => setShowActivity((open) => !open)}
            className="min-h-[44px] self-start rounded-md text-[12px] text-ink-secondary hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 md:min-h-0">
            {showActivity ? t("botWorkplace.activity.hide") : t("botWorkplace.activity.show")}
          </button>
          {showActivity && (
            <ul className="flex flex-col gap-0.5 text-[12px]" aria-label={t("botWorkplace.activity")}>
              {status.activity.slice(0, 10).map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={entry.ok ? "text-ink" : "text-danger"}>
                  <span className="text-ink-secondary">{when(entry.at)}</span> {activityLine(entry)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
