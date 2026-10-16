// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Box } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const dispatch = vi.fn();
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => null,
}));
vi.mock("@/lib/mcp-servers", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mcp-servers")>(),
  useMcpServers: () => ({ servers: [{ name: "github", enabled: true }], error: false, refresh: async () => [] }),
}));

const { DevPods, DevPodsToggle } = await import("./DevPods");
const { DevPod } = await import("./PodCard");
const { registerDevPod, unregisterDevPod } = await import("./registry");
const { DEFAULT_PREFS, resetDevPodPrefsForTest, resetDevPodsLiveForTest } = await import("./prefs");

let seq = 0;
const tool = (name: string, summary: string, output = ""): Message => ({ id: `m${++seq}`, role: "bot", kind: "activity", at: seq, tool: { name, ok: true, summary, output } });
const devMessages = (): Message[] => [
  { id: `m${++seq}`, role: "user", kind: "text", text: "open a PR for the fix", at: seq },
  tool("Edit", "src/lib/auth.ts"),
  tool("Bash", "git commit -m \"Fix login\"", "[feat/login 1a2b3c4] Fix login"),
  tool("Bash", "gh pr create --title \"Fix login\"", "https://github.com/acme/app/pull/7"),
];
const bot = (threadId: string, messages: Message[]): Bot => ({
  id: "dev", threadId, name: "Dev", title: "", description: "", color: "green", notifications: true, unread: false,
  messages, modelSelection: { instanceId: "x", model: "m" }, cwd: "/Users/me/acme-app",
  tasks: [{ threadId, title: "T", createdAt: 1, busy: false, activity: "idle", usage: { input: 1, output: 1, costUsd: null, turns: 1, context: { tokens: 170_000, window: 200_000 } } }],
} as Bot);

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe() { this.callback(); }
  disconnect() {}
}

let container: HTMLDivElement;
let root: Root;
let paneWidth = 1800;

beforeEach(() => {
  setLocale("en");
  resetDevPodPrefsForTest({ ...DEFAULT_PREFS });
  resetDevPodsLiveForTest();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return paneWidth; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 900; } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  paneWidth = 1800;
});

function renderPane(props: { bot: Bot }) {
  act(() => {
    root.render(createElement("div", null,
      createElement("header", null, createElement(DevPodsToggle, { bot: props.bot })),
      createElement("div", { "data-pane": "" },
        createElement("div", { "data-transcript": "", className: "mx-auto w-full max-w-[960px]" }),
        createElement(DevPods, { bot: props.bot, messages: props.bot.messages, composerHeight: 120, computerStart: undefined, dispatch }))));
  });
}

