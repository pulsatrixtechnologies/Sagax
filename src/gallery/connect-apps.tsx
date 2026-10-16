/** Isolated gallery for Playwright screenshots of Connect apps and Browse
 * bots in their window (the presentational views with sample rows, no
 * server). Not shipped in the app.
 * ?view=apps|apps-section|bots|bots-in-apps&skin=<id>&lang=<code> */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { X } from "lucide-react";
import { ConnectAppsView } from "../components/plugins/ConnectAppsView";
import { BotCatalogView } from "../components/bot-catalog/BotCatalogView";
import { CATEGORY_MODAL, cardActionClass } from "../components/category-modal";
import { ScopeToggle } from "../components/plugins/ScopeToggle";
import { catalogCategories, catalogSections, catalogTemplates } from "../lib/bot-catalog";
import type { PluginFilter, PluginItem } from "../lib/plugins-model";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const app = (id: string, name: string, description: string, category: PluginItem["category"], recommended = false): PluginItem => ({
  key: `featured:${id}`, kind: "featured", id, name, description, category, installed: false, status: "available", action: "connect", source: "catalog", recommended,
});

const ITEMS: PluginItem[] = [
  app("notion", "Notion", "Pages, bases de données et notes d'équipe", "productivity", true),
  app("linear", "Linear", "Billets, projets et cycles", "productivity", true),
  app("slack", "Slack", "Canaux, messages et fils", "communication", true),
  app("gmail", "Gmail", "Courriels et brouillons", "communication"),
  app("asana", "Asana", "Tâches et projets", "productivity"),
  app("trello", "Trello", "Tableaux et cartes", "productivity"),
  app("todoist", "Todoist", "Listes de tâches", "productivity"),
  app("airtable", "Airtable", "Bases et vues", "productivity"),
  app("clickup", "ClickUp", "Tâches, documents et objectifs", "productivity"),
  app("teams", "Microsoft Teams", "Conversations et réunions", "communication"),
  app("zoom", "Zoom", "Réunions et enregistrements", "communication"),
  app("figma", "Figma", "Fichiers de design et commentaires", "design"),
  app("github", "GitHub", "Dépôts, PR et billets", "code"),
];

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={CATEGORY_MODAL.backdrop}>
      <div role="dialog" aria-modal="true" className={CATEGORY_MODAL.frame}>
        <div className={CATEGORY_MODAL.content}>
          <button type="button" aria-label="Fermer" className={CATEGORY_MODAL.close}><X size={18} /></button>
          {children}
        </div>
      </div>
    </div>
  );
}

const CONNECT = <button type="button" className={cardActionClass()}>Connecter</button>;
const crumbToApps = [{ label: t("connectApps.title"), onSelect: () => {} }];

/** Connect apps' home, or (section) Productivity opened alone with View all. */
function Apps({ section }: { section?: boolean }) {
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [search, setSearch] = useState("");
  return (
    <Frame>
      <ConnectAppsView
        items={ITEMS}
        loading={false}
        search={search}
        onSearch={setSearch}
        filter={section ? "productivity" : filter}
        onFilter={setFilter}
        onOpenManage={() => {}}
        onBrowseBots={() => {}}
        onViewAll={() => {}}
        onOpenItem={() => {}}
        renderAction={() => CONNECT}
        subpage={section ? { title: t("connectApps.filter.productivity"), trail: crumbToApps, onBack: () => {} } : undefined}
        scope={<ScopeToggle scope="workspace" botName="Rocket" onScope={() => {}} />}
      />
    </Frame>
  );
}

const TEMPLATES = catalogTemplates([]);

/** Browse Bots alone, or (inApps) opened from Connect apps in its window. */
function Bots({ inApps }: { inApps?: boolean }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const sections = catalogSections({ organization: true, entries: [] }, TEMPLATES, { category, query, showArchived: false, app: null });
  return (
    <Frame>
      <BotCatalogView
        trail={inApps ? crumbToApps : undefined}
        organization
        categories={catalogCategories(sections.flatMap((entry) => entry.items))}
        category={category}
        onCategory={setCategory}
        query={query}
        onQuery={setQuery}
        sections={sections}
        expanded={null}
        onExpand={() => {}}
        showArchived={false}
        onShowArchived={() => {}}
        hasArchived={false}
        creatorAvatar={() => undefined}
        onOpen={() => {}}
        renderAction={() => <button type="button" className={cardActionClass()}>{t("botCatalog.action.use")}</button>}
        onTemplateTool={() => {}}
      />
    </Frame>
  );
}

const VIEWS: Record<string, () => React.ReactNode> = {
  apps: () => <Apps />,
  "apps-section": () => <Apps section />,
  bots: () => <Bots />,
  "bots-in-apps": () => <Bots inApps />,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="min-h-screen bg-app text-ink">{(VIEWS[params.get("view") ?? "apps"] ?? VIEWS.apps!)()}</div>
    </StoreProvider>
  </StrictMode>,
);
