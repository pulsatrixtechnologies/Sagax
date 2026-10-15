// The bot editor: the Achievements shell, six groups (JC 2026-10-14) whose
// pages show the bot panel's own section bodies one under the other, and
// locked sections shown with their reason instead of hidden.
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

/** The markup of one group's page (shown or kept hidden). */
function groupHtml(html: string, group: string): { hidden: boolean; html: string } {
  const start = html.indexOf(`data-persona-group="${group}"`);
  if (start < 0) return { hidden: true, html: "" };
  const next = html.indexOf("data-persona-group=", start + 1);
  const chunk = html.slice(start, next < 0 ? undefined : next);
  return { hidden: /^data-persona-group="\w+" hidden=""/.test(chunk), html: chunk };
}
const groupsOf = (html: string) => [...html.matchAll(/data-persona-category="(\w+)"/g)].map((match) => match[1]);

describe("persona editor shell", () => {
  it("uses the Achievements shell and lists the six groups in order", () => {
    const html = render("overview");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("data-persona-modal");
    expect(html).toContain("h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))]");
    expect(html).toContain("w-[198px]");
    expect(groupsOf(html)).toEqual(PERSONA_GROUPS.map((group) => group.id));
    expect(groupsOf(html)).toEqual(["profile", "instructions", "memoryFiles", "modelTools", "behavior", "activity"]);
    for (const label of ["Profile", "Instructions", "Memory and files", "Model and tools", "Behavior", "History and usage"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    // six entries need no search box; one label for the editor
    expect(html).not.toContain("data-persona-search");
    expect(html).toContain(">Edit bot<");
    expect(html).not.toContain(">Persona<");
    expect(html).toContain('aria-current="page"');
  });

  it("names the groups in French", () => {
    setLocale("fr");
    const html = render("overview");
    for (const label of ["Profil", "Instructions", "Mémoire et fichiers", "Modèle et outils", "Comportement", "Historique et utilisation"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(html).toContain(">Modifier le bot<");
  });

  it("renders nothing when closed or when the bot is gone", () => {
    fixture.state = { bots: [bot], personaEditor: null };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
    fixture.state = { bots: [bot], personaEditor: { botId: "gone", section: "overview" } };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
  });

  it("follows Simple mode: the sections it hides in the bot panel are not shown, and an empty group goes", () => {
    fixture.advanced = false;
    const html = render("overview");
    expect(groupsOf(html)).toEqual(["profile", "instructions", "memoryFiles", "modelTools", "behavior"]);
    const instructions = groupHtml(render("soul"), "instructions").html;
    expect(instructions).toContain('data-section-body="soul"');
    expect(instructions).toContain('data-section-body="rules"');
    expect(instructions).not.toContain('data-section-body="skills"');
    const tools = groupHtml(render("model"), "modelTools").html;
    expect(tools).toContain('data-section-body="model"');
    expect(tools).not.toContain('data-section-body="access"');
    expect(tools).not.toContain('data-section-body="perspicax"');
  });
});

describe("persona editor groups", () => {
  const pages: Record<string, { section: BotSettingsSection; bodies: string[] }> = {
    profile: { section: "overview", bodies: ["avatar", "overview", "sharing", "appearance"] },
    instructions: { section: "soul", bodies: ["soul", "rules", "skills"] },
    memoryFiles: { section: "memory", bodies: ["memory", "files"] },
    modelTools: { section: "model", bodies: ["model", "worksOn", "access", "perspicax"] },
    behavior: { section: "permissions", bodies: ["permissions", "voice"] },
    activity: { section: "history", bodies: ["history", "usage"] },
  };
  for (const [group, { section, bodies }] of Object.entries(pages)) {
    it(`${group} shows its sections one under the other`, () => {
      const html = render(section);
      expect(html).toContain(`data-persona-pane="${group}"`);
      const page = groupHtml(html, group);
      expect(page.hidden).toBe(false);
      for (const name of bodies) expect(page.html, name).toContain(`data-section-body="${name}"`);
      expect(html).not.toContain("data-persona-locked");
      expect(html).toMatch(/<h2[^>]*>[^<]+<\/h2>/);
    });
  }

  it("opens a deep link to a section on its group", () => {
    expect(personaGroupOf("appearance")).toBe("profile");
    expect(personaGroupOf("skills")).toBe("instructions");
    expect(personaGroupOf("files")).toBe("memoryFiles");
    expect(personaGroupOf("worksOn")).toBe("modelTools");
    expect(personaGroupOf("slack")).toBe("modelTools");
    expect(personaGroupOf("perspicax")).toBe("modelTools");
    expect(personaGroupOf("voice")).toBe("behavior");
    expect(personaGroupOf("usage")).toBe("activity");
    expect(personaGroupOf("sharing")).toBe("profile");
    expect(personaCategoryForSection("appearance")).toBe("appearance");
    expect(render("appearance")).toContain('data-persona-pane="profile"');
    expect(render("access")).toContain('data-persona-pane="modelTools"');
    expect(render("usage")).toContain('data-persona-pane="activity"');
    // each section keeps its anchor for the scroll
    expect(render("access")).toContain('data-persona-section="access"');
  });

  for (const category of ["memory", "rules", "files"]) {
    it(`${category} stays mounted on every page and shows only on its group's page`, () => {
      const own = render(category as BotSettingsSection);
      const group = personaGroupOf(category as BotSettingsSection);
      expect(groupHtml(own, group).html).toContain(`data-section-body="${category}"`);
      const elsewhere = render("model");
      const page = groupHtml(elsewhere, group);
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
    // Every action moved to the bot's "..." menu (BotActionsMenu); the
    // overview itself has none left (2026-10-14)
    expect(html).not.toContain("data-persona-action");
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

  it("names Soul Personality, Skills Compétences and History Changes in French", () => {
    setLocale("fr");
    const html = render("soul");
    expect(html).toContain(">Règles</h3>");
    expect(html).toContain(">Compétences</h3>");
    expect(html).not.toContain(">Skills<");
    expect(html).not.toContain(">Soul<");
    const activity = render("history");
    expect(activity).toContain(">Changements</h3>");
  });
});

describe("persona editor for an organization member", () => {
  it("opens Rules and Files on a bot she owns, like the Soul, while Memory stays an admin's", () => {
    const owned = { ...bot, ownerUserId: "pr_me" } as Bot;
    const state = { config: memberConfig, bots: [owned, other] };
    const instructions = groupHtml(render("soul", state), "instructions").html;
    expect(instructions).toContain('data-section-body="soul"');
    expect(instructions).toContain('data-section-body="rules"');
    const memory = groupHtml(render("memory", state), "memoryFiles").html;
    expect(memory).toContain('data-section-body="files"');
    expect(memory).not.toContain('data-section-body="memory"');
    expect(memory).toContain("Only this bot&#x27;s owner or an admin can change this.");
  });

  it("shows a bot they do not own locked, with the reason, never hidden", () => {
    const state = { config: memberConfig };
    expect(groupsOf(render("overview", state))).toEqual(PERSONA_GROUPS.map((group) => group.id));
    const instructions = groupHtml(render("soul", state), "instructions").html;
    expect(instructions).not.toContain('data-section-body="soul"');
    expect(instructions).not.toContain('data-section-body="rules"');
    expect(instructions).toContain("Only this bot&#x27;s owner or an admin can change this.");
    expect(instructions).toContain("Be brief.");
    expect(instructions).toContain('aria-readonly="true"');
    const files = groupHtml(render("files", state), "memoryFiles").html;
    expect(files).not.toContain('data-section-body="files"');

    const history = render("history", state);
    expect(history).not.toContain('data-section-body="history"');
    expect(history).toContain("A bot&#x27;s change history is for admins.");

    const overview = render("overview", state);
    expect(overview).not.toContain('data-persona-action="rename"');
    expect(overview).not.toContain('data-persona-action="make-primary"');
    expect(overview).not.toContain('data-persona-action="archive"');
    // a group where nothing can be changed shows the lock in the list
    const locked = [...overview.matchAll(/data-persona-category="(\w+)"( data-locked="")?/g)].filter((match) => match[2]).map((match) => match[1]);
    expect(locked).toContain("memoryFiles");
    expect(locked).not.toContain("profile");
  });
});