describe("dev pods: Experimental switch", () => {
  it("renders nothing at all, not even the header button, while the switch is off", () => {
    const b = bot("off-thread", devMessages());
    renderPane({ bot: b });
    expect(container.querySelector("[data-dev-pods]")).toBeNull();
    expect(container.querySelector("[data-dev-pods-toggle]")).toBeNull();
    expect(container.querySelector("[data-pane]")!.innerHTML).toBe(container.querySelector("[data-transcript]")!.outerHTML);
  });

  it("shows the pods in the gutter once on, for development work only", () => {
    resetDevPodPrefsForTest({ ...DEFAULT_PREFS, enabled: true });
    renderPane({ bot: bot("chat-thread", [{ id: "c1", role: "user", kind: "text", text: "hello", at: 1 }]) });
    expect(container.querySelector("[data-dev-pods]")).toBeNull();

    renderPane({ bot: bot("dev-thread", devMessages()) });
    const rail = container.querySelector<HTMLElement>("[data-dev-pods]")!;
    expect(rail.dataset.open).toBe("true");
    expect(rail.dataset.mode).toBe("rail");
    expect(rail.style.right).toBe("16px");
    const ids = [...rail.querySelectorAll<HTMLElement>("[data-dev-pod]")].map((node) => node.dataset.devPod);
    expect(ids).toEqual(["environment", "context", "connectors", "changes"]);
    expect(rail.querySelector("[data-env-branch]")!.textContent).toContain("feat/login");
    expect(rail.querySelector("[data-context-bar]")!.getAttribute("data-context-bar")).toBe("danger");
    expect(rail.querySelector("[data-change='pull:acme/app#7']")).not.toBeNull();
    expect(container.querySelector("[data-dev-pods-toggle]")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("hides itself on a narrow pane and floats from the header button until Escape", () => {
    resetDevPodPrefsForTest({ ...DEFAULT_PREFS, enabled: true });
    paneWidth = 1100;
    renderPane({ bot: bot("narrow-thread", devMessages()) });
    const rail = () => container.querySelector<HTMLElement>("[data-dev-pods]")!;
    expect(rail().dataset.open).toBe("false");
    expect(rail().dataset.mode).toBe("overlay");
    const toggle = container.querySelector<HTMLButtonElement>("[data-dev-pods-toggle]")!;
    act(() => toggle.click());
    expect(rail().dataset.open).toBe("true");
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(rail().dataset.open).toBe("false");
  });

  it("stays dismissed for that conversation only", () => {
    resetDevPodPrefsForTest({ ...DEFAULT_PREFS, enabled: true, dismissed: ["dev:gone-thread"] });
    renderPane({ bot: bot("gone-thread", devMessages()) });
    expect(container.querySelector<HTMLElement>("[data-dev-pods]")!.dataset.open).toBe("false");
    renderPane({ bot: bot("other-thread", devMessages()) });
    expect(container.querySelector<HTMLElement>("[data-dev-pods]")!.dataset.open).toBe("true");
  });
});

describe("dev pods: each pod on its own", () => {
  const ctx = { bot: bot("iso", []), task: undefined, messages: [], threadKey: "dev:iso", computerStart: undefined, dispatch };
  const chrome = (onPresence = vi.fn()) => ({
    collapsed: false, onToggleCollapsed: vi.fn(), onPresence,
    actions: { canMoveUp: false, canMoveDown: false, onMoveUp: vi.fn(), onMoveDown: vi.fn(), onHide: vi.fn(), onDismissThread: vi.fn() },
  });

  it("a pod that throws shows its own error card and the next pod still renders", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const healthy = { id: "ok", order: 1, title: () => "Healthy", icon: Box, collapsible: true, useData: () => ({ status: "ready" as const, data: "fine" }), Body: ({ data }: { data: unknown }) => createElement("p", { "data-healthy": "" }, String(data)) };
    const brokenData = { ...healthy, id: "bad-data", title: () => "Broken data", useData: () => { throw new Error("boom"); } };
    const brokenBody = { ...healthy, id: "bad-body", title: () => "Broken body", Body: () => { throw new Error("boom"); } };
    const presence = vi.fn();
    act(() => {
      root.render(createElement("div", null,
        createElement(DevPod, { definition: brokenData, ctx, chrome: chrome(presence) }),
        createElement(DevPod, { definition: healthy, ctx, chrome: chrome(presence) }),
        createElement(DevPod, { definition: brokenBody, ctx, chrome: chrome(presence) })));
    });
    expect(container.querySelector("[data-healthy]")!.textContent).toBe("fine");
    const errors = container.querySelectorAll("[data-pod-state='error']");
    expect(errors).toHaveLength(2);
    expect(errors[0]!.textContent).toContain(t("devPods.error"));
    expect(presence).toHaveBeenCalledWith("bad-data", true);
    expect(presence).toHaveBeenCalledWith("ok", true);
    warn.mockRestore();
    error.mockRestore();
  });

  it("an empty pod renders nothing and says so", () => {
    const presence = vi.fn();
    const empty = { id: "empty", order: 1, title: () => "Empty", icon: Box, collapsible: true, useData: () => ({ status: "empty" as const }), Body: () => null };
    act(() => { root.render(createElement(DevPod, { definition: empty, ctx, chrome: chrome(presence) })); });
    expect(container.innerHTML).toBe("");
    expect(presence).toHaveBeenCalledWith("empty", false);
  });

  it("a pod registered by a new file joins the rail", () => {
    resetDevPodPrefsForTest({ ...DEFAULT_PREFS, enabled: true });
    registerDevPod({ id: "zz-extra", order: 99, title: () => "Extra", icon: Box, collapsible: false, useData: () => ({ status: "ready", data: 1 }), Body: () => createElement("p", { "data-extra": "" }, "extra") });
    try {
      renderPane({ bot: bot("extra-thread", devMessages()) });
      expect(container.querySelector("[data-dev-pod='zz-extra'] [data-extra]")).not.toBeNull();
    } finally {
      unregisterDevPod("zz-extra");
    }
  });
});
