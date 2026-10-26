// Regression (2026-10-26): the foot lost its design of #935. #1014 (Composio
// removal) deleted the pill that showed the connected apps' logos and left a
// plain "Connect apps" text button, which ate the width and cut the name
// ("Jean-Christophe ..."). The foot must show the full name while the row has
// room, and the logos of the connected apps whenever there are some.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as Partial<AppState> }));
vi.mock("@/lib/routines-badge-preferences", () => ({ useShowRoutinesBadge: () => false }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: vi.fn() }) };
});

import { ConnectedAppsStack, FootConnectApps, SidebarFoot, nextFootMode } from "./SidebarFoot";
import { connectedAppItems } from "@/lib/connected-apps";

const apps = connectedAppItems({
  servers: [
    { name: "Gmail", enabled: true, url: "https://mail.google.com/mcp", auth: "connected" },
    { name: "Notion", enabled: true, url: "https://notion.so/mcp", auth: "connected" },
    { name: "Drive", enabled: true, url: "https://drive.google.com/mcp", auth: "connected" },
    { name: "Off", enabled: false, url: "https://off.example/mcp", auth: "connected" },
    { name: "Signin", enabled: true, url: "https://signin.example/mcp", auth: "required" },
  ],
});

describe("foot connected apps", () => {
  it("lists only the enabled, signed-in apps", () => {
    expect(apps.map((app) => app.name)).toEqual(["Gmail", "Notion", "Drive"]);
  });

  it("inline, the Connect apps button carries the logos and no words", () => {
    const html = renderToStaticMarkup(createElement(FootConnectApps, { apps, mode: "inline", onOpen: () => {} }));
    expect(html).toContain("data-connected-apps-stack");
    expect(html.match(/data-connected-app="/g)).toHaveLength(3);
    expect(html).not.toContain("data-connect-apps-label");
    expect(html).toContain("aria-label=");
  });

  it("stacked, the words come first and the logos follow", () => {
    const html = renderToStaticMarkup(createElement(FootConnectApps, { apps, mode: "stacked", onOpen: () => {} }));
    expect(html.indexOf("data-connect-apps-label")).toBeGreaterThan(-1);
    expect(html.indexOf("data-connect-apps-label")).toBeLessThan(html.indexOf("data-connected-apps-stack"));
  });

  it("shows at most three logos, and the generic icon when none is connected", () => {
    expect(renderToStaticMarkup(createElement(ConnectedAppsStack, { apps: [...apps, ...apps] })).match(/data-connected-app="/g)).toHaveLength(3);
    const none = renderToStaticMarkup(createElement(FootConnectApps, { apps: [], mode: "inline", onOpen: () => {} }));
    expect(none).not.toContain("data-connected-apps-stack");
    expect(none).toContain("lucide-puzzle");
  });
});

describe("foot mode", () => {
  it("keeps the full name inline while it fits", () => {
    expect(nextFootMode("inline", { width: 248, cut: 0, need: null }).mode).toBe("inline");
    expect(nextFootMode("inline", { width: 248, cut: 0, need: null }).mode).toBe("inline");
  });

  it("stacks as soon as the name is cut, and comes back once the row is as wide as it needed", () => {
    const stacked = nextFootMode("inline", { width: 248, cut: 30, need: null });
    expect(stacked).toEqual({ mode: "stacked", need: 278 });
    expect(nextFootMode("stacked", { width: 260, cut: 0, need: stacked.need }).mode).toBe("stacked");
    expect(nextFootMode("stacked", { width: 278, cut: 0, need: stacked.need }).mode).toBe("inline");
  });

  it("renders the name whole in the inline foot, beside the logos pill, never a text Connect apps button", () => {
    fixture.state = { config: { profile: { name: "Jean-Christophe Proulx" } } as AppState["config"] };
    vi.stubGlobal("window", {});
    const html = renderToStaticMarkup(createElement(SidebarFoot, { onOpenApps: () => {} }));
    vi.unstubAllGlobals();
    expect(html).toContain('data-foot-mode="inline"');
    expect(html).toContain(">Jean-Christophe Proulx</span>");
    expect(html).not.toContain("data-connect-apps-label");
  });

  it("the compact foot is sized so the default 280px sidebar keeps 'Jean-Christophe Proulx' whole", () => {
    // measured in a real browser (gallery ?view=foot&name=Jean-Christophe Proulx&apps=3,
    // 248px row): name pill ~195px, logos pill ~44px, one 6px gap
    const source = readFileSync(new URL("./SidebarFoot.tsx", import.meta.url), "utf8");
    expect(source).toContain("shrink-0 px-1");
    expect(source).toContain("-space-x-[9px]");
    expect(source).toContain("size-[15px]");
    expect(source).not.toContain("flex-wrap");
  });

  it("Sidebar.tsx lays the foot out with SidebarFoot, not a bare text button", () => {
    const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(source).toContain("<SidebarFoot");
  });
});
