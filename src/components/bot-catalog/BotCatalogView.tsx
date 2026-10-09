// Browse Bots, the home pane: the title, the category chips, the search,
// the Featured row, then one section per source (Shared with me, My Bots,
// Organization, Templates) in two columns, each with View all. Templates
// also carries the old Templates library's tools (Import, From a folder,
// Share a team) and, in its own view, chips for the apps templates use.
// Purely presentational: BotCatalogModal.tsx owns the data and the actions.
import type { ReactNode } from "react";
import { ChevronLeft, ExternalLink, Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { personInitials } from "@/lib/people-dm";
import {
  catalogCategoryLabel,
  itemCreator,
  itemDescription,
  itemName,
  SECTION_LABEL,
  type CatalogItem,
  type CatalogSection,
  type CatalogSectionId,
} from "@/lib/bot-catalog";
import { MASCOT_COLOR_HEX } from "../../../shared/mascot-colors";
import type { BotCatalogLook } from "../../../shared/bot-catalog";
import { BotAvatar } from "../Avatar";
import { PersonAvatar } from "../MessageAuthor";
import { CATEGORY_MODAL } from "../category-modal";
import { TemplateAppChips } from "./BotCatalogDetailView";
import { TEMPLATE_TOOLS, TEMPLATE_TOOL_LABEL, type TemplateTool } from "./TemplateTools";

/** Rows a section shows on the home view before View all. */
export const SECTION_PREVIEW = 6;

/** The bot's colour for its name, unless it would not read on the page. */
export function nameColor(look: BotCatalogLook): string | undefined {
  if (look.color === "white" || look.color === "black" || look.color === "grey") return undefined;
  return MASCOT_COLOR_HEX[look.color];
}

export function itemLook(item: CatalogItem): BotCatalogLook {
  return item.kind === "bot" ? item.entry.look : item.template.look;
}

/** The mascot, with the creator's avatar as a small badge (a template has none). */
export function CatalogMascot({ item, size, creatorAvatar }: { item: CatalogItem; size: number; creatorAvatar?: string }) {
  const look = itemLook(item);
  const badge = Math.max(16, Math.round(size * 0.38));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} data-catalog-mascot="">
      <BotAvatar bot={{ name: itemName(item), ...look }} state="idle" size={size} animated={false} />
      {item.kind === "bot" && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-app" data-catalog-creator-badge="">
          <PersonAvatar avatarUrl={creatorAvatar} initials={personInitials(item.entry.owner.name || "?")} size={badge} />
        </span>
      )}
    </span>
  );
}

function Badges({ item }: { item: CatalogItem }) {
  const badges: string[] = [];
  if (item.kind === "template") badges.push(t("botCatalog.badge.template"));
  else {
    if (item.entry.archived) badges.push(t("botCatalog.badge.archived"));
    if (item.entry.catalog?.featured) badges.push(t("botCatalog.badge.featured"));
    else if (item.entry.catalog?.published && item.entry.source === "mine") badges.push(t("botCatalog.badge.published"));
  }
  if (!badges.length) return null;
  return (
    <>
      {badges.map((label) => (
        <span key={label} className="shrink-0 rounded-full bg-ink/[0.06] px-1.5 py-px text-[10.5px] font-medium leading-[15px] text-ink-secondary">{label}</span>
      ))}
    </>
  );
}

export interface CatalogCardProps {
  item: CatalogItem;
  creatorAvatar?: string;
  onOpen: (item: CatalogItem) => void;
  /** The card's button (Add, Remove, Open), or nothing. */
  action?: ReactNode;
}

/** A row: mascot, "<Name> by <creator>", one line, and its button. */
export function CatalogRow({ item, creatorAvatar, onOpen, action }: CatalogCardProps) {
  const name = itemName(item);
  return (
    <div data-catalog-row={item.key} className="flex items-center gap-3 rounded-2xl p-2.5 hover:bg-ink/5">
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={t("botCatalog.openDetail", { name })}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <CatalogMascot item={item} size={44} creatorAvatar={creatorAvatar} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px]">
            <span className="truncate font-semibold" style={{ color: nameColor(itemLook(item)) }}>{name}</span>
            <span className="shrink-0 truncate text-ink-tertiary">{t("botCatalog.by", { name: itemCreator(item) })}</span>
            <Badges item={item} />
          </span>
          <span className="block truncate text-[12px] leading-[18px] text-ink-secondary" title={itemDescription(item)}>{itemDescription(item)}</span>
          {item.kind === "template" && item.template.apps.length > 0 && <span className="mt-0.5 block"><TemplateAppChips apps={item.template.apps} /></span>}
        </span>
      </button>
      {action}
    </div>
  );
}

