// @vitest-environment happy-dom
// Exercise the production entry point, including the menu closing while the
// Sidebar-owned dialog remains open. An unmounted picker export is not proof
// that a person can reach this workflow.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const access = vi.hoisted(() => ({ admin: true, advanced: true }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => access.admin }));
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(), useAdvancedMode: () => access.advanced,
}));
vi.mock("./DesktopCapabilities", async (original) => ({
  ...await original<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: false, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));

const { Sidebar } = await import("./Sidebar");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setLocale } = await import("@/lib/i18n");
const { setShowThreads, setThreadsLocation } = await import("@/lib/thread-preferences");
const bot: Bot = {
  id: "pepper", name: "Pepper", threadId: "current", title: "", description: "", color: "green", unread: false,
  notifications: true, messages: [], modelSelection: { instanceId: "test", model: "test" }, cwd: "/projects/default",
  // a second thread, so the list (and its menu) is drawn under the bot
  tasks: [{ threadId: "current", title: "Current thread", createdAt: 1 }, { threadId: "older", title: "Older thread", createdAt: 0 }],
};
const dispatch = vi.fn();
let host: HTMLDivElement;
let root: Root;
const render = () => flushSync(() => root.render(createElement(BotEditorStore, {
  value: { state: { ...initialState, connected: true, bots: [bot], selectedId: bot.id }, dispatch,
    flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} },
  children: createElement(Sidebar, { open: true, onClose: () => {} }),
})));
// Grok Bot's rows (JC, 2026-10-15): the thread list no longer unfolds
// under the bot, so New thread is in the bot's own menu (right click on the
// row). New thread in a working folder left that menu for 0.5.7.
const openMenu = () => {
  const row = document.querySelector<HTMLElement>('[data-sidebar-bot-row="pepper"]');
  flushSync(() => row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })));
};
const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === label);

beforeEach(() => {
  access.admin = true;
  access.advanced = true;
  dispatch.mockReset();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  setLocale("en");
  // whatever the location, the bot's menu holds the working-folder item
  setThreadsLocation("sidebar");
  // New thread lives in that menu with threads shown (off is the single
  // stream, whose menu says New topic)
  setShowThreads(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("working folder through the rendered sidebar", () => {
  it("leaves New thread in a working folder out of the bot menu, even for an admin in Advanced mode (0.5.7)", () => {
    render();
    openMenu();
    expect(menuItem("New thread")).toBeDefined();
    expect(menuItem("New thread in a working folder…")).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("retains one-click normal creation and hides explicit folders from chat-only sessions", () => {
    access.admin = false;
    render();
    openMenu();
    expect(menuItem("New thread in a working folder…")).toBeUndefined();
    flushSync(() => menuItem("New thread")!.click());
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "newTask", botId: bot.id });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps new-thread folder creation out of Simple mode", () => {
    access.advanced = false;
    render();
    openMenu();
    expect(menuItem("New thread in a working folder…")).toBeUndefined();
  });
});
