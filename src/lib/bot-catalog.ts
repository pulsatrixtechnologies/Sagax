// Browse Bots (src/components/bot-catalog/): the catalogue's model. The
// server lists the viewer's bots, the ones shared with them and the ones
// published to the organisation (GET /api/bot-catalog); the templates are
// the built-in roles and the presets of New bot. Pure helpers, for tests.
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { BOT_ROLES, type BotRole } from "@/lib/bot-roles";
import type { BotPreset } from "@/lib/bot-presets";
import {
  DEFAULT_BOT_CATALOG_CATEGORIES,
  isDefaultCatalogCategory,
  type BotCatalogEntry,
  type BotCatalogLook,
  type BotCatalogResponse,
} from "../../shared/bot-catalog";
import { MASCOT_COLOR_NAMES, type MascotColorName } from "../../shared/mascot-colors";

export type { BotCatalogDetail, BotCatalogEntry, BotCatalogResponse } from "../../shared/bot-catalog";

/** A template: a built-in role or a preset of New bot. */
export interface CatalogTemplate {
  /** `role:<id>` or `preset:<id>` */
  id: string;
  name: string;
  title: string;
  description: string;
  look: BotCatalogLook;
  /** Built-in: Sagax; a preset: its publisher or package. */
  creator: string;
  category: string | null;
  soul: string;
  skills: Array<{ name: string; description: string }>;
  role?: BotRole;
  preset?: BotPreset;
}

export type CatalogItem =
  | { kind: "bot"; key: string; entry: BotCatalogEntry }
  | { kind: "template"; key: string; template: CatalogTemplate };

export type CatalogSectionId = "featured" | "shared" | "mine" | "organization" | "templates";

export interface CatalogSection {
  id: CatalogSectionId;
  items: CatalogItem[];
}

/** The built-in roles fall under the default categories. */
const ROLE_CATEGORY: Record<string, string> = {
  assistant: "personal",
  inbox: "operations",
  research: "product",
  coder: "engineering",
  community: "marketing",
  ops: "operations",
};

function roleColor(index: number): MascotColorName {
  const palette: MascotColorName[] = ["blue", "purple", "teal", "orange", "pink", "green"].filter((name): name is MascotColorName =>
    (MASCOT_COLOR_NAMES as readonly string[]).includes(name));
  return palette[index % palette.length] ?? MASCOT_COLOR_NAMES[0];
}

/** Built-in roles, then New bot's presets (organisation and imported). */
export function catalogTemplates(presets: readonly BotPreset[], roles: readonly BotRole[] = BOT_ROLES): CatalogTemplate[] {
  const fromPresets = presets.map((preset): CatalogTemplate => ({
    id: `preset:${preset.id}`,
    name: preset.bot.name ?? preset.name,
    title: preset.bot.title ?? "",
    description: preset.bot.description ?? preset.description ?? "",
    look: {
      color: preset.bot.appearance?.color ?? roleColor(0),
      ...(preset.bot.appearance?.mascotExpression ? { mascotExpression: preset.bot.appearance.mascotExpression } : {}),
    },
    creator: preset.publisherName ?? preset.packageName,
    category: null,
    soul: preset.bot.soul ?? "",
    skills: preset.skills,
    preset,
  }));
  const builtIn = roles.map((role, index): CatalogTemplate => ({
    id: `role:${role.id}`,
    name: role.name,
    title: role.title,
    description: role.description,
    look: { color: roleColor(index) },
    creator: t("botCatalog.creator.builtIn"),
    category: ROLE_CATEGORY[role.id] ?? null,
    soul: role.soul,
    skills: [],
    role,
  }));
  return [...fromPresets, ...builtIn];
}

const CATEGORY_KEY: Record<string, LocaleKey> = {
  engineering: "botCatalog.category.engineering",
  sales: "botCatalog.category.sales",
  marketing: "botCatalog.category.marketing",
  design: "botCatalog.category.design",
  personal: "botCatalog.category.personal",
  people: "botCatalog.category.people",
  product: "botCatalog.category.product",
  operations: "botCatalog.category.operations",
};

/** A chip's label: All, a default category translated, or the publisher's text. */
export function catalogCategoryLabel(category: string): string {
  if (category === "all") return t("botCatalog.category.all");
  return isDefaultCatalogCategory(category) ? t(CATEGORY_KEY[category]!) : category;
}

export function itemCategory(item: CatalogItem): string | null {
  return item.kind === "bot" ? item.entry.catalog?.category ?? null : item.template.category;
}

export function itemName(item: CatalogItem): string {
  return item.kind === "bot" ? item.entry.name : item.template.name;
}

export function itemCreator(item: CatalogItem): string {
  return item.kind === "bot" ? item.entry.owner.name : item.template.creator;
}

export function itemDescription(item: CatalogItem): string {
  const value = item.kind === "bot" ? item.entry.description || item.entry.title : item.template.description || item.template.title;
  return value.trim();
}

/** The chips: All, the default categories, then the ones publishers typed. */
export function catalogCategories(items: readonly CatalogItem[]): string[] {
  const custom = new Set<string>();
  for (const item of items) {
    const category = itemCategory(item);
    if (category && !isDefaultCatalogCategory(category)) custom.add(category);
  }
  return ["all", ...DEFAULT_BOT_CATALOG_CATEGORIES, ...[...custom].sort((a, b) => a.localeCompare(b))];
}

