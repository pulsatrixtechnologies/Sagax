// Browse Bots: the catalogue's sections, search and actions (src/lib/bot-catalog.ts),
// the home pane, the detail pane and the modal's shell, drawn to markup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, botCatalogOpen: true }, dispatch: fixture.dispatch }) };
});

import {
  catalogActions,
  catalogCategories,
  catalogSections,
  catalogTemplates,
  matchesCatalogQuery,
  type BotCatalogEntry,
  type CatalogActionContext,
  type CatalogItem,
} from "@/lib/bot-catalog";
import { BOT_ROLES } from "@/lib/bot-roles";
import { orgSectionMenuItems } from "../OrgSectionMenu";
import { BotCatalogView, SECTION_PREVIEW, type BotCatalogViewProps } from "./BotCatalogView";
import { BotCatalogDetailView, templateDetail } from "./BotCatalogDetailView";
import { BotCatalogModal } from "./BotCatalogModal";

const ME = "pr_00000000-0000-4000-8000-00000000000a";
const BEN = "pr_00000000-0000-4000-8000-00000000000b";

function entry(id: string, extra: Partial<BotCatalogEntry> = {}): BotCatalogEntry {
  return {
    id, name: id, title: "", description: `${id} does things`, look: { color: "blue" }, owner: { principalId: ME, name: "Me" },
    source: "mine", archived: false, primary: false, ...extra,
  };
}

const ben = { principalId: BEN, name: "Ben Tremblay" };
const entries: BotCatalogEntry[] = [
  entry("Notes"),
  entry("Old", { archived: true }),
  entry("Closer", { owner: ben, source: "shared" }),
  entry("Pixel", { owner: ben, source: "organization", catalog: { published: true, category: "design", featured: true } }),
  entry("Ledger", { owner: ben, source: "organization", catalog: { published: true, category: "Field ops" } }),
  entry("Mine published", { catalog: { published: true, category: "sales" } }),
];
const templates = catalogTemplates([]);
const filter = { category: "all", query: "", showArchived: false };
const ids = (items: CatalogItem[]) => items.map((item) => item.kind === "bot" ? item.entry.id : item.template.id);

describe("catalogue sections", () => {
  it("are Featured, Shared with me, My Bots, Organization and Templates on an organization server", () => {
    const sections = catalogSections({ organization: true, entries }, templates, filter);
    expect(sections.map((section) => section.id)).toEqual(["featured", "shared", "mine", "organization", "templates"]);
    const by = Object.fromEntries(sections.map((section) => [section.id, ids(section.items)]));
    expect(by.featured).toEqual(["Pixel"]);
    expect(by.shared).toEqual(["Closer"]);
    expect(by.mine).toEqual(["Notes", "Mine published"]);
    expect(by.organization).toEqual(["Pixel", "Ledger", "Mine published"]);
    expect(by.templates).toEqual(BOT_ROLES.map((role) => `role:${role.id}`));
  });

  it("are My Bots and Templates only on a solo server", () => {
    const sections = catalogSections({ organization: false, entries: [entry("Notes")] }, templates, filter);
    expect(sections.map((section) => section.id)).toEqual(["mine", "templates"]);
  });

  it("show archived bots in My Bots only with the filter on", () => {
    const sections = catalogSections({ organization: true, entries }, templates, { ...filter, showArchived: true });
    expect(ids(sections.find((section) => section.id === "mine")!.items)).toEqual(["Notes", "Old", "Mine published"]);
  });

  it("filter by category chip, the publisher's own text included", () => {
    const design = catalogSections({ organization: true, entries }, templates, { ...filter, category: "design" });
    expect(design.flatMap((section) => ids(section.items))).toEqual(["Pixel", "Pixel"]);
    const custom = catalogSections({ organization: true, entries }, templates, { ...filter, category: "Field ops" });
    expect(custom.flatMap((section) => ids(section.items))).toEqual(["Ledger"]);
    const engineering = catalogSections({ organization: true, entries }, templates, { ...filter, category: "engineering" });
    expect(engineering.flatMap((section) => ids(section.items))).toEqual(["role:coder"]);
  });

  it("search by bot name or creator, case and accents ignored", () => {
    const byCreator = catalogSections({ organization: true, entries }, templates, { ...filter, query: "tremblay" });
    expect([...new Set(byCreator.flatMap((section) => ids(section.items)))]).toEqual(["Pixel", "Closer", "Ledger"]);
    const pixel: CatalogItem = { kind: "bot", key: "bot:Pixel", entry: entries[3]! };
    expect(matchesCatalogQuery(pixel, "PÌXEL")).toBe(true);
    expect(matchesCatalogQuery(pixel, "nobody")).toBe(false);
  });

  it("offer the default chips first, then the categories publishers typed", () => {
    const items = catalogSections({ organization: true, entries }, templates, filter).flatMap((section) => section.items);
    expect(catalogCategories(items)).toEqual(["all", "engineering", "sales", "marketing", "design", "personal", "people", "product", "operations", "Field ops"]);
  });
});

