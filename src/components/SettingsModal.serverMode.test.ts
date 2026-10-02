import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { SettingsModal } from "./SettingsModal";

// Server mode (src/lib/launch.ts): the desktop app shows its organization's
// server only. Settings > General names that server with the one way out,
// and a section about this computer says the organization manages it.
const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  serverMode: null as null | { active: false } | { active: true; name: string; origin: string },
  viewer: undefined as undefined | Record<string, unknown>,
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, appSettingsSubPage: null, instances: [], bots: [], groups: [], config: fixture.viewer ? { rooms: { turnTimeoutMinutes: 5 }, viewer: fixture.viewer, profile: { aboutMe: "I run IT at GOX.\nAnswer in French." } } : undefined }, dispatch: vi.fn() }),
}));
vi.mock("./ServerModeSettings", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ServerModeSettings")>(),
  useServerMode: () => fixture.serverMode,
}));
vi.mock("./DesktopWorkspaceSwitcher", () => ({ ThisComputerSettings: () => "THIS_COMPUTER_MARKER" }));
vi.mock("./CompanionSection", () => ({ CompanionSection: () => "LOCAL_COMPANION_MARKER" }));
vi.mock("./ServerPairingCard", () => ({ ServerPairingCard: () => "SERVER_PAIRING_CARD_MARKER" }));
vi.mock("./RemoteComputerSection", () => ({ RemoteComputerSection: () => null }));
vi.mock("./CustomDomainSettings", () => ({ CustomDomainSettings: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "general";
  fixture.serverMode = null;
  fixture.viewer = undefined;
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  // this app's bundle on the organization server: a reduced bridge, no remoteClient
  vi.stubGlobal("window", { ogb: { serverMode: { state: vi.fn(), leave: vi.fn() } } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));

const CONTAINER_BORDER = /[\s"]rounded-(?:\[14px\]|xl|lg)(?=[\s"]).*?\s(?:border|border-\[0\.5px\])(?=[\s"])/;
/** Bordered containers drawn inside another bordered container (a card in
 * a card). Not counted: a field's own frame (focus-within) and a popover
 * (absolute), which frame an input or float rather than nest a card. */
function nestedCardBorders(html: string): string[] {
  const body = html.slice(html.indexOf('<div class="flex flex-col gap-3 px-4'));
  const found: string[] = [];
  const stack: boolean[] = [];
  for (const [tag] of body.matchAll(/<div\b[^>]*>|<\/div>/g)) {
    if (tag === "</div>") { stack.pop(); continue; }
    const container = CONTAINER_BORDER.test(tag) && !/[\s"](?:absolute|focus-within:)/.test(tag);
    if (container && stack.includes(true)) found.push(tag);
    stack.push(container);
  }
  return found;
}

describe("Settings in server mode", () => {
  it("General says which server, organization and person are signed in, and offers Sign out, not This computer", () => {
    fixture.serverMode = { active: true, name: "GOX", origin: "https://bot.example.test" };
    fixture.viewer = { name: "Jean Tremblay", email: "jean@gox.example", profileManagedBy: "perspicax", profileManageUrl: "https://px.example.test/console/me" };
    const html = render();
    expect(html).toContain('Connected to <strong class="font-semibold text-ink">bot.example.test</strong>');
    expect(html).toContain("Organization: GOX");
    expect(html).toContain("Signed in as Jean Tremblay (jean@gox.example)");
    expect(html).toContain("Sign out returns this app to the launch screen");
    expect(html).toMatch(/<button type="button" class="ui-button[^"]*">.*?Sign out<\/button>/);
    expect(html).not.toMatch(/>Change<\/button>/);
    expect(html).not.toContain("THIS_COMPUTER_MARKER");
  });

  it("reads Se déconnecter in French", () => {
    setLocale("fr");
    fixture.serverMode = { active: true, name: "GOX", origin: "https://bot.example.test" };
    const html = render();
    expect(html).toContain("Connecté à <strong");
    expect(html).toContain("Se déconnecter");
  });

  it("General draws one card level: no bordered container inside a card", () => {
    fixture.serverMode = { active: true, name: "GOX", origin: "https://bot.example.test" };
    fixture.viewer = { name: "Jean Tremblay", email: "jean@gox.example", profileManagedBy: "perspicax", profileManageUrl: "https://px.example.test/console/me" };
    const html = render();
    expect(html).toContain('data-testid="managed-profile"');
    expect(nestedCardBorders(html)).toEqual([]);
    // About me is a row with its first line and Edit, not a card with a field
    expect(html).toContain('data-settings-card="general.aboutMe" data-settings-subpage-row');
    expect(html).toContain("I run IT at GOX.");
    expect(html).toContain(">Edit<");
    expect(html).not.toContain("<textarea");
  });

  it("keeps This computer when the app is not in server mode", () => {
    fixture.serverMode = { active: false };
    expect(render()).toContain("THIS_COMPUTER_MARKER");
  });

  it("Remote access keeps the server's pairing card and shows this computer's part as managed", () => {
    fixture.section = "companion";
    fixture.serverMode = { active: true, name: "GOX", origin: "https://bot.example.test" };
    const html = render();
    expect(html).toContain("SERVER_PAIRING_CARD_MARKER");
    expect(html).toContain("Managed by your organization");
    expect(html).not.toContain("LOCAL_COMPANION_MARKER");
  });

  it("reads in French", () => {
    setLocale("fr");
    fixture.section = "companion";
    fixture.serverMode = { active: true, name: "GOX", origin: "https://bot.example.test" };
    expect(render()).toContain("Géré par votre organisation");
  });
});
