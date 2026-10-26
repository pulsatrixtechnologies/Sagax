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

import { ConnectedAppsStack, FootConnectApps, SidebarFoot, footExpanded, nextFootMode } from "./SidebarFoot";
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
    // stacked, the label is never cut: it does not shrink and the pill never
    // gets narrower than its content (a really narrow row wraps instead)
    expect(source).toContain("min-w-max flex-1");
    expect(source).toContain('data-connect-apps-label="" className="shrink-0 whitespace-nowrap"');
    expect(source).not.toContain("truncate");
  });

  it("Sidebar.tsx lays the foot out with SidebarFoot, not a bare text button", () => {
    const source = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");
    expect(source).toContain("<SidebarFoot");
  });
});

describe("foot hover expand", () => {
  const named = () => {
    fixture.state = { config: { profile: { name: "Jean-Christophe Proulx" } } as AppState["config"] };
    vi.stubGlobal("window", {});
  };

  it("expands only in the inline state, for either control", () => {
    expect(footExpanded("apps", "inline")).toBe(true);
    expect(footExpanded("update", "inline")).toBe(true);
    expect(footExpanded(null, "inline")).toBe(false);
    expect(footExpanded("apps", "stacked")).toBe(false);
  });

  it("at rest the foot is the normal state: no hot mark, no words in the apps pill", () => {
    named();
    const html = renderToStaticMarkup(createElement(SidebarFoot, { onOpenApps: () => {} }));
    vi.unstubAllGlobals();
    expect(html).not.toContain("data-foot-hot");
    expect(html).not.toContain("data-connect-apps-label");
    expect(html).toContain(">Jean-Christophe Proulx</span>");
  });

  it("hovered (or focused), the apps pill is expanded with its words and the row is marked hot", () => {
    named();
    const html = renderToStaticMarkup(createElement(SidebarFoot, { onOpenApps: () => {}, defaultHot: "apps" }));
    vi.unstubAllGlobals();
    expect(html).toContain('data-foot-hot="apps"');
    expect(html).toContain("data-connect-apps-label");
    expect(html).toMatch(/data-sidebar-connect-apps=""[^>]*data-expanded=""/);
  });

  it("the update button hovered marks the row hot without expanding the apps pill", () => {
    named();
    const html = renderToStaticMarkup(createElement(SidebarFoot, { onOpenApps: () => {}, defaultHot: "update" }));
    vi.unstubAllGlobals();
    expect(html).toContain('data-foot-hot="update"');
    expect(html).not.toContain("data-connect-apps-label");
  });

  it("the expanded apps button is a hover target, a keyboard target and leaves cleanly", () => {
    const html = renderToStaticMarkup(createElement(FootConnectApps, { apps, mode: "inline", expanded: true, onOpen: () => {}, onHot: () => {} }));
    expect(html).toContain("data-connect-apps-label");
    expect(html.indexOf("data-connect-apps-label")).toBeLessThan(html.indexOf("data-connected-apps-stack"));
    const source = readFileSync(new URL("./SidebarFoot.tsx", import.meta.url), "utf8");
    for (const handler of ["onMouseEnter", "onMouseLeave", "onFocus", "onBlur"]) expect(source).toContain(handler);
    const update = readFileSync(new URL("./SidebarUpdatePill.tsx", import.meta.url), "utf8");
    for (const handler of ["onMouseEnter", "onMouseLeave", "onFocus", "onBlur"]) expect(update).toContain(handler);
  });

  it("animates over 200 ms with ease, through the reduced-motion aware duration", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toContain("[data-sidebar-account-row][data-foot-hot] [data-foot-profile]");
    expect(css).toContain("transition-duration: var(--transition-duration-moderate)");
    expect(css).toMatch(/--transition-duration-moderate: 200ms/);
    expect(css).toMatch(/\[data-reduced-motion="true"\] \{[^}]*--transition-duration-moderate: 0\.01ms/);
  });

  it("the real logos of the connected apps: the catalog mark is lent to a server whose address is the MCP host", () => {
    const withLogo = connectedAppItems({
      servers: [{ name: "Gmail", enabled: true, url: "https://gmailmcp.googleapis.com/mcp", auth: "connected" }],
      featured: [{ id: "gmail", name: "Gmail", description: "", url: "https://gmailmcp.googleapis.com/mcp", domain: "gmailmcp.googleapis.com", site: "mail.google.com", auth: "oauth", installed: true, iconUrl: "https://cdn.example/gmail.svg" }],
    });
    expect(withLogo).toHaveLength(1);
    expect(withLogo[0]!.logo).toBe("https://cdn.example/gmail.svg");
    expect(withLogo[0]!.domain).toBe("mail.google.com");
    const html = renderToStaticMarkup(createElement(ConnectedAppsStack, { apps: withLogo }));
    expect(html).toContain('src="https://cdn.example/gmail.svg"');
    expect(html).not.toContain("lucide-puzzle");
  });
});