describe("catalogue actions", () => {
  const member: CatalogActionContext = { organization: true, admin: false, canCreate: true, inSidebar: (id) => id !== "Hidden" };
  const admin: CatalogActionContext = { ...member, admin: true };
  const bot = (value: BotCatalogEntry): CatalogItem => ({ kind: "bot", key: `bot:${value.id}`, entry: value });

  it("show or hide a shared bot in the sidebar first, then open and copy it", () => {
    expect(catalogActions(bot(entries[2]!), member)).toEqual(["removeFromSidebar", "open", "import"]);
    expect(catalogActions(bot(entry("Hidden", { source: "shared", owner: ben })), member)).toEqual(["addToSidebar", "open", "import"]);
  });

  it("import an organization bot or a template, unless the viewer may not create bots", () => {
    expect(catalogActions(bot(entries[4]!), member)).toEqual(["import"]);
    expect(catalogActions({ kind: "template", key: "role:coder", template: templates[3]! }, member)).toEqual(["import"]);
    expect(catalogActions(bot(entries[4]!), { ...member, canCreate: false })).toEqual([]);
  });

  it("open and publish or withdraw one's own bot; only on an organization server", () => {
    expect(catalogActions(bot(entries[0]!), member)).toEqual(["open", "publish"]);
    expect(catalogActions(bot(entries[5]!), member)).toEqual(["open", "unpublish"]);
    expect(catalogActions(bot(entries[1]!), member)).toEqual([]);
    expect(catalogActions(bot(entries[0]!), { ...member, organization: false })).toEqual(["open"]);
  });

  it("let an admin feature and withdraw any published bot", () => {
    expect(catalogActions(bot(entries[4]!), admin)).toEqual(["import", "feature", "unpublish"]);
    expect(catalogActions(bot(entries[3]!), admin)).toEqual(["import", "unfeature", "unpublish"]);
    expect(catalogActions(bot(entries[5]!), admin)).toEqual(["open", "unpublish", "feature"]);
  });
});

function view(props: Partial<BotCatalogViewProps> = {}): string {
  const sections = props.sections ?? catalogSections({ organization: true, entries }, templates, filter);
  return renderToStaticMarkup(createElement(BotCatalogView, {
    organization: true,
    categories: catalogCategories(sections.flatMap((section) => section.items)),
    category: "all",
    onCategory: () => {},
    query: "",
    onQuery: () => {},
    sections,
    expanded: null,
    onExpand: () => {},
    showArchived: false,
    onShowArchived: () => {},
    hasArchived: true,
    creatorAvatar: () => undefined,
    onOpen: () => {},
    renderAction: (item) => createElement("button", { "data-test-action": item.key }, "Add"),
    ...props,
  }));
}

