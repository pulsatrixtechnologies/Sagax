import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

// The full fold-out panel this checks is Advanced mode's.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./bot-settings/useSlackManagement", () => ({ useSlackManagementUrl: () => null }));
vi.mock("./bot-settings/useBotSettingsDerived", () => ({ useBotSettingsDerived: () => ({ botRoutines: [], patch: vi.fn() }) }));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return { ...store, useStore: () => ({ state: store.initialState, dispatch: vi.fn(), flushBotPatches: vi.fn() }) };
});
import { BotSettingsDialog } from "./BotSettingsDialog";
import { DesktopCapabilitiesProvider } from "./DesktopCapabilities";

const bot = { id: "bot-1", name: "Maily", title: "", description: "Sorts the inbox.", messages: [], tasks: [] } as never as Bot;
// The provider reads window.ogb.platform on render, so each case sees its stub.
const header = () => {
  const html = renderToStaticMarkup(createElement(DesktopCapabilitiesProvider, null, createElement(BotSettingsDialog, { bot })));
  // The top bar holds only the controls; the name sits under the avatar.
  return html.match(/<div class="(content-topbar [^"]*)"/)?.[1] ?? "";
};

afterEach(() => vi.unstubAllGlobals());

describe("bot settings caption inset", () => {
  it("drops the close button below the Windows caption buttons", () => {
    vi.stubGlobal("window", { ogb: { platform: "win32" } });
    expect(header()).toContain("pt-[28px]");
  });

  it("keeps the header flush elsewhere", () => {
    vi.stubGlobal("window", { ogb: { platform: "darwin" } });
    const classes = header();
    expect(classes).toContain("h-12");
    expect(classes).not.toContain("pt-[28px]");
  });
});

describe("bot panel header and tabs", () => {
  const panel = () => {
    vi.stubGlobal("window", { ogb: { platform: "darwin" } });
    return renderToStaticMarkup(createElement(DesktopCapabilitiesProvider, null, createElement(BotSettingsDialog, { bot })));
  };

  it("edits the name and the label where they show, with no Name or Label field", () => {
    const html = panel();
    expect(html).toMatch(/<button[^>]*id="bot-settings-title"[^>]*data-inline-edit="text"/);
    expect(html).toContain(">Maily</span>");
    expect(html).toContain("Add a label");
    expect(html).not.toContain('id="bot-name-bot-1"');
    expect(html).not.toContain("Label (optional)");
  });

  it("centers the name with no (i) beside it, and shows the description under the label", () => {
    const html = panel();
    expect(html).not.toContain('data-description-info="button"');
    expect(html).toContain("Sorts the inbox.");
    expect(html).not.toContain('id="bot-instructions-bot-1"');
  });

  it("shows Details, Library, Computer and More, with Coding then Routines on Details", () => {
    const html = panel();
    const tabs = [...html.matchAll(/data-panel-tab="(\w+)"/g)].map((match) => match[1]);
    expect(tabs).toEqual(["details", "library", "computer", "more"]);
    expect(html.indexOf('data-bot-settings-section="coding"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-bot-settings-section="coding"')).toBeLessThan(html.indexOf('data-bot-settings-section="routines"'));
  });
});
