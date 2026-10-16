import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom", () => ({ flushSync: (run: () => void) => run() }));

const { navigate } = await import("./view-transitions");

type Listener = () => void;
function fakeTransition() {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  return { finished, updateCallbackDone: Promise.resolve(), ready: Promise.resolve(), skipTransition: vi.fn(() => finish()), finish, types: new Set<string>() };
}

describe("navigate", () => {
  let dataset: Record<string, string>;
  let listeners: Map<string, Listener>;
  let reduced: boolean;
  let started: Array<{ update: () => void; types: string[] }>;
  let transitions: ReturnType<typeof fakeTransition>[];

  beforeEach(() => {
    dataset = {};
    listeners = new Map();
    reduced = false;
    started = [];
    transitions = [];
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: reduced }),
      addEventListener: (type: string, run: Listener) => listeners.set(type, run),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      documentElement: { dataset },
      startViewTransition: (options: { update: () => void; types: string[] }) => {
        started.push(options);
        const transition = fakeTransition();
        transitions.push(transition);
        // the browser runs the update once the old frame is captured
        queueMicrotask(options.update);
        return transition;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("runs the update inside a transition typed by direction and scope, and marks the root while it plays", async () => {
    const update = vi.fn();
    navigate(update, "back", "main");
    expect(update).not.toHaveBeenCalled();
    expect(started[0].types).toEqual(["nav-back", "nav-main"]);
    expect(dataset).toEqual({ nav: "main", navDirection: "back" });
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    transitions[0].finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dataset).toEqual({});
  });

  it("never holds input: a pointer, wheel or key press skips to the new state", () => {
    navigate(vi.fn());
    for (const type of ["pointerdown", "wheel", "keydown"]) expect(listeners.has(type)).toBe(true);
    listeners.get("pointerdown")!();
    expect(transitions[0].skipTransition).toHaveBeenCalled();
  });

  it("a second navigation skips the first", () => {
    navigate(vi.fn());
    navigate(vi.fn());
    expect(transitions[0].skipTransition).toHaveBeenCalled();
    expect(dataset.nav).toBe("main");
  });

  it("updates at once under reduced motion, without the API, or in a hidden window", () => {
    reduced = true;
    const first = vi.fn();
    navigate(first);
    expect(first).toHaveBeenCalledTimes(1);
    reduced = false;
    (document as { visibilityState: string }).visibilityState = "hidden";
    const second = vi.fn();
    navigate(second);
    expect(second).toHaveBeenCalledTimes(1);
    vi.stubGlobal("document", { visibilityState: "visible", documentElement: { dataset } });
    const third = vi.fn();
    navigate(third);
    expect(third).toHaveBeenCalledTimes(1);
    expect(started).toEqual([]);
  });

  it("the CSS names only the main column, takes no pointer events and stands still under reduced motion", () => {
    // A Windows checkout can hand the file over with CRLF line ends.
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(css).toContain('html[data-nav="main"] .app-content-frame {\n  view-transition-name: main-view;');
    expect(css).toMatch(/::view-transition \{\s*pointer-events: none;/);
    expect(css).toContain('html[data-nav-direction="back"]::view-transition-new(main-view)');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\),\s*::view-transition-old\(\*\),\s*::view-transition-new\(\*\) \{\s*animation: none !important;/);
  });

  it("main view switches go through it: a conversation or thread from the sidebar or the palette, ⌘1-9 and ⌘⇧[ ], closing Settings", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const sidebar = read("../components/Sidebar.tsx");
    expect(sidebar).toContain("const openConversation = () => navigate(() => {");
    expect(sidebar).toContain('navigate(() => dispatch({ type: "switchTask", botId: bot.id, threadId }))');
    expect(sidebar).toContain('onClick={() => navigate(() => dispatch({ type: "select", id: group.id }))}');
    expect(read("../components/CommandPalette.tsx")).toContain("navigate(() => openBot(dispatch, action.bot, showThreads))");
    const app = read("../App.tsx");
    expect(app).toContain("navigate(() => openBot(dispatch, target, showThreads))");
    expect(app).toContain('navigate(() => openBot(dispatch, next, showThreads), e.key === "]" ? "forward" : "back")');
    const settings = read("../components/SettingsModal.tsx");
    expect(settings).toContain('navigate(() => dispatch({ type: "toggleAppSettings", open: false }), "back", "page")');
    expect(settings).toContain("starting:scale-98 starting:opacity-0");
  });
});
