// Plugins, main view ("Connect apps"): every app, MCP server, catalog plugin
// and skill in one list, with search across all of them, category chips and
// a short section per category. Installed rows open their detail page; the
// others carry Add (nothing to sign in to) or Connect (an account).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  connectedSummary,
  mainSections,
  type PluginFilter,
  type PluginItem,
  type PluginSection,
} from "@/lib/plugins-model";
import { PluginIcon, PluginStatusLabel } from "./PluginParts";

/** The chips in the row, in order; the rest sit under More. */
export const MAIN_CHIPS: PluginFilter[] = ["all", "productivity", "communication", "design", "code", "passwords"];
export const MORE_CHIPS: PluginFilter[] = ["apps", "mcp", "skills", "other"];

const FILTER_KEY: Record<string, LocaleKey> = {
  all: "connectApps.filter.all",
  productivity: "connectApps.filter.productivity",
  communication: "connectApps.filter.communication",
  design: "connectApps.filter.design",
  code: "connectApps.filter.code",
  passwords: "connectApps.filter.passwords",
  other: "connectApps.filter.other",
  apps: "connectApps.filter.apps",
  mcp: "connectApps.filter.mcp",
  skills: "connectApps.filter.skills",
};

const SECTION_KEY: Record<string, LocaleKey> = {
  recommended: "connectApps.section.recommended",
  results: "connectApps.section.results",
  productivity: "connectApps.filter.productivity",
  communication: "connectApps.filter.communication",
  design: "connectApps.filter.design",
  code: "connectApps.filter.code",
  passwords: "connectApps.filter.passwords",
  other: "connectApps.section.other",
  apps: "connectApps.filter.apps",
  mcp: "connectApps.section.mcp",
  skills: "connectApps.filter.skills",
  all: "connectApps.section.all",
};

/** A chip's or section's label. A marketplace source is shown by name. */
export function filterLabel(filter: string, sourceLabel?: (source: string) => string): string {
  if (filter.startsWith("source:")) {
    const source = filter.slice("source:".length);
    return sourceLabel?.(source) ?? source;
  }
  return t(FILTER_KEY[filter] ?? "connectApps.filter.other");
}

export function sectionTitle(section: Pick<PluginSection, "id">, sourceLabel?: (source: string) => string): string {
  if (section.id.startsWith("source:")) return filterLabel(section.id, sourceLabel);
  return t(SECTION_KEY[section.id] ?? "connectApps.section.other");
}

const PAGE = 60;

export interface ConnectAppsViewProps {
  items: PluginItem[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  filter: PluginFilter;
  onFilter: (filter: PluginFilter) => void;
  /** marketplace (or other) sources that get their own chip and section */
  extraSources?: string[];
  sourceLabel?: (source: string) => string;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onOpenManage: () => void;
  onOpenItem: (item: PluginItem) => void;
  /** the row's Add / Connect button */
  renderAction: (item: PluginItem) => ReactNode;
  /** what goes under a row (an account name field, a status line) */
  renderBelow?: (item: PluginItem) => ReactNode;
  /** notices between the chips and the list */
  notices?: ReactNode;
}

export function ConnectAppsView(props: ConnectAppsViewProps) {
  const { items, loading, search, onSearch, filter, onFilter, extraSources = [], sourceLabel, refreshing, onRefresh, onClose,
    onOpenManage, onOpenItem, renderAction, renderBelow, notices } = props;
  const [limit, setLimit] = useState(PAGE);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => setLimit(PAGE), [filter, search]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [moreOpen]);

  const sections = mainSections(items, search, filter, extraSources);
  const summary = connectedSummary(items);
  const moreChips: PluginFilter[] = [...extraSources.map((source) => `source:${source}` as PluginFilter), ...MORE_CHIPS];
  const moreActive = moreChips.includes(filter);
  const single = sections.length === 1 && (search.trim() !== "" || filter !== "all");

