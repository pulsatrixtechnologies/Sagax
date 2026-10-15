// The bot editor: the Achievements shell, groups in the left column whose
// sections are each their own page (JC 2026-10-15), listed under the open
// group, and locked sections shown with their reason instead of hidden.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, BotSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  state: {} as Partial<AppState>,
  advanced: true,
  perspicax: null as unknown,
  dispatch: (() => {}) as (action: unknown) => void,
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => fixture.perspicax,
  useOrgPeople: () => new Map(),
}));
vi.mock("../bot-settings/useSlackManagement", () => ({ useSlackManagementUrl: () => null }));
vi.mock("../bot-settings/useBotSettingsDerived", () => ({
  useBotSettingsDerived: () => ({ botRoutines: [], patch: vi.fn(), activeState: "idle", mascotMotion: null }),
}));
// Section bodies are the bot panel's own components; each one is replaced
// by a marker so the test reads which body a category mounts.
const marker = (name: string) => () => createElement("div", { "data-section-body": name });
vi.mock("../bot-settings/OverviewSection", () => ({ OverviewSection: marker("overview") }));
vi.mock("../bot-settings/SoulSection", () => ({ SoulSection: marker("soul") }));
vi.mock("../bot-settings/SkillsSection", () => ({ SkillsSection: marker("skills") }));
vi.mock("../bot-settings/MemorySection", () => ({ MemorySection: marker("memory") }));
vi.mock("../bot-settings/RulesSection", () => ({ RulesSection: marker("rules") }));
vi.mock("../bot-settings/WorkspaceFilesSection", () => ({ WorkspaceFilesSection: marker("files") }));
vi.mock("../bot-settings/AccessSection", () => ({ AccessSection: marker("access") }));
vi.mock("../computer/WorksOnSetting", () => ({ WorksOnSetting: marker("worksOn") }));
vi.mock("../bot-settings/ModelSection", () => ({ ModelSection: marker("model") }));
vi.mock("../bot-settings/PermissionsSection", () => ({ PermissionsSection: marker("permissions") }));
vi.mock("../bot-settings/VoiceSection", () => ({ VoiceSection: marker("voice") }));
vi.mock("../bot-settings/PerspicaxSection", () => ({ PerspicaxSection: marker("perspicax") }));
vi.mock("../bot-settings/SharingSection", () => ({ SharingSection: marker("sharing") }));
vi.mock("../bot-settings/VisibilitySection", () => ({ VisibilitySection: marker("visibility") }));
vi.mock("../bot-settings/HistorySection", () => ({ HistorySection: marker("history") }));
vi.mock("../bot-settings/UsageSection", () => ({ UsageSection: marker("usage") }));
vi.mock("../BotProfileAvatarCard", () => ({ BotProfileAvatarCard: marker("avatar") }));
vi.mock("../appearance/AppearancePane", () => ({ AppearancePane: marker("appearance") }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, ...fixture.state },
      dispatch: fixture.dispatch,
      flushBotPatches: vi.fn(async () => null),
    }),
  };
});

const { PersonaEditorModal, PERSONA_GROUPS } = await import("./PersonaEditorModal");
const { personaCategoryForSection, personaGroupOf } = await import("@/lib/persona-sections");

const bot = {
  id: "pepper", threadId: "t", name: "Pepper", title: "Research", description: "Finds sources.", notifications: true,
  color: "green", unread: false, messages: [], tasks: [], soul: "Be brief.",
  modelSelection: { instanceId: "claude", model: "opus" },
} as unknown as Bot;
const other = { ...bot, id: "other", name: "Other" } as Bot;

function render(section: BotSettingsSection, state: Partial<AppState> = {}) {
  fixture.state = { bots: [bot, other], personaEditor: { botId: bot.id, section }, ...state };
  return renderToStaticMarkup(createElement(PersonaEditorModal));
}

const memberConfig = {
  viewer: { role: "member", principalId: "pr_me", operator: false },
} as unknown as AppState["config"];

