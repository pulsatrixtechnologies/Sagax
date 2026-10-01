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
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [], bots: [], groups: [] }, dispatch: vi.fn() }),
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

describe("Settings in server mode", () => {
  it("General names the organization's server and offers Change, not This computer", () => {
    fixture.serverMode = { active: true, name: "GOX", origin: "https://bot.example.test" };
    const html = render();
    expect(html).toContain("Connected to bot.example.test");
    expect(html).toContain("Change");
    expect(html).not.toContain("THIS_COMPUTER_MARKER");
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
