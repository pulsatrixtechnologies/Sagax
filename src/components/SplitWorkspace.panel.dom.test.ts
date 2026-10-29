// @vitest-environment happy-dom
// The split view's bot pill (#1601 follow-up): every bot section wears the
// main chat's pill, its click opens that bot's panel at the window edge
// nearest the section, and one panel shows at a time.
import { createContext, createElement, useContext, useReducer, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertSection, MAIN_LEAF, MAIN_LEAF_ID, resetSplitLayout, setSplitLayout, type SplitNode } from "@/lib/split-view";
import type { AppState, Bot } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real reducer behind a test store: the pill's actions run as in the app.
const TestStore = createContext<{ state: AppState; dispatch: (action: unknown) => void } | null>(null);
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  return { ...actual, useStore: () => useContext(TestStore)!, api: () => Promise.resolve({}) };
});
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
  useCaptionChrome: () => ({}),
  useMacInsetChrome: () => ({}),
}));
// Sections wait on their thread: the header (with its pill) is what is tested.
vi.mock("@/lib/use-side-transcript", () => ({
  useSideTranscript: () => ({ loaded: false, failed: false, messages: [], activeLeafId: null }),
}));

const { reducer, initialState } = await import("@/state/store");
const { SplitWorkspace, useBotPanelPlacement } = await import("./SplitWorkspace");

const bot = (id: string, name: string): Bot => ({ id, name, color: "blue", threadId: `${id}-t`, messages: [], hasMore: false } as unknown as Bot);
const bots = [bot("main-bot", "Main"), bot("scout", "Scout"), bot("pepper", "Pepper")];

/** Where App.tsx would draw the bot panel, as data attributes. */
function PanelProbe() {
  const { state } = useContext(TestStore)!;
  const { bot: panelBot, dock } = useBotPanelPlacement(bots[0]);
  const open = (state.settingsOpen || state.computerOpen) && panelBot;
  return createElement("div", { "data-probe": "", "data-open": open ? "yes" : "no", "data-bot": open ? panelBot!.id : "", "data-dock": open ? dock : "" });
}

function Harness({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, bots, selectedId: "main-bot", connected: true } as AppState);
  return createElement(TestStore.Provider, { value: { state, dispatch: dispatch as (action: unknown) => void } }, children);
}

let root: Root | null = null;
let host: HTMLElement;
const mount = (layout: SplitNode) => {
  setSplitLayout(layout);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Harness, null,
    createElement(SplitWorkspace, { main: createElement("main", { "data-test-main": "" }, "Main chat") }),
    createElement(PanelProbe),
  )));
};
const pill = (botId: string) => host.querySelector<HTMLButtonElement>(`[data-split-pane="bot:${botId}"] [data-bot-header-pill]`);
const probe = () => host.querySelector<HTMLElement>("[data-probe]")!.dataset;
const click = (element: Element | null) => act(() => { (element as HTMLElement).click(); });

beforeEach(() => {
  try { localStorage.clear(); } catch { /* none */ }
  resetSplitLayout();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  resetSplitLayout();
});

describe("a bot section's pill", () => {
  it("is the main chat's pill in every bot section, beside Open in main and Close", () => {
    const left = insertSection(MAIN_LEAF, { kind: "bot", botId: "scout" }, "left");
    mount(insertSection(left.layout, { kind: "bot", botId: "pepper" }, "right").layout);
    for (const id of ["scout", "pepper"]) {
      const header = host.querySelector(`[data-split-pane="bot:${id}"] [data-split-pane-header]`)!;
      const button = header.querySelector("[data-bot-header-pill]")!;
      expect(button.textContent).toContain(id === "scout" ? "Scout" : "Pepper");
      expect(button.querySelector("[data-bot-header-chevron]")).not.toBeNull();
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(header.querySelector("[data-split-open-main]")).not.toBeNull();
      expect(header.querySelector("[data-split-close]")).not.toBeNull();
    }
    expect(probe().open).toBe("no");
  });

  it("opens that bot's panel at the left edge for a section on the left, at the right for one on the right", () => {
    const left = insertSection(MAIN_LEAF, { kind: "bot", botId: "scout" }, "left");
    mount(insertSection(left.layout, { kind: "bot", botId: "pepper" }, "right").layout);
    click(pill("scout"));
    expect(probe()).toMatchObject({ open: "yes", bot: "scout", dock: "left" });
    expect(pill("scout")!.getAttribute("aria-expanded")).toBe("true");
    click(pill("pepper"));
    expect(probe()).toMatchObject({ open: "yes", bot: "pepper", dock: "right" });
    // One panel: the other section's pill shows it closed.
    expect(pill("scout")!.getAttribute("aria-expanded")).toBe("false");
    expect(pill("pepper")!.getAttribute("aria-expanded")).toBe("true");
    // A second click closes it.
    click(pill("pepper"));
    expect(probe().open).toBe("no");
  });

  it("closes its panel with its section", () => {
    const left = insertSection(MAIN_LEAF, { kind: "bot", botId: "scout" }, "left");
    mount(left.layout);
    click(pill("scout"));
    expect(probe()).toMatchObject({ open: "yes", bot: "scout", dock: "left" });
    click(host.querySelector(`[data-split-pane="bot:scout"] [data-split-close]`));
    expect(probe().open).toBe("no");
    expect(host.querySelector("[data-split-leaf]")).toBeNull();
  });

  it("leaves the main chat's panel at the right when no section opened it", () => {
    mount(MAIN_LEAF);
    expect(host.querySelector("[data-test-main]")).not.toBeNull();
    expect(host.querySelector(`[data-split-leaf="${MAIN_LEAF_ID}"]`)).toBeNull();
    expect(probe().open).toBe("no");
  });
});