beforeEach(() => {
  setLocale("en");
  fixture.advanced = true;
  fixture.perspicax = { identity: { kind: "perspicax" } };
  fixture.dispatch = vi.fn();
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

/** The markup of one page (shown or kept hidden). */
function pageHtml(html: string, page: string): { hidden: boolean; html: string } {
  const start = html.indexOf(`data-persona-section="${page}"`);
  if (start < 0) return { hidden: true, html: "" };
  const next = html.indexOf("data-persona-section=", start + 1);
  const chunk = html.slice(start, next < 0 ? undefined : next);
  return { hidden: /^data-persona-section="\w+" hidden=""/.test(chunk), html: chunk };
}
const groupsOf = (html: string) => [...html.matchAll(/data-persona-category="(\w+)"/g)].map((match) => match[1]);
const subPagesOf = (html: string) => [...html.matchAll(/data-persona-page="(\w+)"/g)].map((match) => match[1]);
const bodiesOf = (html: string) => [...html.matchAll(/data-section-body="(\w+)"/g)].map((match) => match[1]);
/** The bodies of the page on screen (kept-mounted pages are hidden). */
const shownBodies = (html: string, page: string) => bodiesOf(pageHtml(html, page).html);
const visiblePages = (html: string) => [...html.matchAll(/data-persona-section="(\w+)"( hidden="")?/g)].filter((match) => !match[2]).map((match) => match[1]);

const ALL_GROUPS = ["profile", "instructions", "memoryFiles", "modelTools", "permissions", "voice", "usage", "changes"];

describe("persona editor shell", () => {
  it("uses the Achievements shell and lists the groups in order", () => {
    const html = render("overview");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("data-persona-modal");
    expect(html).toContain("h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))]");
    expect(html).toContain("w-[198px]");
    expect(groupsOf(html)).toEqual(PERSONA_GROUPS.map((group) => group.id));
    expect(groupsOf(html)).toEqual(ALL_GROUPS);
    for (const label of ["Profile", "Instructions", "Memory and files", "Model and tools", "Permissions", "Voice", "Usage", "Changes"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(html).not.toContain("data-persona-search");
    expect(html).toContain(">Edit bot<");
    expect(html).not.toContain(">Persona<");
    expect(html).toContain('aria-current="page"');
  });

  it("names the groups and pages in French", () => {
    setLocale("fr");
    const html = render("overview");
    for (const label of ["Profil", "Instructions", "Mémoire et fichiers", "Modèle et outils", "Permissions", "Voix", "Utilisation", "Changements"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    for (const label of ["Identité", "Apparence", "Partagé avec", "Ce qu&#x27;il fait"]) expect(html).toContain(`>${label}</span>`);
    expect(html).toContain(">Modifier le bot<");
    expect(render("worksOn")).toContain(">Zone de travail</span>");
  });

  it("renders nothing when closed or when the bot is gone", () => {
    fixture.state = { bots: [bot], personaEditor: null };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
    fixture.state = { bots: [bot], personaEditor: { botId: "gone", section: "overview" } };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
  });

  it("follows Simple mode: the pages it hides are not listed, and an empty group goes", () => {
    fixture.advanced = false;
    expect(groupsOf(render("overview"))).toEqual(["profile", "instructions", "memoryFiles", "modelTools", "permissions", "voice"]);
    expect(subPagesOf(render("soul"))).toEqual(["soul", "rules"]);
    // Model and tools keeps only Model: no list under it
    expect(subPagesOf(render("model"))).toEqual([]);
    // Permissions without the Perspicax profiles
    expect(subPagesOf(render("permissions"))).toEqual([]);
    // a link to a hidden page lands on its group's home
    const skills = render("skills");
    expect(skills).toContain('data-persona-current="soul"');
    expect(skills).not.toContain('data-section-body="skills"');
    expect(render("access")).toContain('data-persona-current="model"');
  });
});

describe("persona editor pages", () => {
  // Each page shows its own section only (plus the hidden drafts of Memory,
  // Rules and Files, kept mounted).
  const pages: Array<[BotSettingsSection, string, string[]]> = [
    ["overview", "profile", ["avatar"]],
    ["appearance", "profile", ["appearance"]],
    ["sharing", "profile", ["sharing"]],
    ["summary", "profile", ["overview"]],
    ["soul", "instructions", ["soul"]],
    ["rules", "instructions", ["rules"]],
    ["skills", "instructions", ["skills"]],
    ["memory", "memoryFiles", ["memory"]],
    ["files", "memoryFiles", ["files"]],
    ["model", "modelTools", ["model"]],
    ["worksOn", "modelTools", ["worksOn"]],
    ["access", "modelTools", ["access"]],
    ["permissions", "permissions", ["permissions"]],
    ["perspicax", "permissions", ["perspicax"]],
    ["voice", "voice", ["voice"]],
    ["usage", "usage", ["usage"]],
    ["history", "changes", ["history"]],
  ];
  for (const [page, group, bodies] of pages) {
    it(`${page} is its own page in ${group}`, () => {
      const html = render(page);
      expect(html).toContain(`data-persona-pane="${group}"`);
      expect(html).toContain(`data-persona-current="${page}"`);
      expect(visiblePages(html)).toEqual([page]);
      expect(shownBodies(html, page)).toEqual(bodies);
      expect(html).not.toContain("data-persona-locked");
      expect(html).toMatch(/<h2[^>]*>[^<]+<\/h2>/);
      // the group is open in the list, and its page is the current entry
      expect(html).toMatch(new RegExp(`data-persona-category="${group}"[^>]*aria-current="(page|true)"`));
      if (subPagesOf(html).length > 0) expect(html).toMatch(new RegExp(`data-persona-page="${page}"[^>]*aria-current="page"`));
    });
  }

  it("lists the pages of the open group only, under it", () => {
    expect(subPagesOf(render("overview"))).toEqual(["overview", "appearance", "sharing", "summary"]);
    expect(subPagesOf(render("rules"))).toEqual(["soul", "rules", "skills"]);
    expect(subPagesOf(render("memory"))).toEqual(["memory", "files"]);
    expect(subPagesOf(render("model"))).toEqual(["model", "worksOn", "access"]);
    expect(subPagesOf(render("perspicax"))).toEqual(["permissions", "perspicax"]);
    // groups of one page have no list
    expect(subPagesOf(render("voice"))).toEqual([]);
    expect(subPagesOf(render("usage"))).toEqual([]);
    expect(subPagesOf(render("history"))).toEqual([]);
    expect(render("overview")).toContain('data-persona-subnav="profile"');
    expect(render("overview")).toContain('aria-expanded="true"');
  });

  it("clicks: a group opens its home page, a page entry opens that page", () => {
    const html = render("appearance");
    expect(html).toContain('data-persona-page="appearance"');
    // the group home and title
    expect(render("overview")).toMatch(/<h2[^>]*>Profile<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>Appearance<\/h2>/);
    expect(render("voice")).toMatch(/<h2[^>]*>Voice<\/h2>/);
  });

  it("the mobile select lists every page, grouped", () => {
    const html = render("appearance");
    expect(html).toContain('<optgroup label="Profile">');
    expect(html).toMatch(/<option value="appearance" selected="">Appearance<\/option>/);
    expect(html).toContain('<option value="voice">Voice</option>');
  });

  it("Profile's home is the identity only; Appearance, Shared with and What it does are pages of their own", () => {
    const html = render("overview");
    expect(shownBodies(html, "overview")).toEqual(["avatar"]);
    expect(html).not.toContain('data-section-body="appearance"');
    expect(html).not.toContain('data-section-body="sharing"');
    expect(html).not.toContain('data-section-body="overview"');
    expect(html).not.toContain("data-persona-summary");
  });

  it("opens a deep link on its own page", () => {
    expect(personaGroupOf("appearance")).toBe("profile");
    expect(personaGroupOf("skills")).toBe("instructions");
    expect(personaGroupOf("files")).toBe("memoryFiles");
    expect(personaGroupOf("worksOn")).toBe("modelTools");
    expect(personaGroupOf("slack")).toBe("modelTools");
    expect(personaGroupOf("perspicax")).toBe("permissions");
    expect(personaGroupOf("voice")).toBe("voice");
    expect(personaGroupOf("usage")).toBe("usage");
    expect(personaGroupOf("history")).toBe("changes");
    expect(personaGroupOf("sharing")).toBe("profile");
    expect(personaCategoryForSection("appearance")).toBe("appearance");
    expect(personaCategoryForSection("worksOn")).toBe("worksOn");
    expect(personaCategoryForSection("routines")).toBeNull();
    expect(render("appearance")).toContain('data-persona-current="appearance"');
    // Who can see it stands for Shared with where the server shares person by person
    expect(render("visibility")).toContain('data-persona-current="sharing"');
    fixture.perspicax = null;
    // and the other way round off Perspicax
    expect(render("sharing")).toContain('data-persona-current="visibility"');
  });

  for (const category of ["memory", "rules", "files"]) {
    it(`${category} stays mounted on every page and shows only on its own`, () => {
      const own = render(category as BotSettingsSection);
      expect(pageHtml(own, category).hidden).toBe(false);
      const elsewhere = render("model");
      const page = pageHtml(elsewhere, category);
      expect(page.hidden).toBe(true);
      expect(page.html).toContain(`data-section-body="${category}"`);
    });
  }

  it("profile shows the mascot, name, label, description and facts, and no quick actions (they are in the bot's \"...\" menu)", () => {
    const html = render("overview");
    expect(html).toContain('data-section-body="avatar"');
    expect(html).toContain(">Pepper<");
    expect(html).toContain(">Research<");
    expect(html).toContain("Finds sources.");
    for (const label of ["Engine", "Model", "Owner", "Sharing"]) expect(html).toContain(`>${label}</dt>`);
    expect(html).toContain(">opus</dd>");
    expect(html).toContain(">You</dd>");
    expect(html).not.toContain("data-persona-action");
  });

  it("perspicax says where it applies on a server without Perspicax", () => {
    fixture.perspicax = null;
    const html = render("perspicax");
    expect(html).not.toContain('data-section-body="perspicax"');
    expect(html).toContain("Perspicax profiles are offered on a server signed in with Perspicax.");
  });

  it("names Soul Personality, Skills Compétences and History Changements in French", () => {
    setLocale("fr");
    const html = render("soul");
    expect(html).toContain(">Règles</span>");
    expect(html).toContain(">Compétences</span>");
    expect(html).not.toContain(">Skills<");
    expect(html).not.toContain(">Soul<");
    expect(render("history")).toMatch(/<h2[^>]*>Changements<\/h2>/);
  });
});

describe("persona editor for an organization member", () => {
  it("opens Rules and Files on a bot she owns, like the Soul, while Memory stays an admin's", () => {
    const owned = { ...bot, ownerUserId: "pr_me" } as Bot;
    const state = { config: memberConfig, bots: [owned, other] };
    expect(shownBodies(render("soul", state), "soul")).toEqual(["soul"]);
    expect(shownBodies(render("rules", state), "rules")).toEqual(["rules"]);
    expect(shownBodies(render("files", state), "files")).toEqual(["files"]);
    const memory = pageHtml(render("memory", state), "memory").html;
    expect(memory).not.toContain('data-section-body="memory"');
    expect(memory).toContain("Only this bot&#x27;s owner or an admin can change this.");
  });

  it("shows a bot they do not own locked, with the reason, never hidden", () => {
    const state = { config: memberConfig };
    expect(groupsOf(render("overview", state))).toEqual(PERSONA_GROUPS.map((group) => group.id));
    const soul = pageHtml(render("soul", state), "soul").html;
    expect(soul).not.toContain('data-section-body="soul"');
    expect(soul).toContain("Only this bot&#x27;s owner or an admin can change this.");
    expect(soul).toContain("Be brief.");
    expect(soul).toContain('aria-readonly="true"');
    expect(pageHtml(render("rules", state), "rules").html).not.toContain('data-section-body="rules"');
    expect(pageHtml(render("files", state), "files").html).not.toContain('data-section-body="files"');

    const history = render("history", state);
    expect(history).not.toContain('data-section-body="history"');
    expect(history).toContain("A bot&#x27;s change history is for admins.");

    const overview = render("overview", state);
    expect(overview).not.toContain("data-persona-action");
    // a group where nothing can be changed shows the lock in the list
    const locked = [...overview.matchAll(/data-persona-category="(\w+)"( data-locked="")?/g)].filter((match) => match[2]).map((match) => match[1]);
    expect(locked).toContain("memoryFiles");
    expect(locked).toContain("changes");
    expect(locked).not.toContain("profile");
  });
});
