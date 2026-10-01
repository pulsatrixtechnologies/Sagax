import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./bot-settings/useSlackManagement", () => ({ useSlackManagementUrl: () => null }));
vi.mock("./bot-settings/useBotSettingsDerived", () => ({ useBotSettingsDerived: () => ({}) }));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return { ...store, useStore: () => ({ state: store.initialState, dispatch: vi.fn(), flushBotPatches: vi.fn() }) };
});
import { BotSettingsDialog } from "./BotSettingsDialog";
import { DesktopCapabilitiesProvider } from "./DesktopCapabilities";

const bot = { id: "bot-1", name: "Maily", title: "", description: "", messages: [], tasks: [] } as never as Bot;
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