/** A Featured card: the mascot large, the name in the bot's colour, by whom. */
export function FeaturedCard({ item, creatorAvatar, onOpen }: CatalogCardProps) {
  const name = itemName(item);
  return (
    <button
      type="button"
      data-catalog-featured={item.key}
      onClick={() => onOpen(item)}
      aria-label={t("botCatalog.openDetail", { name })}
      className="flex w-[168px] shrink-0 flex-col items-center gap-2 rounded-2xl border border-hairline-weak bg-panel px-3 pb-3.5 pt-5 text-center hover:bg-hover"
    >
      <CatalogMascot item={item} size={72} creatorAvatar={creatorAvatar} />
      <span className="mt-1 w-full truncate text-[14px] font-semibold leading-5" style={{ color: nameColor(itemLook(item)) }}>{name}</span>
      <span className="w-full truncate text-[12px] leading-4 text-ink-tertiary">{t("botCatalog.by", { name: itemCreator(item) })}</span>
    </button>
  );
}

export interface BotCatalogViewProps {
  organization: boolean;
  categories: string[];
  category: string;
  onCategory: (category: string) => void;
  query: string;
  onQuery: (query: string) => void;
  sections: CatalogSection[];
  /** View all: one section alone, every row. Null: the home view. */
  expanded: CatalogSectionId | null;
  onExpand: (section: CatalogSectionId | null) => void;
  showArchived: boolean;
  onShowArchived: (show: boolean) => void;
  /** Whether the viewer has archived bots (the My Bots filter shows then). */
  hasArchived: boolean;
  creatorAvatar: (item: CatalogItem) => string | undefined;
  onOpen: (item: CatalogItem) => void;
  renderAction: (item: CatalogItem) => ReactNode;
  /** A notice above the list (feedback, the read-only note, an error). */
  notice?: ReactNode;
  loading?: boolean;
  /** Templates' tools (Import, From a folder, Share a team); absent: none
   * (a remote client, a viewer who may not create bots). */
  onTemplateTool?: (tool: TemplateTool) => void;
  /** The apps templates use, chips in the Templates view. */
  templateApps?: string[];
  templateApp?: string | null;
  onTemplateApp?: (app: string | null) => void;
  /** The community templates' repository, linked from the Templates view. */
  repositoryUrl?: string;
  onOpenRepository?: (url: string) => void;
}

/** Templates' tools, beside the section's title. */
function TemplateToolButtons({ onTool }: { onTool: (tool: TemplateTool) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-1" data-catalog-template-tools="">
      {TEMPLATE_TOOLS.map((tool) => (
        <button
          key={tool}
          type="button"
          data-catalog-template-tool={tool}
          onClick={() => onTool(tool)}
          className="rounded-full border border-border px-2.5 py-0.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink"
        >
          {t(TEMPLATE_TOOL_LABEL[tool])}
        </button>
      ))}
    </span>
  );
}

