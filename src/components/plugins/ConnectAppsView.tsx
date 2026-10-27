// Connect Apps: one page (2026-10-27, JC: one place per subject). The
// title with "N connected" at its right, the install scope, then four tabs:
// Installed, Discover (the catalog, its search and Browse Bots; the view a
// person lands on), My accounts and Sources (with the organization's part
// for an admin). No sub-page repeats a tab: "Manage plugins and skills" and
// a section opened alone are gone, View all filters Discover in place.
// The shared row parts (pills, section titles, PluginRow) live here too.
import type { ReactNode } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  CATEGORY_ORDER,
  MAIN_CATEGORIES,
  MORE_CATEGORIES,
  connectedSummary,
  type PluginFilter,
  type PluginItem,
  type PluginSection,
  type PluginTypeFilter,
} from "@/lib/plugins-model";
import { CATEGORY_MODAL } from "../category-modal";
import { PluginIcon, PluginStatusLabel } from "./PluginParts";

/** The pills: All, then each category in the section order (only those with
 * a row, and the chosen one). Kinds and sources are not pills. */
export const MAIN_CHIPS: PluginFilter[] = ["all"];
export const CATEGORY_CHIPS: PluginFilter[] = [...CATEGORY_ORDER];
export const TYPE_FILTERS: PluginTypeFilter[] = ["any", "apps", "mcp", "skills"];

const MAIN_CATEGORY_SET = new Set<string>(MAIN_CATEGORIES);
const MORE_CATEGORY_SET = new Set<string>(MORE_CATEGORIES);

/** The pills on the row: All, then the main categories that have a row. */
export function categoryPills(items: readonly Pick<PluginItem, "category">[], filter: PluginFilter): PluginFilter[] {
  const present = new Set<string>(items.map((item) => item.category));
  return [...MAIN_CHIPS, ...CATEGORY_CHIPS.filter((chip) => MAIN_CATEGORY_SET.has(chip) && (present.has(chip) || chip === filter))];
}

/** Categories that sit in the More menu: the ones with a row, or the one
 * that is already chosen. */
export function moreCategoryPills(items: readonly Pick<PluginItem, "category">[], filter: PluginFilter): PluginFilter[] {
  const present = new Set<string>(items.map((item) => item.category));
  return CATEGORY_CHIPS.filter((chip) => MORE_CATEGORY_SET.has(chip) && (present.has(chip) || chip === filter));
}

const FILTER_KEY: Record<string, LocaleKey> = {
  all: "connectApps.filter.all",
  productivity: "connectApps.filter.productivity",
  communication: "connectApps.filter.communication",
  design: "connectApps.filter.design",
  code: "connectApps.filter.code",
  passwords: "connectApps.filter.passwords",
  data: "connectApps.filter.data",
  sales: "connectApps.filter.sales",
  finance: "connectApps.filter.finance",
  marketing: "connectApps.filter.marketing",
  research: "connectApps.filter.research",
  support: "connectApps.filter.support",
  other: "connectApps.filter.other",
  any: "connectApps.type.any",
  apps: "connectApps.filter.apps",
  mcp: "connectApps.filter.mcp",
  skills: "connectApps.filter.skills",
};

const SECTION_KEY: Record<string, LocaleKey> = {
  ...FILTER_KEY,
  recommended: "connectApps.section.recommended",
  needed: "connectApps.section.needed",
  results: "connectApps.section.results",
  other: "connectApps.section.other",
  mcp: "connectApps.section.mcp",
};

/** A chip's, type's or section's label. A marketplace source is shown by name. */
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

export type ConnectAppsTab = "installed" | "discover" | "accounts" | "sources";
export const CONNECT_APPS_TABS: readonly ConnectAppsTab[] = ["installed", "discover", "accounts", "sources"];

const TAB_KEY = {
  installed: "connectApps.manage.tab.installed",
  discover: "connectApps.manage.tab.discover",
  accounts: "connectApps.manage.tab.accounts",
  sources: "connectApps.manage.tab.sources",
} as const satisfies Record<ConnectAppsTab, LocaleKey>;

/** Where "N connected" leads (#1132, #1194): Installed, or My accounts when
 * the number is only the engine accounts' connectors (nothing of the
 * person's own is connected, and not in a bot's scope). */
export function connectedTab(input: { botScope: boolean; engineConnected: number; ownConnected: number }): ConnectAppsTab {
  return !input.botScope && input.engineConnected > 0 && input.ownConnected === 0 ? "accounts" : "installed";
}

