// @vitest-environment happy-dom
// Connect Apps, the whole panel (PluginsPanel) driven the way the owner
// used it (2026-10-28): it opens on Discover, the first tab; the header has
// no "N connected" button and the count sits on Installed; the scope stays
// put on every tab; a click on the GitHub row (not its "...") opens its page
// inside Installed, with the title, the scope and the tabs kept and a back
// row; marketplace plugins wear their real mark; Providers shows a Claude
// section beside Grok even when Claude's connectors cannot be read, with the
// way to connect. The /api answers are a stand-in shaped like an
// organization member's (names neutral).
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

let harness: unknown;
const API: Record<string, unknown> = {
  "/api/mcp/servers": { servers: [
    { name: "twilio-docs", type: "http", url: "https://mcp.twilio.com/docs", enabled: true, source: "twilio", headerKeys: [], auth: "none" },
    { name: "github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, headerKeys: ["Authorization"], auth: "none" },
    { name: "github-github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, source: "claude-plugins-official", headerKeys: ["Authorization"], auth: "none" },
  ], reserved: [] },
  "/api/marketplaces": { marketplaces: [
    { name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", plugins: [
      { name: "github", description: "GitHub's MCP server", installed: true, servers: ["github-github"], skills: [], category: "development" },
      { name: "frontend-design", description: "Distinctive interfaces", installed: true, servers: [], skills: ["frontend-design"], category: "design", homepage: "https://design.example.com/plugin" },
      { name: "code-review", description: "Reviews a pull request", installed: true, servers: [], skills: ["code-review"], category: "development", homepage: "https://github.com/example/code-review" },
    ] },
    { name: "example-ops", source: "example-org/ops-marketplace", visibility: "org", plugins: [
      { name: "ops-flow", description: "Service desk routines", installed: true, servers: [], skills: ["triage"], category: "productivity", icon: "https://ops.example.com/icon.png" },
    ] },
  ] },
  "/api/skills-library": { skills: [
    { name: "frontend-design", description: "", source: "claude-plugins-official", enabled: true },
    { name: "code-review", description: "", source: "claude-plugins-official", enabled: true },
    { name: "triage", description: "", source: "example-ops", enabled: true },
  ] },
  "/api/plugins/search": { featured: [
    { id: "notion", name: "Notion", description: "Pages", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", site: "notion.so", auth: "oauth", category: "productivity" },
  ], results: [], nextCursor: null, registryAvailable: true },
  "/api/bots/bot-a/plugins": {
    marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", addedAt: 1, updatedAt: 1, plugins: [
      { name: "github", description: "GitHub's MCP server", installed: false, external: false, category: "development", contents: { agents: [], commands: [], skills: [] } },
    ] }],
    plugins: [], policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange: true,
  },
  "/api/pages": { pages: [{ id: "pg1", title: "Weekly KPIs", status: "published", access: "private", expiresAt: null, currentVersion: 1, botId: "bot-a", threadId: "t1", createdAt: 1, updatedAt: 2, expired: false, versions: [{ n: 1, kind: "html", title: "Weekly KPIs", createdAt: 1, state: "published", bytes: 10, botId: "bot-a" }] }] },
};

const dispatch = vi.fn();
const state = {
  pluginsSurface: "apps", pluginsPage: null, pluginsBotId: null, pluginsFocusApps: null, selectedId: "bot-a",
  groups: [],
  bots: [{ id: "bot-a", name: "Rocket", instanceId: "claude-main", ownerUserId: "p-1" }],
  instances: [{ instanceId: "grok-main", driverKind: "grokAgent", displayName: "Grok", access: "subscription", snapshot: { state: "available", authenticated: true } }],
  config: { viewer: { role: "member", principalId: "p-1" }, features: {} },
};
vi.mock("@/state/store", async () => {
  class ApiError extends Error { body?: unknown; }
  return {
    ApiError,
    useStore: () => ({ state, dispatch }),
    api: vi.fn(async (path: string) => {
      const pathname = path.split("?")[0]!;
      if (pathname === "/api/me/harness-connectors") return harness;
      if (pathname in API) return structuredClone(API[pathname]);
      throw new Error(`no stand-in for ${pathname}`);
    }),
  };
});
vi.mock("./lazy-screens", () => ({ BotCatalogPane: Object.assign(() => null, { preload: () => Promise.resolve() }) }));

const { PluginsPanel } = await import("./PluginsPanel");

let host: HTMLDivElement;
let root: Root;
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const click = async (element: HTMLElement | null) => {
  expect(element).not.toBeNull();
  await act(async () => { element!.click(); });
  await settle();
};
const tabs = () => [...host.querySelectorAll<HTMLElement>("[data-plugins-tab]")].map((tab) => `${tab.getAttribute("data-plugins-tab")}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`);

