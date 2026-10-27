// Settings > Notifications (App Store 1.2, src/lib/moderation.ts):
// - "Blocked people": the person's own list, each with Unblock. Personal,
//   kept on the server so every device of theirs agrees.
// - "Reports" (organization admins, a solo server's owner): every report
//   people sent, newest first, the reported words and who sent it, and
//   "Mark handled".
import { useCallback, useEffect, useState } from "react";
import { activeLocale, t } from "@/lib/i18n";
import { fetchReports, onReportsChanged, resolveReport, unblockPerson, useBlockedPeople, type ModerationReport } from "@/lib/moderation";
import { CompactRow, PILL, SettingsGroup } from "../SettingsPrimitives";

function formatDate(at: number): string {
  return new Date(at).toLocaleString(activeLocale(), { dateStyle: "medium", timeStyle: "short" });
}

export function BlockedPeopleSettings() {
  const people = useBlockedPeople();
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsGroup title={t("moderation.blocked.title")} groupId="blockedPeople">
      {people.length === 0 ? (
        <CompactRow label={t("moderation.blocked.none")} rowId="blockedPeople"><span /></CompactRow>
      ) : people.map((person) => (
        <CompactRow key={person.id} label={person.name || t("moderation.blocked.someone")} rowId={`blocked-${person.id}`}>
          <button
            type="button"
            className={PILL}
            data-unblock=""
            onClick={() => { setError(null); void unblockPerson(person.id).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))); }}
          >
            {t("moderation.unblock.short")}
          </button>
        </CompactRow>
      ))}
      <p className="px-3.5 pb-2 text-[12.5px] leading-[18px] text-ink-secondary">{t("moderation.blocked.help")}</p>
      {error && <p role="alert" className="px-3.5 pb-2 text-[12.5px] text-danger">{error}</p>}
    </SettingsGroup>
  );
}

export function ReportsSettings() {
  const [reports, setReports] = useState<ModerationReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetchReports().then((list) => { setReports(list); setError(null); }, (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  }, []);
  useEffect(() => {
    load();
    return onReportsChanged(load);
  }, [load]);
  const open = (reports ?? []).filter((report) => report.status === "open");
  const handled = (reports ?? []).filter((report) => report.status === "resolved").slice(0, 20);
  return (
    <div data-settings-card="notifications.reports">
      <SettingsGroup title={t("moderation.reports.title")} groupId="reports">
        {reports && open.length === 0 && <CompactRow label={t("moderation.reports.none")} rowId="reports"><span /></CompactRow>}
        {[...open, ...handled].map((report) => (
          <div key={report.id} data-report-row={report.status} className="flex flex-col gap-1 px-3.5 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-[13px] leading-[18px] text-ink">
                {t("moderation.reports.line", {
                  reporter: report.reporterName || t("moderation.blocked.someone"),
                  reported: report.reportedName || t("moderation.blocked.someone"),
                  reason: t(`moderation.reason.${report.reason}`),
                })}
                <div className="text-[12px] text-ink-secondary">
                  {report.peopleDm ? t("moderation.reports.inDm") : report.groupName ? t("moderation.reports.inRoom", { room: report.groupName }) : null}
                  {" · "}{formatDate(report.at)}
                </div>
              </div>
              {report.status === "open" ? (
                <button
                  type="button"
                  className={PILL}
                  data-resolve-report=""
                  onClick={() => void resolveReport(report.id).then(load, (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))}
                >
                  {t("moderation.reports.resolve")}
                </button>
              ) : (
                <span className="shrink-0 text-[12px] text-ink-secondary">{t("moderation.reports.handled")}</span>
              )}
            </div>
            {report.excerpt && <blockquote className="whitespace-pre-wrap border-l-2 border-hairline pl-2 text-[12.5px] leading-[18px] text-ink-secondary">{report.excerpt}</blockquote>}
            {report.note && <div className="text-[12.5px] leading-[18px] text-ink-secondary">{t("moderation.reports.note", { note: report.note })}</div>}
          </div>
        ))}
        {error && <p role="alert" className="px-3.5 pb-2 text-[12.5px] text-danger">{error}</p>}
      </SettingsGroup>
    </div>
  );
}
