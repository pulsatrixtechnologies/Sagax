// Connect apps > Discover, the view a person lands on (2026-10-27: the
// former home page and Manage's Discover made one): the catalog of apps,
// plugins and skills that can still be added, the category pills (no Browse
// Bots button since 2026-10-29: the Bots tab is its place), then the sections in
// two columns. View all filters this view in place. The search is Connect
// Apps' one search above the tabs (2026-10-29: one option, one place). The apps a conversation needs (its Connect
// apps pill) come first. What is installed lives in Installed; the engines'
// connectors in Installed (Providers).
import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { mainSections, type PluginFilter, type PluginItem, type PluginTypeFilter } from "@/lib/plugins-model";
import { CATEGORY_MODAL, categoryChipClass } from "../category-modal";
import { PluginRow, categoryPills, filterLabel, moreCategoryPills, sectionTitle } from "./ConnectAppsView";

const PAGE = 60;

export interface DiscoverViewProps {
  /** rows not installed yet (discoverItems) */
  items: PluginItem[];
  loading?: boolean;
  filter: PluginFilter;
  onFilter: (filter: PluginFilter) => void;
  type: PluginTypeFilter;
  onType: (type: PluginTypeFilter) => void;
  sourceLabel: (source: string) => string;
  /** marketplaces: a section of their own */
  extraSources?: string[];
  /** apps a conversation needs (its Connect apps pill): shown first */
  focus?: readonly string[];
  onOpenItem: (item: PluginItem) => void;
  renderAction: (item: PluginItem) => ReactNode;
  renderBelow?: (item: PluginItem) => ReactNode;
}

export function DiscoverView({ items, loading = false, filter, onFilter, type, onType, sourceLabel, extraSources = [], focus, onOpenItem, renderAction, renderBelow }: DiscoverViewProps) {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [filter, type]);
  const sections = mainSections(items, "", filter, type, extraSources, focus);
  const single = filter !== "all" || type !== "any";
  const pills = [...categoryPills(items, filter), ...moreCategoryPills(items, filter)];
  return (
    <div data-plugins-discover>
      {pills.length > 1 && (
        <div className={CATEGORY_MODAL.chips} role="toolbar" aria-label={t("connectApps.filtersAria")} data-plugins-chips>
          {pills.map((chip) => (
            <button key={chip} type="button" aria-pressed={filter === chip && type === "any"} data-plugins-chip={chip}
              onClick={() => { onFilter(chip); onType("any"); }} className={categoryChipClass(filter === chip && type === "any")}>
              {filterLabel(chip, sourceLabel)}
            </button>
          ))}
          {type !== "any" && (
            <button type="button" aria-pressed data-plugins-type={type} onClick={() => onType("any")} className={categoryChipClass(true)}>
              {filterLabel(type, sourceLabel)} ×
            </button>
          )}
        </div>
      )}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-ink-secondary">
          <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
        </div>
      ) : sections.every((section) => section.items.length === 0) ? (
        <div className="mt-6 rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary" data-plugins-empty>
          {t("connectApps.discover.empty")}
        </div>
      ) : sections.filter((section) => section.items.length > 0).map((section) => {
        const shown = single ? section.items.slice(0, limit) : section.items;
        return (
          <section key={section.id} data-plugins-section={section.id} className="mt-5">
            <div className={CATEGORY_MODAL.sectionHead}>
              <h3 className={CATEGORY_MODAL.sectionTitle}>{sectionTitle(section, sourceLabel)}</h3>
              {!single && section.filter && section.total > section.items.length && (
                <button type="button" data-plugins-view-all={section.id} className={CATEGORY_MODAL.sectionLink} onClick={() => {
                  const target = section.filter!;
                  if ("filter" in target) onFilter(target.filter);
                  else onType(target.type);
                }}>
                  {t("connectApps.viewAll")}
                </button>
              )}
            </div>
            <div className={CATEGORY_MODAL.grid}>
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
      })}
    </div>
  );
}
