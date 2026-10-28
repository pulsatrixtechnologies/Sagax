// The pager of a long Settings list: rows a page (10, 25 or 50), "1-10 of
// N", Previous and Next. One component for every paged list of Settings
// (2026-10-28): the usage traces (Settings > Usage) and the approval rules
// (Settings > Security) page the same way, with the same words.
import { t } from "@/lib/i18n";
import { pageRange, TRACE_PAGE_SIZES } from "@/lib/usage-trace";
import { PillSelect } from "./SettingsPrimitives";

/** The page sizes a Settings list offers, and the one it starts on. */
export const SETTINGS_PAGE_SIZES = TRACE_PAGE_SIZES;
export const SETTINGS_DEFAULT_PAGE_SIZE = 10;

/** The offset to show once the list holds `total` rows: the same page while it
 * still exists, else the last page (a removed row never leaves an empty page). */
export function clampPageOffset(offset: number, total: number, pageSize: number): number {
  if (total <= 0 || offset <= 0) return 0;
  if (offset < total) return offset;
  return Math.max(0, Math.floor((total - 1) / pageSize) * pageSize);
}

export function SettingsPager({ offset, count, total, pageSize, onPage, onPageSize }: {
  offset: number; count: number; total: number; pageSize: number;
  onPage: (offset: number) => void; onPageSize: (size: number) => void;
}) {
  return (
    <div data-settings-pager="" className="flex flex-wrap items-center justify-between gap-2 border-t-[0.5px] border-border px-3 py-2 text-[12px] text-ink-secondary">
      <label className="flex items-center gap-1">
        <span>{t("usage.trace.perPage")}</span>
        <PillSelect<string>
          value={String(pageSize)}
          options={SETTINGS_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
          onChange={(next) => onPageSize(Number(next))}
          ariaLabel={t("usage.trace.perPage")}
        />
      </label>
      <span className="tabular-nums" aria-live="polite">
        {t("usage.trace.range", { range: pageRange(offset, count), total: String(total) })}
      </span>
      <span className="flex items-center gap-1">
        <button type="button" data-settings-pager-prev="" className="ui-button min-h-[44px] disabled:opacity-50 md:min-h-0" disabled={offset <= 0} onClick={() => onPage(Math.max(0, offset - pageSize))}>
          {t("usage.trace.prev")}
        </button>
        <button type="button" data-settings-pager-next="" className="ui-button min-h-[44px] disabled:opacity-50 md:min-h-0" disabled={offset + count >= total} onClick={() => onPage(offset + pageSize)}>
          {t("usage.trace.next")}
        </button>
      </span>
    </div>
  );
}
