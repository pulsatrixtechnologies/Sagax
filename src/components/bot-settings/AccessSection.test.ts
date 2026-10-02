import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot, type ConfigStatus } from "@/state/store";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), mcpError: false, servers: null as null | Array<{ name: string; enabled: boolean }>, config: null as unknown, organization: false }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => (fixture.organization ? { org: { identity: { kind: "perspicax" } } } : null),
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: fixture.config ?? original.initialState.config }, dispatch: fixture.dispatch }) };
});
vi.mock("@/lib/mcp-servers", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mcp-servers")>(),
  useMcpServers: () => ({ servers: fixture.servers, error: fixture.mcpError, refresh: vi.fn() }),
}));

// DesktopCapabilities reads `window.ogb` at module scope for its context
// default; the src test suite runs under vitest's "node" environment (no
// window), so it must be stubbed the same way SidebarBotListItem.test.ts does.
vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { host: { homeDir: undefined } } }),
}));

const { AccessSection } = await import("./AccessSection");

// WorkingFolder (moved into this file) reads window.ogb?.pickFolder directly
// at render time, same "node" environment gap as above — stub per test, the
// way desktop.test.ts and EngineUpdateNotice.test.ts do.
beforeEach(() => { vi.stubGlobal("window", {}); fixture.dispatch.mockReset(); fixture.mcpError = false; fixture.servers = null; fixture.config = null; fixture.organization = false; });
afterEach(() => vi.unstubAllGlobals());

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Scout",
    title: "Scout",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

function makeDerived(overrides: Partial<ReturnType<typeof useBotSettingsDerived>> = {}): ReturnType<typeof useBotSettingsDerived> {
  return {
    patch: vi.fn(),
    engine: undefined,
    canCoordinate: false,
    canUseConnectedApps: true,
    canUseVps: false,
    connectedAppsConfigured: true,
    connectedAppsEnabled: true,
    canUseBrowser: false,
    desktopBrowser: false,
    browserBlockedOnWindows: false,
    browserFeature: true,
    browserAllowed: true,
    browserEnabled: false,
    browserSelectable: false,
    browserDisabledReason: "The built-in browser needs the Sagax desktop app",
    sectionName: "General",
    currentChief: undefined,
    botRoutines: [],
    activeBotRoutines: 0,
    localSelectable: false,
    localDisabledReason: null,
    activeState: "idle",
    mascotMotion: null,
    ...overrides,
  } as ReturnType<typeof useBotSettingsDerived>;
}

function render(bot: Bot, derived = makeDerived()) {
  return renderToStaticMarkup(
    createElement(StoreProvider, null, createElement(AccessSection, { bot, derived })),
  );
}

