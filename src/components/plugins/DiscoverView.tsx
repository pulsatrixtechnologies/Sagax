// Manage > Discover: the catalog of apps, plugins and skills that can still
// be added, with the search and the category pills of Connect apps. What is
// installed lives in Installed; the engines' connectors in My accounts.
import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { t } from "@/lib/i18n";
import { mainSections, type PluginFilter, type PluginItem, type PluginTypeFilter } from "@/lib/plugins-model";
import { CATEGORY_MODAL, categoryChipClass } from "../category-modal";
import { PluginRow, categoryPills, filterLabel, moreCategoryPills, sectionTitle } from "./ConnectAppsView";

const PAGE = 60;

export interface DiscoverViewProps {
  /** rows not installed yet (discoverItems) */
  items: PluginItem[];
  sourceLabel: (source: string) => string;
  /** marketplaces: a section of their own */
  extraSources?: string[];
  onOpenItem: (item: PluginItem) => void;
  renderAction: (item: PluginItem) => ReactNode;
  renderBelow?: (item: PluginItem) => ReactNode;
}

export function DiscoverView({ items, sourceLabel, extraSources = [], onOpenItem, renderAction, renderBelow }: DiscoverViewProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [type, setType] = useState<PluginTypeFilter>("any");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [filter, type, search]);
  const sections = mainSections(items, search, filter, type, extraSources);
  const single = search.trim() !== "" || filter !== "all" || type !== "any";
  const pills = [...categoryPills(items, filter), ...moreCategoryPills(items, filter)];
  return (
    <div data-plugins-discover>
      <label className={CATEGORY_MODAL.search}>
        <Search size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("connectApps.searchPlaceholder")}
          aria-label={t("connectApps.searchPlaceholder")}
          data-plugins-discover-search
          className={CATEGORY_MODAL.searchInput}
        />
      </label>
      {pills.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="toolbar" aria-label={t("connectApps.filtersAria")}>
          {pills.map((chip) => (
            <button key={chip} type="button" aria-pressed={filter === chip && type === "any"} data-plugins-chip={chip}
              onClick={() => { setFilter(chip); setType("any"); }} className={categoryChipClass(filter === chip && type === "any")}>
              {filterLabel(chip, sourceLabel)}
            </button>
          ))}
        </div>
      )}
      {sections.every((section) => section.items.length === 0) ? (
        <div className="mt-6 rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary" data-plugins-empty>
          {search.trim() ? t("connectors.tryDifferentSearch") : t("connectApps.discover.empty")}
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
                  if ("filter" in target) setFilter(target.filter);
                  else setType(target.type);
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
      {type !== "any" && (
        <button type="button" className="mt-3 text-[12.5px] text-ink-secondary hover:text-ink hover:underline" onClick={() => setType("any")}>
          {t("connectApps.filter.all")}
        </button>
      )}
    </div>
  );
}
