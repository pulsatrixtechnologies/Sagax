// Audit (2026-10-22, JC): every switch of Settings > Appearance and
// Experimental features must change what it claims. Per switch, two checks:
// the setter really stores the new value, and the consumer reads the same
// preference (so the screen reacts). toggle -> consumer table: the PR body.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectedAppsEnabled } from "@/lib/feature-flags";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function memory() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}
let local: ReturnType<typeof memory>;
beforeEach(() => { vi.resetModules(); local = memory(); vi.stubGlobal("localStorage", local); });
afterEach(() => vi.unstubAllGlobals());

describe("local switches: setter stores, consumer reads", () => {
  const table: Array<[string, string, string, string, string, string]> = [
    // toggle, module, setter, consumer file, consumer symbol
    ["Show the run card", "lib/run-card-preferences", "setShowRunCard", "components/ChatView.tsx", "useShowRunCard", ""],
    ["Show the inspector button", "lib/inspector-preferences", "setShowInspectorButton", "components/ChatView.tsx", "useShowInspectorButton", ""],
    ["Show unconfigured providers", "lib/unready-providers-preference", "setShowUnreadyProviders", "components/ModelPicker.tsx", "useShowUnreadyProviders", ""],
    ["Sidebar logo", "lib/sidebar-logo-preferences", "setShowSidebarLogo", "components/Sidebar.tsx", "useShowSidebarLogo", ""],
    ["Routines badge", "lib/routines-badge-preferences", "setShowRoutinesBadge", "components/SidebarProfileMenu.tsx", "useShowRoutinesBadge", ""],
    ["Show suggestions", "lib/panel-visibility", "setShowSuggestions", "components/bot-settings/SuggestionsSection.tsx", "useShowSuggestions", ""],
    ["Show All history", "lib/panel-visibility", "setShowAllHistory", "components/bot-settings/ActivitySection.tsx", "useShowAllHistory", ""],
    ["Conversation threads", "lib/thread-preferences", "setShowThreads", "components/ThreadChip.tsx", "useShowThreads", ""],
  ];
  for (const [name, module, setter, consumer, symbol] of table) {
    it(`${name}: ${setter} stores both values and ${consumer} uses ${symbol}`, async () => {
      const m = (await import(`@/${module}`)) as Record<string, (on: boolean) => void>;
      m[setter]!(true);
      const on = JSON.stringify([...local.map]);
      m[setter]!(false);
      expect(JSON.stringify([...local.map])).not.toBe(on);
      expect(read(consumer)).toContain(symbol);
    });
  }
});

describe("Connected apps switch (server feature)", () => {
  it("reads features.connectedApps, true only when switched on", () => {
    expect(connectedAppsEnabled({ features: { connectedApps: true } })).toBe(true);
    expect(connectedAppsEnabled({ features: { connectedApps: false } })).toBe(false);
    expect(connectedAppsEnabled(null)).toBe(false);
  });

  it("hides the Connect apps pill everywhere it is drawn when off", () => {
    const sidebar = read("components/Sidebar.tsx");
    expect(sidebar).toContain("const connectedApps = connectedAppsEnabled(state.config);");
    // rail (icon) and wide foot, both gated
    expect(sidebar).toContain("{connectedApps && <SidebarConnectApps iconOnly");
    expect(sidebar).toContain("{connectedApps && <SidebarConnectApps onOpen=");
    expect((sidebar.match(/<SidebarConnectApps/g) ?? []).length).toBe(2);
    // the pill under the last message
    const chat = read("components/ChatView.tsx");
    expect(chat).toContain("{connectedAppsEnabled(state.config) && <ConversationConnectApps");
    expect((chat.match(/<ConversationConnectApps/g) ?? []).length).toBe(1);
  });
});

describe("other switches and their consumers", () => {
  const rows: Array<[string, string, string]> = [
    ["Use bot color as accent", "App.tsx", "useBotAccent"],
    ["Hardware acceleration / spellcheck / bot hotkeys", "../electron/desktop-shell-preferences.mjs", "hardwareAcceleration"],
    ["Desktop mascot switches", "components/floating-bots/FloatingBots.tsx", "floatingBotPrefs"],
    ["Dev context pods", "components/dev-pods/DevPods.tsx", "useDevPodPrefs"],
    ["Skill authoring", "components/Composer.tsx", "skillAuthoringEnabled"],
    ["Built-in browser", "components/ComputerPanel.tsx", "builtInBrowserEnabled"],
    ["Data window", "components/DataWindowButton.tsx", "dataWindowEnabled"],
    ["Decision model", "components/SettingsModal.tsx", "decisionModelEnabled"],
    ["Show tool calls", "components/ChatView.tsx", "showToolCallsEnabled"],
    ["Simple or Advanced", "components/BotSettingsDialog.tsx", "useAdvancedMode"],
  ];
  for (const [name, file, symbol] of rows) {
    it(`${name}: ${file} reads ${symbol}`, () => expect(read(file)).toContain(symbol));
  }
});