describe("the home pane", () => {
  it("shows the title, the chips, the search, the Featured row and one section per source", () => {
    const html = view();
    expect(html).toContain("Browse Bots");
    expect(html).toContain('placeholder="Search by creator or bot name"');
    for (const label of ["All", "Engineering", "Sales", "Recruiting &amp; People", "Operations", "Field ops"]) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain('data-catalog-section="featured"');
    expect(html).toContain('data-catalog-featured="bot:Pixel"');
    for (const title of ["Featured", "Shared with me", "My Bots", "Organization", "Templates"]) expect(html).toContain(`>${title}</h3>`);
    expect(html).toContain("by Ben Tremblay");
    expect(html).toContain("Show archived");
    expect(html).toContain("data-catalog-creator-badge");
  });

  it("shows View all past the preview and every row in the expanded section", () => {
    const many = Array.from({ length: SECTION_PREVIEW + 2 }, (_, index) => entry(`Bot ${index}`));
    const sections = catalogSections({ organization: false, entries: many }, [], filter);
    const home = view({ organization: false, sections });
    expect(home).toContain('data-catalog-view-all="mine"');
    expect(home.match(/data-catalog-row="bot:/g)).toHaveLength(SECTION_PREVIEW);
    expect(home).not.toContain("Shared with me");
    const all = view({ organization: false, sections, expanded: "mine" });
    expect(all.match(/data-catalog-row="bot:/g)).toHaveLength(SECTION_PREVIEW + 2);
    expect(all).toContain("data-catalog-back");
  });

  it("says so when a search finds nothing", () => {
    const sections = catalogSections({ organization: true, entries }, templates, { ...filter, query: "zzz" });
    expect(view({ sections, query: "zzz" })).toContain("No bot matches this search.");
  });
});

describe("the detail pane", () => {
  const pixel: CatalogItem = { kind: "bot", key: "bot:Pixel", entry: entries[3]! };

  it("shows the bot, by whom, its actions and the instructions first, read only", () => {
    const html = renderToStaticMarkup(createElement(BotCatalogDetailView, {
      item: pixel,
      content: { soul: "You design screens.", memories: null, skills: [{ name: "mockup", description: "Draws a mockup" }], routines: [], integrations: [{ name: "figma-mcp", kind: "mcp" }] },
      tab: "soul",
      onTab: () => {},
      onBack: () => {},
      actions: createElement("button", { "data-test": "import" }, "Import Bot"),
    }));
    expect(html).toContain("By Ben Tremblay");
    expect(html).toContain("Pixel does things");
    expect(html).toContain("Import Bot");
    for (const tab of ["Instructions", "Memories", "Skills", "Routines", "Integrations"]) expect(html).toContain(`>${tab}</span>`);
    for (const hint of ["Facts it already knows", "Playbooks it can run", "Jobs that run on their own", "Apps it can use"]) expect(html).toContain(hint);
    expect(html).toContain("You design screens.");
    expect(html).toContain("Everything here is read only.");
    expect(html).not.toContain("<textarea");
  });

  it("explains hidden memories on a published bot, and lists integrations", () => {
    const content = { soul: "", memories: null, skills: [], routines: [], integrations: [{ name: "figma-mcp", kind: "mcp" as const }, { name: "browser", kind: "browser" as const }] };
    const memories = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: pixel, content, tab: "memories", onTab: () => {}, onBack: () => {}, actions: null }));
    expect(memories).toContain("shown only to the people this bot is shared with");
    const integrations = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: pixel, content, tab: "integrations", onTab: () => {}, onBack: () => {}, actions: null }));
    expect(integrations).toContain("figma-mcp");
    expect(integrations).toContain("MCP server");
    expect(integrations).toContain("Built-in browser");
  });

  it("shows a template's own instructions", () => {
    const coder = { kind: "template" as const, key: "role:coder", template: templates.find((template) => template.id === "role:coder")! };
    const html = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: coder, content: templateDetail(coder), tab: "soul", onTab: () => {}, onBack: () => {}, actions: null }));
    expect(html).toContain("By Sagax");
    expect(html).toContain("careful engineer");
    expect(html).not.toContain("data-catalog-creator-badge");
  });
});

describe("the modal", () => {
  it("is a full-height dialog with its title, loading the catalogue", () => {
    const html = renderToStaticMarkup(createElement(BotCatalogModal));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="bot-catalog-title"');
    expect(html).toContain("data-bot-catalog-modal");
    expect(html).toContain("Loading the catalog");
  });

  it("is in the sidebar section menu, after New section", () => {
    expect(orgSectionMenuItems({ named: false, canMoveUp: false, canMoveDown: false, anyExpanded: true, browseBots: true })).toEqual(["onNew", "onBrowseBots", "onCollapseAll"]);
  });
});
