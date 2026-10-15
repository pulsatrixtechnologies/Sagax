// Settings > Models and voice (2026-10-14): one page instead of Integrations
// and Models and accounts. One list of keys, model, voice and image alike,
// with the rare ones folded under More providers unless saved, the only place
// a key is managed (2026-10-15); the voice engine and image generation use
// their key from that list (Grok the xAI key) and link to it when it is
// missing; the ready engines in view, the others folded; Live calls under
// Advanced.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import { setLocale } from "@/lib/i18n";
import type { ConfigStatus } from "@/state/store";

const fixture = vi.hoisted(() => ({ config: undefined as import("@/state/store").ConfigStatus | undefined, section: "engines" as string, instances: [] as unknown[] }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: fixture.instances, config: fixture.config }, dispatch: vi.fn(), refreshInstances: vi.fn() }),
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));

const baseConfig = (over: Record<string, unknown> = {}) => ({
  composio: { configured: false, mode: "unavailable" },
  box: { configured: false },
  vps: { configured: false, sshAlias: "" },
  rooms: { turnTimeoutMinutes: 5 },
  localVm: { mode: "shared", maxInstances: 2 },
  tts: { configured: false, ready: false, voice: "", provider: "elevenlabs", keys: { elevenlabs: false, fish: false } },
  live: { enabled: true, configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 },
  imageGen: { configured: false },
  ...over,
}) as unknown as ConfigStatus;

async function page(): Promise<string> {
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(SettingsModal));
}

/** The markup of one part of the page, from its marker to the next one. */
function part(html: string, from: string, to?: string): string {
  const start = html.indexOf(from);
  if (start < 0) return "";
  const end = to ? html.indexOf(to, start) : -1;
  return html.slice(start, end > start ? end : undefined);
}