export function BotCatalogView(props: BotCatalogViewProps) {
  const { organization, categories, category, onCategory, query, onQuery, sections, expanded, onExpand, creatorAvatar, onOpen, renderAction } = props;
  const searching = query.trim().length > 0 || category !== "all";
  const featured = sections.find((section) => section.id === "featured");
  const listed = sections.filter((section) => section.id !== "featured" && (!expanded || section.id === expanded));
  const nothing = sections.every((section) => section.items.length === 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-bot-catalog-home="">
      <header className={CATEGORY_MODAL.titleBar}>
        {expanded ? (
          <button type="button" onClick={() => onExpand(null)} className="-ml-1.5 mb-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink" data-catalog-back="">
            <ChevronLeft size={14} aria-hidden="true" />{t("botCatalog.back")}
          </button>
        ) : null}
        <h2 id="bot-catalog-title" className={CATEGORY_MODAL.title}>
          {expanded ? t(SECTION_LABEL[expanded]) : t("botCatalog.title")}
        </h2>
        {!expanded && (
          <p className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">{organization ? t("botCatalog.subtitle") : t("botCatalog.subtitleSolo")}</p>
        )}
      </header>

      <div className="shrink-0 px-4 sm:px-8">
        <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t("botCatalog.categoriesAria")} data-catalog-chips="">
          {categories.map((chip) => (
            <button
              key={chip}
              type="button"
              aria-pressed={category === chip}
              data-catalog-chip={chip}
              onClick={() => onCategory(chip)}
              className={cn(
                "h-7 rounded-full border px-3 text-[12.5px] transition-colors motion-reduce:transition-none",
                category === chip ? "border-transparent bg-accent text-accent-ink" : "border-border text-ink-secondary hover:bg-hover hover:text-ink",
              )}
            >
              {catalogCategoryLabel(chip)}
            </button>
          ))}
        </div>
        <label className="mt-3 flex min-w-0 items-center gap-2.5 rounded-[14px] border border-transparent bg-hover px-4 py-2.5 focus-within:border-border-strong">
          <Search size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t("botCatalog.searchPlaceholder")}
            aria-label={t("botCatalog.searchPlaceholder")}
            data-catalog-search=""
            className="min-w-0 flex-1 bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </label>
        {expanded === "templates" && props.templateApps && props.templateApps.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t("botCatalog.template.appsAria")} data-catalog-app-chips="">
            <span className="mr-1 text-[12px] text-ink-tertiary">{t("botCatalog.template.uses")}</span>
            {[null, ...props.templateApps].map((app) => (
              <button
                key={app ?? "any"}
                type="button"
                aria-pressed={(props.templateApp ?? null) === app}
                data-catalog-app-chip={app ?? "any"}
                onClick={() => props.onTemplateApp?.(app)}
                className={cn(
                  "h-6 rounded-full border px-2.5 text-[12px] transition-colors motion-reduce:transition-none",
                  (props.templateApp ?? null) === app ? "border-transparent bg-accent text-accent-ink" : "border-border text-ink-secondary hover:bg-hover hover:text-ink",
                )}
              >
                {app ?? t("botCatalog.template.anyApp")}
              </button>
            ))}
          </div>
        )}
      </div>

      {props.notice}

      <div className={cn(CATEGORY_MODAL.pane, "min-h-0 px-4 pb-7 pt-4 sm:px-8")} data-catalog-list="">
        {props.loading && (
          <p className="pb-3 text-[12.5px] text-ink-secondary" role="status" data-catalog-loading="">{t("botCatalog.loading")}</p>
        )}
        {searching && nothing ? (
          <p className="py-24 text-center text-[13px] text-ink-secondary" data-catalog-no-match="">{t("botCatalog.empty.search")}</p>
        ) : (
          <>
            {!expanded && featured && featured.items.length > 0 && (
              <section data-catalog-section="featured" className="mb-6">
                <h3 className="mb-2 text-[13px] font-semibold text-ink">{t(SECTION_LABEL.featured)}</h3>
                <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                  {featured.items.map((item) => <FeaturedCard key={item.key} item={item} creatorAvatar={creatorAvatar(item)} onOpen={onOpen} />)}
                </div>
              </section>
            )}
            {listed.map((section) => {
              if (searching && section.items.length === 0) return null;
              const shown = expanded ? section.items : section.items.slice(0, SECTION_PREVIEW);
              return (
                <section key={section.id} data-catalog-section={section.id} className="mb-5">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    {!expanded && <h3 className="text-[13px] font-semibold text-ink">{t(SECTION_LABEL[section.id])}</h3>}
                    <div className="ml-auto flex items-center gap-3">
                      {section.id === "templates" && props.onTemplateTool && <TemplateToolButtons onTool={props.onTemplateTool} />}
                      {section.id === "templates" && expanded === "templates" && props.repositoryUrl && (
                        <button type="button" onClick={() => props.onOpenRepository?.(props.repositoryUrl!)} data-catalog-repository="" className="flex items-center gap-1 text-[12px] text-ink-secondary hover:text-ink">
                          {t("botCatalog.template.repository")}<ExternalLink size={11} aria-hidden="true" />
                        </button>
                      )}
                      {section.id === "mine" && props.hasArchived && (
                        <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
                          <input type="checkbox" checked={props.showArchived} onChange={(event) => props.onShowArchived(event.target.checked)} data-catalog-show-archived="" />
                          {t("botCatalog.showArchived")}
                        </label>
                      )}
                      {!expanded && (section.items.length > SECTION_PREVIEW || (section.id === "templates" && section.items.length > 0 && (props.templateApps?.length ?? 0) > 0)) && (
                        <button type="button" onClick={() => onExpand(section.id)} data-catalog-view-all={section.id} className="text-[12px] text-ink-secondary hover:text-ink">
                          {t("botCatalog.viewAll")}
                        </button>
                      )}
                    </div>
                  </div>
                  {shown.length === 0 ? (
                    <p className="px-2.5 py-2 text-[12.5px] text-ink-tertiary">{t("botCatalog.empty.section")}</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-x-2 gap-y-0.5 md:grid-cols-2">
                      {shown.map((item) => (
                        <CatalogRow key={item.key} item={item} creatorAvatar={creatorAvatar(item)} onOpen={onOpen} action={renderAction(item)} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