export interface ConnectAppsViewProps {
  tab: ConnectAppsTab;
  onTab: (tab: ConnectAppsTab) => void;
  /** tabs with nothing to show are left out (Sources when nothing reads
   * or changes a source) */
  tabs?: readonly ConnectAppsTab[];
  /** what "N connected" counts: the installed rows */
  items: readonly PluginItem[];
  /** connectors an engine account brings, counted in "N connected" */
  extraConnected?: number;
  /** "N connected": the tab that lists them (#1194) */
  onOpenConnected: () => void;
  /** the install scope (everyone, or one bot) under the title */
  scope?: ReactNode;
  /** notices between the tabs and the panel */
  notices?: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  installed?: ReactNode;
  discover?: ReactNode;
  accounts?: ReactNode;
  sources?: ReactNode;
}

export function ConnectAppsView(props: ConnectAppsViewProps) {
  const { tab, onTab, tabs = CONNECT_APPS_TABS, items, extraConnected = 0, onOpenConnected, scope, notices, refreshing, onRefresh } = props;
  const shown = tabs.includes(tab) ? tab : tabs.includes("discover") ? "discover" : tabs[0] ?? "discover";
  const summary = connectedSummary(items, extraConnected);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-plugins-main={shown}>
      <header className={CATEGORY_MODAL.titleBar}>
        <div className="flex items-center justify-between gap-4">
          <h2 id="plugins-title" className={CATEGORY_MODAL.title}>{t("connectApps.title")}</h2>
          <ConnectedButton summary={summary} onOpen={onOpenConnected} />
        </div>
        {/* the install scope is about plugins: My accounts is the person's own */}
        {scope && shown !== "accounts" && <div className="mt-3">{scope}</div>}
      </header>
      <div className="flex shrink-0 items-end gap-2 border-b border-hairline-weak px-4 sm:px-8" data-plugins-manage-bar>
        <div role="tablist" aria-label={t("connectApps.tabsAria")} className="flex min-w-0 flex-1 gap-5 overflow-x-auto" data-plugins-manage-tabs>
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`plugins-tab-${id}`}
              aria-selected={shown === id}
              aria-controls={`plugins-tabpanel-${id}`}
              data-plugins-tab={id}
              onClick={() => onTab(id)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-0.5 pb-2 pt-1 text-[13px] leading-[18px] transition-colors motion-reduce:transition-none",
                shown === id ? "border-ink font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink",
              )}
            >
              {t(TAB_KEY[id])}
            </button>
          ))}
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="ui-icon-button mb-1 disabled:opacity-50" aria-label={t("connectors.refreshTitle")} title={t("connectors.refreshTitle")}>
          <RefreshCw size={15} className={cn(refreshing && "animate-spin")} />
        </button>
      </div>
      {notices}
      <div
        role="tabpanel"
        id={`plugins-tabpanel-${shown}`}
        aria-labelledby={`plugins-tab-${shown}`}
        className={`${CATEGORY_MODAL.pane} ${CATEGORY_MODAL.list}`}
        data-plugins-list
        data-plugins-manage={shown}
      >
        {shown === "installed" && props.installed}
        {shown === "discover" && props.discover}
        {shown === "accounts" && props.accounts}
        {shown === "sources" && props.sources}
      </div>
    </div>
  );
}

function ConnectedButton({ summary, onOpen }: { summary: ReturnType<typeof connectedSummary>; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-plugins-connected
      onClick={onOpen}
      className="flex shrink-0 items-center gap-2 text-[13px] leading-[18px] text-ink hover:text-ink"
      aria-label={t("connectApps.connectedAria", { count: summary.count })}
    >
      {summary.icons.length > 0 && (
        <span className="flex -space-x-1.5" aria-hidden="true">
          {summary.icons.map((item) => (
            <span key={item.key} className="rounded-md ring-2 ring-app">
              <PluginIcon item={item} className="size-5 rounded-md" />
            </span>
          ))}
        </span>
      )}
      <span>{t("connectApps.connectedCount", { count: summary.count })}</span>
      <ChevronRight size={14} className="text-ink-secondary" aria-hidden="true" />
    </button>
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
          <PluginIcon item={item} className="size-11" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-[18px] text-ink">{item.name}</span>
            <span className="block truncate text-[12px] leading-[18px] text-ink-secondary" title={item.description}>{item.description}</span>
          </span>
        </button>
        {action ?? (item.installed ? <PluginStatusLabel status={item.status} /> : null)}
      </div>
      {below}
    </div>
  );
}