beforeEach(() => {
  fixture.config = baseConfig();
  fixture.section = "engines";
  fixture.instances = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings > Models and voice", () => {
  it.each(["router", "OpenRouter", "base URL", "API key", "OpenAI", "Anthropic", "Groq", "ElevenLabs", "voice", "integrations", "Intégrations"])("is found by searching for %s", async (typed) => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const page = SECTIONS.find((entry) => entry.id === "engines")!;
    // the modal lowercases and trims what was typed before matching
    expect(sectionMatches(page, typed.trim().toLowerCase())).toBe(true);
  });

  it("is one menu entry: no Integrations, no Models and accounts", async () => {
    const { SECTIONS } = await import("./SettingsModal");
    expect(SECTIONS.map((entry) => entry.id)).not.toContain("connections");
    const html = await page();
    expect(html.match(/>Models and voice</g)?.length).toBeGreaterThanOrEqual(1);
    expect(html).not.toContain(">Integrations<");
    expect(html).not.toContain("Models and accounts");
    setLocale("fr");
    const fr = await page();
    expect(fr).toContain(">Modèles et voix<");
    expect(fr).not.toContain(">Intégrations<");
    expect(fr).not.toContain("Modèles et comptes");
  });

  it("opens from an old Integrations link", async () => {
    fixture.section = "connections";
    const html = await page();
    expect(html).toContain("data-models-voice");
    expect(html).toContain('data-keys-section=""');
  });

  const readyClaude = {
    instanceId: "claude", displayName: "Claude", driverKind: "claudeAgent", cliDefault: "claude", access: "subscription",
    snapshot: { state: "available", authenticated: true }, models: { default: "sonnet", options: [] },
  };
  const kimiToSetUp = {
    instanceId: "kimi", displayName: "Kimi", driverKind: "kimiAgent", cliDefault: "kimi", access: "subscription",
    snapshot: { state: "unavailable" }, models: { default: "", options: [] },
  };

  it("orders Auto, Keys, Engines, Voice on one page", async () => {
    fixture.instances = [kimiToSetUp];
    const html = await page();
    const at = (marker: string) => html.indexOf(marker);
    expect(at("data-auto-model-explainer")).toBeGreaterThan(0);
    expect(at("data-auto-model-explainer")).toBeLessThan(at("data-keys-section"));
    expect(at("data-keys-section")).toBeLessThan(at('data-settings-card="engines.list"'));
    expect(at('data-settings-card="engines.list"')).toBeLessThan(at("data-voice-section"));
    // none ready: Needs setup opens by default, to set one up
    expect(part(html, 'data-settings-card="engines.setup"', "data-voice-section")).toMatch(/^data-settings-card="engines.setup" data-open="true"/);
  });

  // 2026-10-15: the ready engines are never folded; only Needs setup is.
  it("keeps the ready engines in view and folds only the ones to set up", async () => {
    fixture.instances = [readyClaude, kimiToSetUp];
    const engines = part(await page(), 'data-settings-card="engines.list"', "data-voice-section");
    const ready = part(engines, "data-engines-ready", 'data-settings-card="engines.setup"');
    expect(ready).toContain(">Ready<");
    expect(ready).toContain('data-engine-card="claude"');
    expect(ready).not.toContain("data-open");
    // Check again sits with the engines, outside any fold
    expect(part(engines, 'data-settings-card="engines.list"', "data-engines-ready")).toContain("Check again");
    const setup = part(engines, 'data-settings-card="engines.setup"');
    expect(setup).toMatch(/^data-settings-card="engines.setup" data-open="false"/);
    expect(setup).toContain("Needs setup");
    expect(setup).toContain("1 model provider");
    expect(setup).toContain('data-engine-card="kimi"');
    expect(engines.match(/data-engine-card="claude"/g)).toHaveLength(1);
  });

  // 2026-10-15: every key is managed in Keys, the voice and image keys too.
  it("lists every key once in Keys, none in Voice or Image generation, with no key field on the page", async () => {
    const html = await page();
    const keys = part(html, "data-keys-section", 'data-settings-card="engines.list"');
    for (const id of ["anthropic", "openai", "xai", "openrouter", "mistral", "openaiCompat", "opencodeGo", "elevenlabs", "fishAudio", "openaiImage", "customImage"]) {
      expect(html.match(new RegExp(`data-provider-key="${id}"`, "g")), id).toHaveLength(1);
      expect(keys, id).toContain(`data-provider-key="${id}"`);
    }
    const voice = part(html, "data-voice-section", 'data-settings-card="connections.image"');
    expect(voice).toContain("ElevenLabs key missing");
    expect(voice).toContain('data-add-in-keys="elevenlabs"');
    expect(voice).not.toContain("Add a key");
    expect(voice).not.toContain("data-provider-key=");
    const image = part(html, 'data-settings-card="connections.image"');
    expect(image).not.toContain('type="password"');
    expect(image).toContain('data-add-in-keys="openaiImage"');
    expect(html.match(/data-keys-section/g)).toHaveLength(1);
    // keys are added in a dialog, never typed on the page
    expect(html).not.toContain('data-api-key-row="anthropic"');
    expect(html).not.toContain('aria-label="Grok key"');
    expect(html).not.toContain("Bots keep their own xAI key");
  });

  it("folds the rare providers under More providers, but never hides a saved one", async () => {
    const html = await page();
    const more = part(html, 'data-settings-card="engines.moreProviders"', 'data-settings-card="engines.list"');
    expect(more).toContain('data-open="false"');
    expect(more).toContain("More providers");
    expect(more).toContain('data-provider-key="openrouter"');

    fixture.config = baseConfig({ openrouter: { configured: true } });
    const saved = await page();
    const main = part(saved, "data-keys-section", 'data-settings-card="engines.moreProviders"');
    expect(main).toMatch(/data-provider-key="openrouter" data-key-saved="true"/);
    expect(part(saved, 'data-settings-card="engines.moreProviders"', 'data-settings-card="engines.list"')).not.toContain('data-provider-key="openrouter"');
  });

  it("puts a saved voice key in the main list, and Voice says it uses it", async () => {
    fixture.config = baseConfig({ tts: { configured: false, ready: false, voice: "", provider: "elevenlabs", keys: { elevenlabs: true, fish: false } } });
    const html = await page();
    const main = part(html, "data-keys-section", 'data-settings-card="engines.moreProviders"');
    expect(main).toMatch(/data-provider-key="elevenlabs" data-key-saved="true"/);
    expect(part(html, 'data-settings-card="engines.moreProviders"', 'data-settings-card="engines.list"')).toContain('data-provider-key="fishAudio"');
    expect(html).toMatch(/data-voice-key="elevenlabs" data-voice-key-saved="true"/);
    expect(html).toContain("Uses the ElevenLabs key from Keys.");
  });

  // A key saved from the Voice section of an older build (tts.key, tts.fishKey)
  // is the same credential: it shows as saved in Keys.
  it("shows a Fish Audio key saved by an older build as saved in Keys", async () => {
    fixture.config = baseConfig({ tts: { configured: true, ready: true, voice: "", provider: "fish", keys: { elevenlabs: false, fish: true } } });
    const html = await page();
    expect(part(html, "data-keys-section", 'data-settings-card="engines.moreProviders"')).toMatch(/data-provider-key="fishAudio" data-key-saved="true"/);
  });

  it("opens More providers and highlights the row when Voice asks for a key", async () => {
    vi.useFakeTimers();
    try {
      const { revealKeyRow } = await import("./settings/ProviderKeys");
      const { resetSettingsCards } = await import("./SettingsPrimitives");
      fixture.config = baseConfig({ tts: { configured: false, ready: false, voice: "", provider: "fish", keys: { elevenlabs: false, fish: false } } });
      expect(part(await page(), 'data-settings-card="engines.moreProviders"')).toMatch(/^data-settings-card="engines.moreProviders" data-open="false"/);
      revealKeyRow("fishAudio", fixture.config);
      const html = await page();
      expect(part(html, 'data-settings-card="engines.moreProviders"')).toMatch(/^data-settings-card="engines.moreProviders" data-open="true"/);
      expect(html).toMatch(/data-provider-key="fishAudio" data-key-saved="false" data-key-highlight="true"/);
      // no dialog, no form: the person adds the key from the row
      expect(html).not.toContain("data-provider-key-dialog");
      vi.runAllTimers();
      expect(await page()).not.toContain("data-key-highlight");
      resetSettingsCards();
    } finally {
      vi.useRealTimers();
    }
  });

  // One OpenAI key (2026-10-14): Live calls use the OpenAI key of the list.
  it("has one OpenAI key on the page: Live calls use the list's", async () => {
    const html = await page();
    expect(html.match(/data-provider-key="openai"/g)).toHaveLength(1);
    const advanced = part(html, 'data-settings-card="voice.advanced"');
    expect(advanced).toContain('data-live-key="none"');
    expect(advanced).not.toContain("Change key");
    fixture.config = baseConfig({ live: { enabled: true, configured: true, separateKey: true, voice: "", readTypedReplies: true, idleMinutes: 5 } });
    const older = part(await page(), 'data-settings-card="voice.advanced"');
    expect(older).toContain('data-live-key="separate"');
    expect(older).toContain("Remove key");
  });

  it("chooses the voice engine only; Grok voice uses the xAI row; Live calls under a folded Advanced", async () => {
    fixture.config = baseConfig({ xai: { configured: true }, tts: { configured: true, ready: false, voice: "", provider: "xai", keys: { elevenlabs: false, fish: false } } });
    const html = await page();
    const voice = part(html, "data-voice-section", 'data-settings-card="connections.image"');
    expect(voice).toContain('aria-label="Voice engine"');
    expect(voice).toContain("Uses the xAI key from Keys.");
    expect(voice).not.toContain("data-add-in-keys");
    expect(voice).not.toContain('type="password"');
    const advanced = part(voice, 'data-settings-card="voice.advanced"');
    expect(advanced).toContain('data-open="false"');
    expect(advanced).toContain("Live calls (OpenAI)");
    // folded, still applied: the switch keeps its saved value
    expect(advanced).toContain("Read replies to typed messages");
  });

  it("translates the Live calls settings in French", async () => {
    setLocale("fr");
    const html = await page();
    expect(html).toContain("Lire les réponses aux messages tapés");
    expect(html).not.toContain("Read replies to typed messages");
    expect(html).toContain(">Avancé<");
    expect(html).toContain("Plus de fournisseurs");
  });

  // 2026-10-14: Connected apps and Decision model are cards of this page
  // while their experiment is on, no longer menu entries of their own.
  it("holds Connected apps and Decision model as cards while their experiment is on", async () => {
    let html = await page();
    expect(html).not.toContain("platform.composio.dev");
    expect(html).not.toContain('data-settings-card="engines.decisionModel"');
    fixture.config = baseConfig({ features: { connectedApps: true, decisionModel: true } });
    html = await page();
    expect(html).toContain('data-settings-card="connections.apps"');
    expect(html).toContain("platform.composio.dev");
    expect(html).toContain('data-settings-card="engines.decisionModel"');
    // the navigation has no entry for either
    const nav = part(html, "<nav", "</nav>");
    expect(nav).not.toContain(">Connected apps<");
    expect(nav).not.toContain(">Decision model<");
  });

  it("opens the card from an old Connected apps or Decision model link", async () => {
    fixture.config = baseConfig({ features: { connectedApps: true, decisionModel: true } });
    for (const section of ["connectedApps", "decisionModel"]) {
      fixture.section = section;
      const html = await page();
      expect(html, section).toContain("data-models-voice");
      expect(html, section).toContain('data-settings-card="engines.decisionModel"');
    }
  });

  it("points OpenCode users at `opencode auth login` in the OpenCode key dialog", async () => {
    const { ProviderKeyDialog, openProviderKeyDialog } = await import("./settings/ProviderKeys");
    openProviderKeyDialog("opencodeGo");
    const html = renderToStaticMarkup(createElement(ProviderKeyDialog));
    openProviderKeyDialog(null);
    expect(html).toContain("More providers for OpenCode bots");
    expect(html).toContain('<code class="font-mono">opencode auth login</code>');
  });

  // A Cloud has no terminal: a key for any OpenCode provider is saved here.
  it("offers keys for other OpenCode providers next to the OpenCode key", async () => {
    const { ProviderKeyDialog, openProviderKeyDialog } = await import("./settings/ProviderKeys");
    openProviderKeyDialog("opencodeGo");
    const html = renderToStaticMarkup(createElement(ProviderKeyDialog));
    openProviderKeyDialog(null);
    const opencode = html.indexOf('data-api-key-row="opencodeGo"');
    expect(opencode).toBeGreaterThan(0);
    expect(html.indexOf("data-opencode-provider-keys")).toBeGreaterThan(opencode);
    expect(html).toContain("Keys for other OpenCode providers");
    expect(html).not.toContain(">Optional<");
  });

  it("opens a voice key in the same dialog as a model key", async () => {
    const { ProviderKeyDialog, openProviderKeyDialog } = await import("./settings/ProviderKeys");
    openProviderKeyDialog("fishAudio");
    const html = renderToStaticMarkup(createElement(ProviderKeyDialog));
    openProviderKeyDialog(null);
    expect(html).toContain('data-provider-key-dialog="fishAudio"');
    expect(html).toContain('data-api-key-row="fishAudio"');
    expect(html).toContain("Fish Audio API keys");
  });

  it("lists each key as one row with its state and one action", async () => {
    fixture.config = baseConfig({ anthropic: { configured: true } });
    const { MAIN_KEY_ROWS, ProviderKeyRows } = await import("./settings/ProviderKeys");
    const html = renderToStaticMarkup(createElement(ProviderKeyRows, { rows: MAIN_KEY_ROWS }));
    expect(html.match(/data-provider-key="/g)).toHaveLength(MAIN_KEY_ROWS.length);
    expect(html).toMatch(/data-provider-key="anthropic".*Key saved.*Replace or remove/);
    expect(html).toMatch(/data-provider-key="openai".*No key.*Add a key/);
    expect(html).not.toContain("<input");
  });
});