/** Search by bot name, role or creator; case and accents ignored. */
export function matchesCatalogQuery(item: CatalogItem, query: string): boolean {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const needle = fold(query.trim());
  if (!needle) return true;
  const title = item.kind === "bot" ? item.entry.title : item.template.title;
  return fold(`${itemName(item)} ${title} ${itemCreator(item)}`).includes(needle);
}

export interface CatalogFilter {
  category: string;
  query: string;
  showArchived: boolean;
}

/** The sections of the home view, in order: Featured, Shared with me, My
 * Bots, Organization, Templates. A solo server has no shared or
 * organisation section (and the server lists only the person's own bots). */
export function catalogSections(data: Pick<BotCatalogResponse, "organization" | "entries">, templates: readonly CatalogTemplate[], filter: CatalogFilter): CatalogSection[] {
  const keep = (item: CatalogItem) =>
    (filter.category === "all" || itemCategory(item) === filter.category) && matchesCatalogQuery(item, filter.query);
  const bot = (entry: BotCatalogEntry): CatalogItem => ({ kind: "bot", key: `bot:${entry.id}`, entry });
  const published = (entry: BotCatalogEntry) => entry.catalog?.published === true && !entry.archived;
  const sections: CatalogSection[] = [];
  if (data.organization) {
    sections.push({ id: "featured", items: data.entries.filter((entry) => published(entry) && entry.catalog?.featured).map(bot).filter(keep) });
    sections.push({ id: "shared", items: data.entries.filter((entry) => entry.source === "shared").map(bot).filter(keep) });
  }
  sections.push({ id: "mine", items: data.entries.filter((entry) => entry.source === "mine" && (filter.showArchived || !entry.archived)).map(bot).filter(keep) });
  if (data.organization) sections.push({ id: "organization", items: data.entries.filter(published).map(bot).filter(keep) });
  sections.push({ id: "templates", items: templates.map((template): CatalogItem => ({ kind: "template", key: template.id, template })).filter(keep) });
  return sections;
}

export const SECTION_LABEL: Record<CatalogSectionId, LocaleKey> = {
  featured: "botCatalog.section.featured",
  shared: "botCatalog.section.shared",
  mine: "botCatalog.section.mine",
  organization: "botCatalog.section.organization",
  templates: "botCatalog.section.templates",
};

export type CatalogAction =
  | "open"
  | "addToSidebar"
  | "removeFromSidebar"
  | "import"
  | "publish"
  | "unpublish"
  | "feature"
  | "unfeature";

export interface CatalogActionContext {
  organization: boolean;
  admin: boolean;
  canCreate: boolean;
  /** 2026-10-09: a profile with bots.catalogFeature features bots too. */
  feature?: boolean;
  /** Whether a shared bot shows in the viewer's sidebar (not hidden there). */
  inSidebar: (botId: string) => boolean;
}

/** What the viewer may do with an item, the primary action first. Shared:
 * show or hide it in the sidebar, then open and copy it. Organisation and
 * templates: Import Bot. Their own: Open, then publish or withdraw. An
 * admin also features and withdraws any published bot. */
export function catalogActions(item: CatalogItem, ctx: CatalogActionContext): CatalogAction[] {
  if (item.kind === "template") return ctx.canCreate ? ["import"] : [];
  const { entry } = item;
  const out: CatalogAction[] = [];
  const published = entry.catalog?.published === true;
  if (entry.source === "shared") {
    out.push(ctx.inSidebar(entry.id) ? "removeFromSidebar" : "addToSidebar");
    out.push("open");
    if (ctx.canCreate) out.push("import");
  } else if (entry.source === "organization") {
    if (ctx.canCreate) out.push("import");
  } else {
    if (!entry.archived) out.push("open");
    if (ctx.organization && !entry.archived) out.push(published ? "unpublish" : "publish");
  }
  if (ctx.organization && (ctx.admin || ctx.feature === true) && published && !entry.archived) {
    out.push(entry.catalog?.featured ? "unfeature" : "feature");
  }
  if (ctx.organization && ctx.admin && published && !entry.archived && entry.source !== "mine") out.push("unpublish");
  return out;
}

export const ACTION_LABEL: Record<CatalogAction, LocaleKey> = {
  open: "botCatalog.action.open",
  addToSidebar: "botCatalog.action.addToSidebar",
  removeFromSidebar: "botCatalog.action.removeFromSidebar",
  import: "botCatalog.action.import",
  publish: "botCatalog.action.publish",
  unpublish: "botCatalog.action.unpublish",
  feature: "botCatalog.action.feature",
  unfeature: "botCatalog.action.unfeature",
};

/** The card's button: Add for what joins the viewer's bots or sidebar. */
export function cardActionLabel(action: CatalogAction): string {
  if (action === "import" || action === "addToSidebar") return t("botCatalog.action.add");
  if (action === "removeFromSidebar") return t("botCatalog.action.remove");
  return t(ACTION_LABEL[action]);
}