describe("AccessSection always-allowed list", () => {
  it("keeps per-bot MCP changes disabled while any task is active", () => {
    fixture.servers = [{ name: "notes", enabled: true }, { name: "offline", enabled: false }];
    const markup = render(makeBot({ busy: true, mcpServers: ["notes"] }));
    expect(markup).toContain('disabled="" aria-label="Let this bot use notes"');
    expect(markup).toContain('disabled="" aria-label="Let this bot use offline"');
    expect(markup).toMatch(/<button type="button" disabled=""[^>]*>Use every enabled server<\/button>/);
    expect(markup).toContain("finishes all active tasks");
    expect(markup).toContain("Individual tool approvals depend on the model provider and approval mode.");
    const idle = render(makeBot({ mcpServers: ["notes"] }));
    expect(idle).not.toContain('disabled="" aria-label="Let this bot use notes"');
    expect(idle).toContain('disabled="" aria-label="Let this bot use offline"');
    expect(idle).not.toContain("finishes all active tasks");
  });

  it("hides the bot's Connected apps switch while the experimental feature is off", () => {
    const off = render(makeBot());
    expect(off).not.toContain('aria-label="Allow this bot to use connected apps"');
    expect(off).not.toContain("Connect an app");
    fixture.config = { features: { connectedApps: false } };
    expect(render(makeBot())).not.toContain('aria-label="Allow this bot to use connected apps"');
    fixture.config = { features: { connectedApps: true }, composio: { configured: true } };
    const on = render(makeBot());
    expect(on).toContain('aria-label="Allow this bot to use connected apps"');
    expect(on).toContain("Connect an app");
  });

  it("opens the established app connection flow without authorizing a second way", () => {
    fixture.config = { features: { connectedApps: true }, composio: { configured: true } };
    let tree!: ReturnType<typeof AccessSection>;
    function Capture() { tree = AccessSection({ bot: makeBot(), derived: makeDerived() }); return tree; }
    renderToStaticMarkup(createElement(StoreProvider, null, createElement(Capture)));
    type Node = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
    const nodes = (value: ReactNode): Node[] => {
      if (!isValidElement(value)) return [];
      const node = value as Node;
      return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
    };
    const connect = nodes(tree).find((node) => node.type === "button" && renderToStaticMarkup(node).includes("Connect an app"))!;
    connect.props.onClick!();
    expect(fixture.dispatch.mock.calls).toEqual([
      [{ type: "toggleSettings", open: false }],
      [{ type: "togglePlugins", open: true, surface: "apps" }],
    ]);
  });

  it("offers a retry instead of a permanent MCP loading state after a read failure", () => {
    fixture.mcpError = true;
    fixture.servers = [{ name: "notes", enabled: true }];
    const markup = render(makeBot());
    expect(markup).toContain("Could not refresh MCP servers.");
    expect(markup).toContain("Retry");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('disabled="" aria-label="Let this bot use notes"');
  });

  it("shows a placeholder when nothing is standing yet", () => {
    const markup = render(makeBot());
    expect(markup).toContain("Nothing standing yet.");
  });

  it("lists each always-allowed entry with a Remove button", () => {
    const markup = render(makeBot({ alwaysAllow: ["shell.run", "fs.write"] }));
    expect(markup).toContain("shell.run");
    expect(markup).toContain("fs.write");
    expect(markup).toContain('aria-label="Remove shell.run from always allowed"');
    expect(markup).toContain('aria-label="Remove fs.write from always allowed"');
    expect(markup).not.toContain("Nothing standing yet.");
  });
});

describe("AccessSection Works on", () => {
  const places = (markup: string) => [...markup.matchAll(/>(Auto(?: \(Cloud\))?|Cloud computer|Cloud \(server environment\)|Local VM|This computer|Browser|Off)<\/button>/g)].map((match) => match[1]);
  const FLAGS = [{}, { boatComputer: true }, { vpsComputer: true }, { boatComputer: true, vpsComputer: true }];

  it("offers this computer and a Local VM on a desktop or self-hosted server", () => {
    // Cloud (Boat or VPS Computer) is experimental and off by default.
    expect(places(render(makeBot()))).toEqual(["Auto", "Local VM", "This computer", "Browser", "Off"]);
    fixture.config = { cloudHome: false } as Partial<ConfigStatus>;
    expect(places(render(makeBot()))).toEqual(["Auto", "Local VM", "This computer", "Browser", "Off"]);
    fixture.config = { cloudHome: false, features: { skillAuthoring: true, boatComputer: true } } as Partial<ConfigStatus>;
    expect(places(render(makeBot()))).toEqual(["Auto", "Cloud computer", "Local VM", "This computer", "Browser", "Off"]);
  });

  it("never offers them on an OMB Cloud home", () => {
    fixture.config = { cloudHome: true } as Partial<ConfigStatus>;
    expect(places(render(makeBot()))).toEqual(["Auto", "Cloud computer", "Browser", "Off"]);
  });

  it("has no Works on on an organization server: it lives in the bot's Computer tab", () => {
    fixture.organization = true;
    for (const features of FLAGS) {
      fixture.config = { features } as Partial<ConfigStatus>;
      const markup = render(makeBot());
      expect(places(markup)).toEqual([]);
      expect(markup).not.toContain("Works on");
      expect(markup).not.toContain("Cloud is your server environment.");
      expect(markup).not.toContain("Cloud backend");
    }
  });

  it("says why an option is disabled", () => {
    const markup = render(makeBot(), makeDerived({ localSelectable: false, localDisabledReason: "Local computer control requires the desktop app." }));
    expect(markup).toContain("This computer is not available: Local computer control requires the desktop app.");
    expect(markup).toContain("Browser is not available: The built-in browser needs the Sagax desktop app");
  });

  it("explains Auto and cloud computers on a solo server only when a cloud computer can be chosen", () => {
    expect(render(makeBot())).not.toContain("Auto and cloud computers.");
    fixture.config = { features: { boatComputer: true } } as Partial<ConfigStatus>;
    expect(render(makeBot())).toContain("Auto and cloud computers.");
  });
});
