// The persona editor: the Achievements shell, one category per More
// section, the same section bodies as the bot panel, and locked sections
// shown with their reason instead of hidden.
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

const { PersonaEditorModal, PERSONA_CATEGORIES, personaCategoryMatches } = await import("./PersonaEditorModal");

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

describe("persona editor shell", () => {
  it("uses the Achievements shell and lists the categories in order", () => {
    const html = render("overview");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("data-persona-modal");
    expect(html).toContain("h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))]");
    expect(html).toContain("w-[198px]");
    const listed = [...html.matchAll(/data-persona-category="(\w+)"/g)].map((match) => match[1]);
    expect(listed).toEqual([...PERSONA_CATEGORIES]);
    expect(listed).toEqual(["overview", "soul", "skills", "memory", "access", "model", "permissions", "voice", "perspicax", "history", "usage"]);
    expect(html).toContain('data-persona-search=""');
    expect(html).toContain(">Persona<");
    expect(html).toContain('aria-current="page"');
  });

  it("renders nothing when closed or when the bot is gone", () => {
    fixture.state = { bots: [bot], personaEditor: null };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
    fixture.state = { bots: [bot], personaEditor: { botId: "gone", section: "overview" } };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
  });

  it("searches categories by name and by the words their section answers to", () => {
    expect(personaCategoryMatches("model", "engine")).toBe(true);
    expect(personaCategoryMatches("soul", "persona")).toBe(true);
    expect(personaCategoryMatches("usage", "tokens")).toBe(true);
    expect(personaCategoryMatches("usage", "zzz")).toBe(false);
  });

  it("follows Simple mode: the sections it hides in the bot panel are not listed", () => {
    fixture.advanced = false;
    const listed = [...render("overview").matchAll(/data-persona-category="(\w+)"/g)].map((match) => match[1]);
    expect(listed).toEqual(["overview", "soul", "memory", "model", "permissions", "voice"]);
  });
});

describe("persona editor categories", () => {
  const bodies: Record<string, string[]> = {
    soul: ["soul"],
    skills: ["skills"],
    access: ["access", "worksOn"],
    model: ["model"],
    permissions: ["permissions"],
    voice: ["voice"],
    perspicax: ["perspicax"],
    history: ["history"],
    usage: ["usage"],
  };
  for (const [category, expected] of Object.entries(bodies)) {
    it(`${category} shows the bot panel's own section`, () => {
      const html = render(category as BotSettingsSection);
      expect(html).toContain(`data-persona-pane="${category}"`);
      for (const name of expected) expect(html).toContain(`data-section-body="${name}"`);
      expect(html).not.toContain("data-persona-locked");
      // the pane's heading is the category
      expect(html).toMatch(/<h2[^>]*>[^<]+<\/h2>/);
    });
  }

  it("memory stays mounted and shows only on its own category", () => {
    const onMemory = render("memory");
    expect(onMemory).toContain('data-section-body="memory"');
    expect(onMemory).toMatch(/<div><div data-section-body="memory"><\/div><\/div>/);
    const elsewhere = render("model");
    expect(elsewhere).toMatch(/<div hidden=""><div data-section-body="memory"><\/div><\/div>/);
  });

  it("overview shows the mascot, name, label, description, facts and quick actions, then the server overview", () => {
    const html = render("overview");
    expect(html).toContain('data-section-body="avatar"');
    expect(html).toContain(">Pepper<");
    expect(html).toContain(">Research<");
    expect(html).toContain("Finds sources.");
    for (const label of ["Engine", "Model", "Owner", "Sharing"]) expect(html).toContain(`>${label}</dt>`);
    expect(html).toContain(">opus</dd>");
    expect(html).toContain(">You</dd>");
    const actions = [...html.matchAll(/data-persona-action="([\w-]+)"/g)].map((match) => match[1]);
    expect(actions).toEqual(["rename", "put-on-desktop", "make-primary", "export-zip", "archive"]);
    expect(html).toContain('data-section-body="overview"');
    // on a Perspicax server the sharing list sits under the overview
    expect(html).toContain('data-section-body="sharing"');
  });

  it("perspicax says where it applies on a server without Perspicax", () => {
    fixture.perspicax = null;
    const html = render("perspicax");
    expect(html).not.toContain('data-section-body="perspicax"');
    expect(html).toContain("Perspicax profiles are offered on a server signed in with Perspicax.");
  });
});

describe("persona editor for an organization member", () => {
  it("shows a bot they do not own locked, with the reason, never hidden", () => {
    const state = { config: memberConfig };
    const listed = [...render("overview", state).matchAll(/data-persona-category="(\w+)"( data-locked="")?/g)];
    expect(listed.map((match) => match[1])).toEqual([...PERSONA_CATEGORIES]);
    const locked = listed.filter((match) => match[2]).map((match) => match[1]);
    expect(locked).toEqual(expect.arrayContaining(["soul", "memory", "access", "permissions", "history"]));

    const soul = render("soul", state);
    expect(soul).not.toContain('data-section-body="soul"');
    expect(soul).toContain("Only this bot&#x27;s owner or an admin can change this.");
    expect(soul).toContain("Be brief.");
    expect(soul).toContain('aria-readonly="true"');

    const history = render("history", state);
    expect(history).not.toContain('data-section-body="history"');
    expect(history).toContain("A bot&#x27;s change history is for admins.");

    const overview = render("overview", state);
    expect(overview).toMatch(/data-persona-action="rename" disabled=""/);
    expect(overview).toContain('data-persona-action-reason="make-primary"');
    expect(overview).not.toContain('data-persona-action="archive"');
  });
});
