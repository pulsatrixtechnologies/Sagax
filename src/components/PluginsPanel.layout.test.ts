import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPluginItems } from "@/lib/plugins-model";
import { GROK_CLOUD_CONNECTORS } from "../../shared/grok-cloud-connectors";
import { grokConnectorDetail, grokRowAction, openGrokConnectors } from "./PluginsPanel";
import { ConnectAppsView } from "./plugins/ConnectAppsView";
import { PluginDetailView } from "./plugins/PluginDetailView";
import { SkillPage } from "./plugins/SkillPage";

const items = buildPluginItems({
  servers: [{ name: "glitcho", enabled: true, url: "https://qc1.example.net/mcp", auth: "connected" }],
  featured: [{ id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" }],
  skills: [{ name: "release-notes", description: "Writes notes", source: "local-import", enabled: true }],
});
const noop = () => {};
vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

beforeEach(() => vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop }));
afterEach(() => vi.unstubAllGlobals());

describe("Plugins panel views", () => {
  it("main view: Grok's layout: title with N connected, category pills, the search, sections of two-column rows", () => {
    const html = renderToStaticMarkup(createElement(ConnectAppsView, {
      items, loading: false, search: "", onSearch: noop, filter: "all", onFilter: noop,
      onOpenManage: noop, onOpenItem: noop, type: "any", onType: noop, extraConnected: 1,
      renderAction: (item) => item.action ? createElement("button", { type: "button" }, item.action === "connect" ? "Connect" : "Add") : null,
    }));
    expect(html).toContain("Connect Apps");
    expect(html).not.toContain("Apps, MCP servers and skills your bots can use.");
    expect(html).toMatch(/id="plugins-title"[^>]*>Connect Apps<\/h2>[\s\S]*?data-plugins-connected/);
    // the home page has no breadcrumb
    expect(html).not.toContain("data-breadcrumb");
    // the glitcho server and one Claude connector
    expect(html).toContain("2 connected");
    expect(html).toContain('placeholder="Search across apps and skills"');
    expect(html).not.toContain("Browse Bots");
    // connected sits in the title row, above the pills and the search
    expect(html).toMatch(/data-plugins-connected[\s\S]*?data-plugins-chips[\s\S]*?placeholder="Search across apps and skills"/);
    const chips = [...html.matchAll(/aria-pressed="(?:true|false)"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(chips[0]).toBe("All");
    expect(chips).toContain("More");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('aria-label="Refresh');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('data-plugins-section="recommended"');
    expect(html).toContain("Recommended for you");
    expect(html).toContain('data-plugins-section="mcp"');
    expect(html).toContain('data-plugins-section="skills"');
    expect(html).toContain("md:grid-cols-2");
    expect(html).toMatch(/data-plugin-row="featured:linear"[\s\S]*?>Connect</);
    expect(html).toContain('data-plugin-row="mcp:glitcho"');
  });

  it("main view: Browse bots sits beside the search, and N connected stays in the title row", () => {
    const props = {
      items, loading: false, search: "", onSearch: noop, filter: "all" as const, onFilter: noop,
      onOpenManage: noop, onOpenItem: noop, type: "any" as const, onType: noop,
      renderAction: () => null,
    };
    expect(renderToStaticMarkup(createElement(ConnectAppsView, props))).not.toContain("data-plugins-browse-bots");
    const html = renderToStaticMarkup(createElement(ConnectAppsView, { ...props, onBrowseBots: noop }));
    expect(html).toMatch(/data-plugins-connected[\s\S]*?placeholder="Search across apps and skills"[\s\S]*?data-plugins-browse-bots[\s\S]*?Browse bots/);
    const header = html.slice(0, html.indexOf("</header>"));
    expect(header).not.toContain("data-plugins-browse-bots");
  });

  it("a section opened alone: breadcrumb Connect apps > the section, its title, no pills, no Browse Bots", () => {
    const html = renderToStaticMarkup(createElement(ConnectAppsView, {
      items, loading: false, search: "", onSearch: noop, filter: "all", onFilter: noop,
      onOpenManage: noop, onOpenItem: noop, type: "mcp", onBrowseBots: noop,
      renderAction: () => null,
      subpage: { title: "MCP servers", trail: [{ label: "Connect apps", onSelect: noop }], onBack: noop },
    }));
    expect(html).toMatch(/data-breadcrumb[\s\S]*?aria-label="Back"[\s\S]*?>Connect apps<[\s\S]*?aria-current="page"[^>]*>MCP servers</);
    expect(html).toMatch(/id="plugins-title"[^>]*>MCP servers</);
    expect(html).not.toContain("data-plugins-chips");
    expect(html).not.toContain("data-plugins-browse-bots");
    expect(html).toContain("data-plugins-connected");
  });

  it("skill page: header, Delete Skill in red, the description, then Name, Description, Instructions and Save", () => {
    const skill = { name: "release-notes", description: "Writes notes", source: "local-import", enabled: true, tags: [], version: null, importedAt: "2026-10-08T00:00:00Z", warnings: [], assignedBots: [] };
    const html = renderToStaticMarkup(createElement(SkillPage, { skill, onBack: noop, onSaved: noop, onDeleted: noop }));
    expect(html).toContain("Private skill");
    expect(html).toMatch(/data-skill-delete[^>]*class="[^"]*text-danger[^"]*"[\s\S]*?Delete Skill/);
    expect(html).not.toContain("Publish");
    expect(html).toContain("Writes notes");
    for (const field of ["name", "description", "instructions"]) expect(html).toContain(`data-skill-field="${field}"`);
    expect(html).toMatch(/type="submit"[^>]*>Save</);
    const readOnly = renderToStaticMarkup(createElement(SkillPage, { skill, readOnlyReason: "The plugin kit brought this skill: uninstall the plugin to remove it.", onBack: noop, onSaved: noop, onDeleted: noop }));
    expect(readOnly).not.toContain("Delete Skill");
    expect(readOnly).not.toContain('type="submit"');
  });

  it("detail page: the switch and one \"...\" menu by the name, accounts, collapsible tools, details", () => {
    const item = items.find((entry) => entry.key === "mcp:glitcho")!;
    const html = renderToStaticMarkup(createElement(PluginDetailView, {
      item, subtitle: "https://qc1.example.net/mcp", busy: false, onBack: noop, onUninstall: noop,
      enabled: { value: true, onToggle: noop, label: "Turn glitcho off" },
      accounts: [{ id: "oauth", label: "qc1.example.net", status: "connected" }],
      tools: { list: [{ name: "search", enabled: true }, { name: "delete", enabled: false }], loading: false, onToggle: noop },
      details: [{ label: "Source", value: "Added manually" }, { label: "Transport", value: "HTTP" }],
    }));
    expect(html).toContain('aria-label="Back"');
    // Turned on beside the name; Update, Test, Edit and Uninstall wait in the menu
    expect(html).toMatch(/data-plugin-enabled[^>]*>Turned on<button[^>]*aria-label="Turn glitcho off"/);
    expect(html).toContain('aria-label="More actions for glitcho"');
    expect(html).not.toContain("Uninstall");
    expect(html).toContain("Accounts");
    expect(html).toMatch(/qc1\.example\.net[\s\S]*?Connected/);
    expect(html).toContain("1 of 2 enabled");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Added manually");
    expect(html).toContain("HTTP");
  });

  it("xAI connectors are a catalog managed on Grok: no connect action or status, a Grok link, a separate row", () => {
    const withGrok = buildPluginItems({
      grok: { connectors: GROK_CLOUD_CONNECTORS, description: "Managed on Grok" },
    });
    const html = renderToStaticMarkup(createElement(ConnectAppsView, {
      items: withGrok, loading: false, search: "gmail", onSearch: noop, filter: "all", onFilter: noop,
      onOpenManage: noop, onOpenItem: noop, type: "any", onType: noop,
      renderAction: (item) => grokRowAction(item) ?? (item.action ? createElement("button", { type: "button" }, "Connect") : null),
    }));
    const row = (key: string) => {
      const start = html.indexOf(`data-plugin-row="${key}"`);
      expect(start).toBeGreaterThan(-1);
      const next = html.indexOf("data-plugin-row=", start + 1);
      return html.slice(start, next === -1 ? undefined : next);
    };
    const grokGmail = row("grok:gmail");
    expect(grokGmail).toContain("data-grok-manage");
    expect(grokGmail).toContain("Manage on Grok");
    expect(grokGmail).not.toContain("data-plugin-status");
    expect(grokGmail).not.toContain(">Connect<");

    const detail = renderToStaticMarkup(createElement(PluginDetailView, {
      ...grokConnectorDetail(withGrok.find((item) => item.key === "grok:gmail")!), onBack: noop,
    }));
    expect(detail).toContain("Managed on Grok");
    expect(detail).toContain("Grok (xAI)");
    expect(detail).toContain("data-grok-manage");
    expect(detail).not.toContain("No account needed");
    expect(detail).not.toContain('data-plugin-status="connected"');
  });

  it("Manage on Grok opens grok.com/connectors: the desktop bridge, the window's link path when the bridge refuses, an error to show when neither opens", async () => {
    const desktop = vi.fn(async () => true);
    const open = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop, ogb: { openExternal: desktop }, open });
    expect(await openGrokConnectors()).toBeNull();
    expect(desktop).toHaveBeenCalledWith("https://grok.com/connectors");
    expect(open).not.toHaveBeenCalled();
    vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop, ogb: { openExternal: vi.fn(async () => { throw new Error("not this window"); }) }, open });
    expect(await openGrokConnectors()).toBeNull();
    expect(open).toHaveBeenCalledWith("https://grok.com/connectors", "_blank", "noopener,noreferrer");
    vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop, open: vi.fn(() => { throw new Error("blocked"); }) });
    expect(await openGrokConnectors()).toBe("This link cannot be opened from here.");
    warn.mockRestore();
  });
});
