// Settings cleanup for organization servers (2026-10-01): Email is a solo
// server's only (Perspicax manages an organization's mail), "Local VM" reads
// "Computer", and Connected apps is an experiment, off by default.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import type { AppSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  org: null as null | { org: { name: string; identity: { kind: "perspicax"; issuer: string } } },
  features: {} as Record<string, boolean>,
  viewer: undefined as { role: "member" | "admin" | "owner"; operator: boolean } | undefined,
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({
    state: { appSettingsSection: fixture.section, instances: [], bots: [], groups: [], config: { features: fixture.features, viewer: fixture.viewer, rooms: { turnTimeoutMinutes: 5 }, composio: { mode: "self", configured: false }, ...Object.fromEntries(["openai", "anthropic", "xai", "openrouter", "mistral", "openaiCompat", "box", "vps", "opencodeGo"].map((key) => [key, { configured: false }])) } },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => fixture.org,
}));
vi.mock("./ServerModeSettings", async (importOriginal) => ({
  ...await importOriginal<typeof import("./ServerModeSettings")>(),
  useServerMode: () => null,
}));
vi.mock("./DesktopWorkspaceSwitcher", () => ({ ThisComputerSettings: () => null }));
vi.mock("./MailSettings", () => ({ MailSettings: () => "MAIL_SETTINGS_MARKER" }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: () => "LOCAL_COMPUTER_MARKER" }));

beforeEach(() => {
  fixture.section = "general";
  fixture.org = null;
  fixture.features = {};
  fixture.viewer = undefined;
  setLocale("en");
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = async () => {
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(SettingsModal));
};
const ORG = { org: { name: "Example", identity: { kind: "perspicax" as const, issuer: "https://px.example.test" } } };

describe("Settings on an organization server", () => {
  it("leaves Email out on an organization server and keeps it on a solo server", async () => {
    const { organizationHidesSection } = await import("./SettingsModal");
    expect(organizationHidesSection("mail", true)).toBe(true);
    expect(organizationHidesSection("mail", false)).toBe(false);
    expect(organizationHidesSection("engines", true)).toBe(false);
    // Privacy (read receipts between people) exists on an organization server only
    expect(organizationHidesSection("privacy", true)).toBe(false);
    expect(organizationHidesSection("privacy", false)).toBe(true);

    fixture.section = "usage";
    const solo = await render();
    expect(solo).toContain(">Email<");
    expect(solo).not.toContain(">Privacy<");
    fixture.org = ORG;
    const org = await render();
    expect(org).not.toContain(">Email<");
    expect(org).toContain(">Privacy<");
  });

  it("names the Local VM page Computer (Ordinateur), with the same content", async () => {
    fixture.section = "computer";
    const html = await render();
    expect(html).toContain(">Computer<");
    expect(html).not.toContain(">Local VM<");
    expect(html).toContain("LOCAL_COMPUTER_MARKER");
    setLocale("fr");
    expect(await render()).toContain(">Ordinateur<");
  });

  it("finds the Computer page by its old name", async () => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const computer = SECTIONS.find((entry) => entry.id === "computer")!;
    expect(sectionMatches(computer, "local vm")).toBe(true);
    expect(sectionMatches(computer, "computer")).toBe(true);
  });
});

describe("an organization member", () => {
  const member = { role: "member" as const, operator: false };

  it("does not see installation sections the server refuses", async () => {
    fixture.viewer = member;
    fixture.org = ORG;
    const { memberHidesSection } = await import("./SettingsModal");
    const hidden = { editConfig: false, manageComputers: false, viewUsage: false, manageBackups: false, organization: true };
    expect(memberHidesSection("experimental", hidden)).toBe(true);
    expect(memberHidesSection("connectedApps", hidden)).toBe(true);
    expect(memberHidesSection("decisionModel", hidden)).toBe(true);
    expect(memberHidesSection("usage", hidden)).toBe(true);
    expect(memberHidesSection("backups", hidden)).toBe(true);
    expect(memberHidesSection("general", hidden)).toBe(false);
    expect(memberHidesSection("computer", hidden)).toBe(false);
    expect(memberHidesSection("computer", { ...hidden, organization: false })).toBe(true);
    expect(memberHidesSection("engines", hidden)).toBe(false);

    const nav = await render();
    expect(nav).not.toContain(">Experimental<");
    expect(nav).not.toContain(">API keys<");
    expect(nav).not.toContain(">Decision model<");
    expect(nav).not.toContain(">Usage<");
    expect(nav).not.toContain(">Backups<");
    expect(nav).toContain(">General<");
    expect(nav).toContain(">Computer<");
  });

  it("hides the General and Appearance rows that write the installation", async () => {
    fixture.viewer = member;
    fixture.section = "general";
    const general = await render();
    expect(general).not.toContain("Effort for new bots");
    expect(general).not.toContain("Defaults for new bots");
    expect(general).not.toContain("Routines in the conversation");
    expect(general).not.toContain("Group turns");
    expect(general).toContain("Language");

    fixture.section = "appearance";
    expect(await render()).not.toContain("Tool calls");
    expect(await render()).toContain("Interface font");
  });
});

describe("Connected apps is experimental", () => {
  // 2026-10-14: Connected apps has its own Settings page, shown with the experiment.
  it("hides the Connected apps page in Settings until the experiment is on", async () => {
    fixture.section = "connectedApps";
    const off = await render();
    expect(off).not.toContain("platform.composio.dev");
    expect(off).not.toContain('<option value="connectedApps"');
    fixture.features = { connectedApps: true };
    const on = await render();
    expect(on).toContain("platform.composio.dev");
    expect(on).toContain('<option value="connectedApps"');
    // never a bare "Not set": it says what is true
    expect(on).toContain("data-connected-apps-state");
    expect(on).not.toContain(">Not set<");
    // an old link to the Composio card in Integrations lands here too
    fixture.section = "connections";
    expect(await render()).not.toContain("platform.composio.dev");
  });

  it("offers the switch under Experimental features, off by default", async () => {
    fixture.section = "experimental";
    const html = await render();
    expect(html).toContain("data-experimental-connected-apps");
    expect(html).toContain('aria-label="Turn on Connected apps"');
    expect(html).toMatch(/aria-label="Turn on Connected apps"[^>]*aria-checked="false"|aria-checked="false"[^>]*aria-label="Turn on Connected apps"/);
  });
});
