// Connect Apps: one page (2026-10-27, the owner: one place per subject). The
// title, the install scope, then four tabs: Discover (the catalog, its
// search and Browse Bots; the view a person lands on, first since
// 2026-10-28), Installed, My accounts and Sources (with the organization's
// part for an admin). The "N connected" button is gone (2026-10-28): its
// count sits on Installed and My accounts, which list them with their logos. No sub-page repeats a tab: "Manage plugins and skills" and
// a section opened alone are gone, View all filters Discover in place.
// A page opened from a tab (a plugin's detail, a skill, "For which bots")
// opens inside that tab's panel, under the same title, scope and tabs, as a
// Settings sub-page does: a back row, then the page (2026-10-28).
// The shared row parts (pills, section titles, PluginRow) live here too.
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  CATEGORY_ORDER,
  MAIN_CATEGORIES,
  MORE_CATEGORIES,
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
/** Discover first (2026-10-28, the owner): it is where Connect Apps opens,
 * unless a link asks for another tab. */
export const CONNECT_APPS_TABS: readonly ConnectAppsTab[] = ["discover", "installed", "accounts", "sources"];

const TAB_KEY = {
  installed: "connectApps.manage.tab.installed",
  discover: "connectApps.manage.tab.discover",
  accounts: "connectApps.manage.tab.accounts",
  sources: "connectApps.manage.tab.sources",
} as const satisfies Record<ConnectAppsTab, LocaleKey>;

/** A tab's name, for the tab itself and the back row of a page opened from it. */
export function connectAppsTabLabel(tab: ConnectAppsTab): string {
  return t(TAB_KEY[tab]);
}

/** What the old "N connected" header counted, now on the tab that lists
 * them (2026-10-28, the owner: the button repeated Installed): the
 * person's own connected entries on Installed (the rows it shows), their
 * engine accounts' connected connectors on My accounts. Zero: no counter. */
export function connectedCounts(input: { entries: readonly { status: PluginItem["status"] }[]; engineConnected: number }): Partial<Record<ConnectAppsTab, number>> {
  // the rows Installed shows (one per thing, installedEntries), connected
  const own = input.entries.filter((entry) => entry.status === "connected").length;
  return {
    ...(own > 0 ? { installed: own } : {}),
    ...(input.engineConnected > 0 ? { accounts: input.engineConnected } : {}),
  };
}

export interface ConnectAppsViewProps {
  tab: ConnectAppsTab;
  onTab: (tab: ConnectAppsTab) => void;
  /** tabs with nothing to show are left out (Sources when nothing reads
   * or changes a source) */
  tabs?: readonly ConnectAppsTab[];
  /** connected things per tab (connectedCounts): a counter beside its name */
  counts?: Partial<Record<ConnectAppsTab, number>>;
  /** the install scope (everyone, or one bot) under the title, on every tab
   * (My accounts shows it turned off, with why): the title and the tabs
   * never move from one tab to another */
  scope?: ReactNode;
  /** a page opened from the open tab (a plugin's detail, a skill): shown in
   * the tab's panel, the title, scope and tabs kept above it */
  page?: ReactNode;
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
  const { tab, onTab, tabs = CONNECT_APPS_TABS, counts = {}, scope, page, notices, refreshing, onRefresh } = props;
  const shown = tabs.includes(tab) ? tab : tabs.includes("discover") ? "discover" : tabs[0] ?? "discover";
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-plugins-main={shown}>
      <header className={CATEGORY_MODAL.titleBar}>
        <h2 id="plugins-title" className={CATEGORY_MODAL.title}>{t("connectApps.title")}</h2>
        {/* on every tab, so nothing below it moves (My accounts turns it off) */}
        {scope && <div className="mt-3" data-plugins-scope-slot>{scope}</div>}
      </header>
      <div className="flex shrink-0 items-end gap-2 border-b border-hairline-weak px-4 sm:px-8" data-plugins-manage-bar>
        <div role="tablist" aria-label={t("connectApps.tabsAria")} className="flex min-w-0 flex-1 gap-5 overflow-x-auto" data-plugins-manage-tabs>
          {tabs.map((id) => {
            const count = counts[id] ?? 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`plugins-tab-${id}`}
                aria-selected={shown === id}
                // a page is open: its tab stays marked, a click goes back to the tab
                aria-current={page && shown === id ? "page" : undefined}
                aria-controls={`plugins-tabpanel-${id}`}
                aria-label={count > 0 ? t("connectApps.tabCountAria", { tab: connectAppsTabLabel(id), count }) : undefined}
                data-plugins-tab={id}
                onClick={() => onTab(id)}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 pb-2 pt-1 text-[13px] leading-[18px] transition-colors motion-reduce:transition-none",
                  shown === id ? "border-ink font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink",
                )}
              >
                <span data-plugins-tab-label>{connectAppsTabLabel(id)}</span>
                {count > 0 && (
                  <span data-plugins-tab-count={count} aria-hidden="true" className="min-w-[18px] rounded-full bg-hover px-1.5 text-center text-[11px] font-medium leading-[16px] text-ink-secondary tabular-nums">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
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
        tabIndex={-1}
        className={page ? "flex min-h-0 flex-1 flex-col outline-none" : `${CATEGORY_MODAL.pane} ${CATEGORY_MODAL.list} outline-none`}
        data-plugins-list={page ? undefined : ""}
        data-plugins-manage={shown}
        data-plugins-subpage={page ? "" : undefined}
      >
        {page ?? (
          <>
            {shown === "installed" && props.installed}
            {shown === "discover" && props.discover}
            {shown === "accounts" && props.accounts}
            {shown === "sources" && props.sources}
          </>
        )}
      </div>
    </div>
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