beforeEach(async () => {
  // any raw request (no server here) answers 404 at once
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "test" }), { status: 404, headers: { "content-type": "application/json" } })));
  setLocale("en");
  harness = { manageUrl: "https://claude.ai/customize/connectors", claude: { available: true, connectors: [{ name: "Gmail", status: "connected" }, { name: "Canva", status: "needs_auth" }] }, codex: { available: false } };
  dispatch.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const open = async () => {
  await act(async () => { root.render(createElement(PluginsPanel)); });
  await settle();
};

describe("Connect Apps, driven like the owner did", () => {
  it("Pages is a tab of its own: Your pages there, and nothing about pages left in Providers", async () => {
    await open();
    expect($('[data-plugins-tab="providers"] [data-plugins-tab-label]')?.textContent).toBe("Providers");
    expect($('[data-plugins-tab="pages"] [data-plugins-tab-label]')?.textContent).toBe("Pages");
    expect($('[data-plugins-tab="accounts"]')).toBeNull();
    await click($('[data-plugins-tab="providers"]'));
    expect($("[data-plugins-pages]")).toBeNull();
    expect($('[data-plugins-manage="providers"]')?.textContent).not.toContain("Your pages");
    expect($('[data-plugins-manage="providers"] [data-settings-card="pages"]')).toBeNull();
    await click($('[data-plugins-tab="pages"]'));
    expect($('[data-plugins-manage="pages"] [data-settings-card="pages"]')).not.toBeNull();
    expect($('[data-plugins-manage="pages"]')?.textContent).toContain("Your pages");
    expect($('[data-plugins-manage="pages"]')?.textContent).toContain("Weekly KPIs");
    // personal like Providers: the install scope is shown turned off there too
    expect($("[data-plugins-scope-slot]")).not.toBeNull();
  });

  it("opens on Discover, the first tab; the header has no N connected button; the counts sit on the tabs", async () => {
    await open();
    expect(tabs()).toEqual(["discover*", "installed", "providers", "pages", "sources"]);
    expect($("[data-plugins-connected]")).toBeNull();
    expect(host.querySelector("header")?.textContent).not.toMatch(/connected/i);
    // GitHub, Code Review, Frontend Design, Ops Flow, Twilio Docs: five connected entries
    expect($('[data-plugins-tab="installed"] [data-plugins-tab-count]')?.textContent).toBe("5");
    // the Claude account's one connected connector, on Providers
    expect($('[data-plugins-tab="providers"] [data-plugins-tab-count]')?.textContent).toBe("1");
    expect($('[data-plugins-tab="discover"] [data-plugins-tab-count]')).toBeNull();
  });

  it("an old link to My accounts opens Providers; a link to the pages opens Pages", async () => {
    try {
      (state as { pluginsPage: string | null }).pluginsPage = "accounts";
      await open();
      expect(tabs()).toEqual(["discover", "installed", "providers*", "pages", "sources"]);
      await act(async () => root.render(createElement("div")));
      (state as { pluginsPage: string | null }).pluginsPage = "pages";
      await open();
      expect(tabs()).toEqual(["discover", "installed", "providers", "pages*", "sources"]);
      expect($('[data-plugins-manage="pages"]')?.textContent).toContain("Your pages");
    } finally {
      (state as { pluginsPage: string | null }).pluginsPage = null;
    }
  });

  it("keeps the scope under the title on every tab", async () => {
    await open();
    for (const tab of ["installed", "discover", "providers", "pages", "sources"]) {
      if (!$(`[data-plugins-tab="${tab}"]`)) continue;
      await click($(`[data-plugins-tab="${tab}"]`));
      expect($("[data-plugins-scope-bar]"), tab).not.toBeNull();
      expect($("[data-plugins-scope-slot]")?.nextElementSibling, tab).toBeNull();
    }
  });

  it("Installed: as many rows as its counter, each with its real mark; the puzzle only without one", async () => {
    await open();
    await click($('[data-plugins-tab="installed"]'));
    const rows = [...host.querySelectorAll<HTMLElement>("[data-installed-entry]")];
    expect(rows.map((row) => row.querySelector("span.font-medium")?.textContent)).toEqual(["Code Review", "Frontend Design", "GitHub", "Ops Flow", "Twilio Docs"]);
    expect(String(rows.length)).toBe($('[data-plugins-tab="installed"] [data-plugins-tab-count]')?.textContent);
    const mark = (name: string) => {
      const row = rows.find((candidate) => candidate.querySelector("span.font-medium")?.textContent === name)!;
      const img = row.querySelector("img");
      return img ? img.getAttribute("src") : row.querySelector("svg.lucide-puzzle") ? "puzzle" : "other";
    };
    expect(mark("GitHub")).toContain("github.com");
    expect(mark("Frontend Design")).toContain("design.example.com");
    expect(mark("Ops Flow")).toBe("https://ops.example.com/icon.png");
    // a homepage that is only its repository on a code host is not its mark
    expect(mark("Code Review")).toBe("puzzle");
  });

  it("a click on the GitHub row itself opens its page inside Installed: title, scope and tabs kept, a back row, the name once", async () => {
    await open();
    await click($('[data-plugins-tab="installed"]'));
    const row = [...host.querySelectorAll<HTMLElement>("[data-installed-entry] button[aria-label]")].find((button) => button.textContent?.includes("GitHub"))!;
    await click(row);
    expect($("[data-plugins-subpage]")).not.toBeNull();
    expect($("#plugins-title")?.textContent).toBe("Connect Apps");
    expect($("[data-plugins-scope-bar]")).not.toBeNull();
    expect(tabs()).toEqual(["discover", "installed*", "providers", "pages", "sources"]);
    expect($('[data-plugins-tab="installed"]')?.getAttribute("aria-current")).toBe("page");
    expect($("[data-plugins-page-bar]")?.textContent).toContain("Installed");
    expect($("[data-plugins-detail-name]")?.textContent).toBe("GitHub");
    expect($("[data-plugins-detail-head] img")).not.toBeNull();
    expect($("[data-plugins-detail-meta]")?.textContent).toMatch(/^github · anthropics\/claude-plugins-official/);
    expect([...host.querySelectorAll("[data-install-state]")].map((state) => state.textContent)).toEqual(["Installed for everyone", "Not installed on Rocket"]);
    // the scope of the bot: its main action beside the name
    await click($('[data-plugins-scope-option="bot"]'));
    expect($("[data-plugins-subpage]")).not.toBeNull();
    expect($("[data-plugins-detail-primary]")?.textContent).toBe("Install for Rocket");
    // back to the list
    await click($("[data-plugins-back]"));
    expect($("[data-plugins-subpage]")).toBeNull();
    expect($('[data-plugins-manage="installed"]')).not.toBeNull();
  });

  it("Providers: Claude beside Grok when its connectors cannot be read, with why and Connect Claude", async () => {
    harness = { manageUrl: "https://claude.ai/customize/connectors", claude: { available: false, reason: "not_signed_in", connectors: [] }, codex: { available: false } };
    await open();
    await click($('[data-plugins-tab="providers"]'));
    const pills = [...host.querySelectorAll("[data-accounts-service-pill]")].map((pill) => pill.textContent);
    expect(pills.slice(0, 4)).toEqual(["All", "GitHub", "Claude", "Grok"]);
    expect([...host.querySelectorAll("[data-harness-group]")].map((group) => group.getAttribute("data-harness-group"))).toEqual(["claude", "grok"]);
    expect($('[data-harness-group="claude"]')?.textContent).toContain("Connectors of your Claude account");
    expect($('[data-harness-notice="not_signed_in"]')?.textContent).toContain("not signed in to Claude");
    await click($('[data-harness-setup="claude"]'));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "togglePlugins", open: false }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "toggleAppSettings", open: true, section: "engines" }));
  });

  it("Providers: the Claude account's connectors listed like Grok's when they are read", async () => {
    await open();
    await click($('[data-plugins-tab="providers"]'));
    expect($('[data-harness-connector="claude:Gmail"]')).not.toBeNull();
    expect($('[data-harness-connector="claude:Canva"] [data-harness-status="needs_auth"]')).not.toBeNull();
    expect($('[data-harness-group="claude"] [data-harness-notice]')).toBeNull();
  });

  it("GitHub lives in Providers: Sources lists marketplaces only, and the GitHub plugin's page leads to the account it reads", async () => {
    const servers = (API["/api/mcp/servers"] as { servers: Array<Record<string, unknown>> }).servers;
    const plugin = servers.find((server) => server.name === "github-github")!;
    plugin.github = "missing";
    try {
      await open();
      await click($('[data-plugins-tab="sources"]'));
      expect($("[data-plugins-marketplaces]")).not.toBeNull();
      expect($("[data-accounts-github]")).toBeNull();
      expect($("[data-github-credentials]")).toBeNull();
      expect($('[data-plugins-manage="sources"]')?.textContent).not.toContain("Your GitHub account");
      await click($('[data-plugins-tab="installed"]'));
      const row = [...host.querySelectorAll<HTMLElement>("[data-installed-entry] button[aria-label]")].find((button) => button.textContent?.includes("GitHub"))!;
      await click(row);
      expect($('[data-plugin-github-account="missing"]')?.textContent).toContain("It uses your GitHub account, which is not connected yet.");
      await click($('[data-plugin-github-account] button'));
      expect(tabs()).toEqual(["discover", "installed", "providers*", "pages", "sources"]);
      expect($('[data-accounts-service-pill="github"]')?.getAttribute("aria-pressed")).toBe("true");
      expect($("[data-accounts-github]")).not.toBeNull();
      expect($("[data-harness-group]")).toBeNull();
    } finally {
      delete plugin.github;
    }
  });
});