  return (
    <>
      <header className="flex items-start justify-between gap-4 px-6 pb-3 pt-6 sm:px-8">
        <h2 id="plugins-title" className="text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink">{t("connectApps.title")}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-plugins-connected
            onClick={onOpenManage}
            className="flex items-center gap-2 rounded-full py-1 pl-1.5 pr-2 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink"
            aria-label={t("connectApps.manageAria", { count: summary.count })}
          >
            {summary.icons.length > 0 && (
              <span className="flex -space-x-1.5" aria-hidden="true">
                {summary.icons.map((item) => (
                  <span key={item.key} className="rounded-lg ring-2 ring-elevated">
                    <PluginIcon item={item} className="size-5 rounded-md" />
                  </span>
                ))}
              </span>
            )}
            <span>{t("connectApps.connectedCount", { count: summary.count })}</span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={onRefresh} disabled={refreshing} className="ui-icon-button disabled:opacity-50" title={t("connectors.refreshTitle")} aria-label={t("connectors.refreshTitle")}>
            <RefreshCw size={17} className={cn(refreshing && "animate-spin")} />
          </button>
          <button
            type="button"
            data-tour="apps-close"
            onClick={onClose}
            aria-label={t("connectors.closeAria")}
            className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="px-6 sm:px-8">
        <label className="flex w-full items-center gap-2.5 rounded-[14px] border border-transparent bg-hover px-4 py-2.5 focus-within:border-border-strong">
          <Search size={16} className="shrink-0 text-ink-secondary" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t("connectApps.searchPlaceholder")}
            aria-label={t("connectApps.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t("connectApps.filtersAria")}>
          {MAIN_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              aria-pressed={filter === chip}
              onClick={() => onFilter(chip)}
              className={cn(
                "h-7 rounded-full border px-3 text-[12.5px] transition-colors",
                filter === chip ? "border-transparent bg-accent text-accent-ink" : "border-border text-ink-secondary hover:bg-hover hover:text-ink",
              )}
            >
              {filterLabel(chip, sourceLabel)}
            </button>
          ))}
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
              className={cn(
                "flex h-7 items-center gap-1 rounded-full border px-3 text-[12.5px] transition-colors",
                moreActive ? "border-transparent bg-accent text-accent-ink" : "border-border text-ink-secondary hover:bg-hover hover:text-ink",
              )}
            >
              {moreActive ? filterLabel(filter, sourceLabel) : t("connectApps.filter.more")}
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {moreOpen && (
              <div role="menu" className="absolute left-0 top-8 z-10 min-w-[180px] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1">
                {moreChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    role="menuitemradio"
                    aria-checked={filter === chip}
                    onClick={() => {
                      onFilter(chip);
                      setMoreOpen(false);
                    }}
                    className={cn("block w-full truncate rounded-lg px-3 py-1.5 text-left text-[12.5px]", filter === chip ? "bg-hover text-ink" : "text-ink-secondary hover:bg-hover hover:text-ink")}
                  >
                    {filterLabel(chip, sourceLabel)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {notices}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-4 sm:px-8" data-plugins-list>
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-ink-secondary">
            <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
          </div>
        ) : sections.every((section) => section.items.length === 0) ? (
          <div className="flex min-h-56 flex-col items-center justify-center text-center">
            <div className="text-[14px] font-medium text-ink">{t("connectors.noAppsFound")}</div>
            <div className="mt-1 text-[12.5px] text-ink-secondary">{t("connectors.tryDifferentSearch")}</div>
          </div>
        ) : (
          sections.map((section) => {
            const shown = single ? section.items.slice(0, limit) : section.items;
            return (
              <section key={section.id} data-plugins-section={section.id} className="mb-5">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <h3 className="text-[13px] font-semibold text-ink">{sectionTitle(section, sourceLabel)}</h3>
                  {!single && section.filter && section.total > section.items.length && (
                    <button type="button" onClick={() => onFilter(section.filter!)} className="text-[12px] text-ink-secondary hover:text-ink">
                      {t("connectApps.viewAll")}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-x-2 gap-y-0.5 md:grid-cols-2">
                  {shown.map((item) => (
                    <PluginRow key={item.key} item={item} onOpen={onOpenItem} action={renderAction(item)} below={renderBelow?.(item)} />
                  ))}
                </div>
                {single && section.items.length > shown.length && (
                  <div className="mt-3 flex justify-center">
                    <button type="button" onClick={() => setLimit((current) => current + PAGE)} className="ui-button">
                      {t("connectApps.showMore", { count: section.items.length - shown.length })}
                    </button>
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

/** One row: icon, name, one line, and Add / Connect or the status. An
 * installed row opens its detail page. */
export function PluginRow({ item, onOpen, action, below }: { item: PluginItem; onOpen: (item: PluginItem) => void; action: ReactNode; below?: ReactNode }) {
  const opens = item.installed;
  return (
    <div data-plugin-row={item.key} className="rounded-2xl p-2.5 hover:bg-ink/5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!opens}
          onClick={() => onOpen(item)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
          aria-label={opens ? t("connectApps.openAria", { name: item.name }) : undefined}
        >
          <PluginIcon item={item} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-[18px] text-ink">{item.name}</span>
            <span className="block truncate text-[12px] leading-[18px] text-ink-tertiary" title={item.description}>{item.description}</span>
          </span>
        </button>
        {action ?? (item.installed ? <PluginStatusLabel status={item.status} /> : null)}
      </div>
      {below}
    </div>
  );
}
