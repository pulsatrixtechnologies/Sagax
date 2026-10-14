// Router and API-key setup lives under Settings → Connections: searching for
// what people call it has to find it, and OpenCode's own sign-in is named
// there for providers Sagax has no field for.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ config: undefined as import("@/state/store").ConfigStatus | undefined }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: "connections", instances: [], config: fixture.config }, dispatch: vi.fn() }),
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));

beforeEach(() => {
  fixture.config = undefined;
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings → Connections", () => {
  it.each(["router", "OpenRouter", "base URL", "API key", "OpenAI", "Anthropic", "Groq"])("is found by searching for %s", async (typed) => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const connections = SECTIONS.find((entry) => entry.id === "connections")!;
    // the modal lowercases and trims what was typed before matching
    expect(sectionMatches(connections, typed.trim().toLowerCase())).toBe(true);
  });

  // 2026-10-12: the model provider keys moved to Models and accounts; this
  // page keeps a row that opens it, so old links still lead to the keys.
  it("points at Models and accounts for the model provider keys", async () => {
    const { SettingsModal } = await import("./SettingsModal");
    const html = renderToStaticMarkup(createElement(SettingsModal));
    expect(html).toContain('data-settings-card="connections.providers"');
    expect(html).toContain("Model provider keys");
    expect(html).not.toContain('data-api-key-row="anthropic"');
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

  it("lists each provider key as one row with its state and one action", async () => {
    fixture.config = { anthropic: { configured: true } } as unknown as import("@/state/store").ConfigStatus;
    const { PROVIDER_KEY_ROWS, ProviderKeyRows } = await import("./settings/ProviderKeys");
    const html = renderToStaticMarkup(createElement(ProviderKeyRows, { rows: PROVIDER_KEY_ROWS }));
    expect(html.match(/data-provider-key="/g)).toHaveLength(PROVIDER_KEY_ROWS.length);
    expect(html).toMatch(/data-provider-key="anthropic".*Key saved.*Replace or remove/);
    expect(html).toMatch(/data-provider-key="openai".*No key.*Add a key/);
    expect(html).not.toContain("<input");
  });
});
