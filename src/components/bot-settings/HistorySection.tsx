// History: every change recorded against this bot's profile (name, title,
// instructions, soul, and the rest of PROFILE_REQUEST_FIELDS), newest
// first. Server-built list (GET /api/bots/:id/history), and a soul row
// carries a rollback: POST /api/bots/:id/history/rollback { id, expectedRevision } restores
// that row's previous SOUL.md text (labeled "Undo", not "Restore": it
// applies the previous text, it doesn't reopen an old version to edit).
// Pure presentational: the dialog owns the fetch, the reload after rollback,
// and the loading/error split. A first-load failure never reaches this
// component (the dialog shows "Couldn't load history." instead); a failed
// reload with rows already on screen arrives as refreshError, the same
// data-wins precedence OverviewSection gets one level up.
import { t } from "@/lib/i18n";
import { formatBytes } from "@/lib/memory";
import { whenLabel } from "@/lib/schedule-label";
import { utf8Bytes } from "@/lib/soul";
import type { LocaleKey } from "@/locales";

const ACTOR: Record<string, LocaleKey> = {
  user: "botPanel.history.actor.user",
  bot: "botPanel.history.actor.bot",
  file: "botPanel.history.actor.file",
  import: "botPanel.history.actor.import",
  system: "botPanel.history.actor.system",
};
const FIELD: Record<string, LocaleKey> = {
  soul: "botSettings.nav.soul",
  name: "botPanel.history.field.name",
  title: "botPanel.history.field.title",
  description: "botPanel.history.field.description",
};

/** Who changed it, in words ("You", "The bot"); an unknown actor as sent. */
export function historyWho(row: Pick<HistoryRow, "actor">): string {
  const key = ACTOR[row.actor];
  return key ? t(key) : row.actor;
}

/** "Soul: 0 B → 372 B", "Name: "Ara" → "Aria"", built from the row's own
 * before and after; the server's English summary when they are absent. */
export function historySummary(row: HistoryRow): string {
  const field = FIELD[row.field] ? t(FIELD[row.field]!) : row.field;
  if (row.field === "soul" && typeof row.before === "string" && typeof row.after === "string") {
    return `${field}${t("botPanel.history.separator")}${formatBytes(utf8Bytes(row.before))} → ${formatBytes(utf8Bytes(row.after))}`;
  }
  if (typeof row.before === "string" && typeof row.after === "string") {
    return `${field}${t("botPanel.history.separator")}${JSON.stringify(row.before)} → ${JSON.stringify(row.after)}`;
  }
  return row.summary;
}

export interface HistoryRow {
  id: string;
  at: number;
  actor: string;
  via: string;
  field: string;
  summary: string;
  canRestore?: boolean;
  restoreUnavailableReason?: string;
  before?: string;
  after?: string;
}

export function HistorySection({
  bot,
  rows,
  refreshError,
  onRollback,
  rollingBack,
}: {
  bot: { id: string };
  rows: HistoryRow[] | null;
  refreshError?: boolean;
  onRollback: (id: string) => void;
  rollingBack?: boolean;
}) {
  if (!rows) {
    return <div className="text-[13px] text-ink-secondary">{t("botPanel.loading")}</div>;
  }
  if (rows.length === 0) {
    return <div className="text-[13px] text-ink-secondary">{t("botPanel.history.empty")}</div>;
  }

  const sorted = [...rows].sort((a, b) => b.at - a.at);

  return (
    <div className="flex flex-col gap-2">
      {refreshError && (
        <div className="text-[12.5px] text-ink-secondary">{t("botPanel.history.refresh")}</div>
      )}
      <ul className="divide-y divide-hairline/40 overflow-hidden rounded-lg border border-hairline/40">
      {sorted.map((row) => (
        <li key={`${bot.id}-${row.id}`} className="px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
              <span>{historySummary(row)}</span>
              <span className="block text-[12px] text-ink-secondary" title={row.via}>
                {historyWho(row)} · {whenLabel(row.at)}
              </span>
            </div>
            {row.field === "soul" && row.canRestore === true && (
              <button
                type="button"
                disabled={rollingBack}
                onClick={() => onRollback(row.id)}
                className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent/10 disabled:opacity-50"
              >
                {t("botPanel.history.undo")}
              </button>
            )}
          </div>
          {row.field === "soul" && row.canRestore !== true && (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
              {t("botPanel.history.unavailable")}
            </p>
          )}
        </li>
      ))}
      </ul>
    </div>
  );
}
