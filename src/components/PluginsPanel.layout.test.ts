import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPluginItems } from "@/lib/plugins-model";
import { ConnectAppsView } from "./plugins/ConnectAppsView";
import { ManageView } from "./plugins/ManageView";
import { ProvidersSection } from "./plugins/ProvidersSection";
import { PluginDetailView } from "./plugins/PluginDetailView";
import { SkillPage } from "./plugins/SkillPage";

const items = buildPluginItems({
  cards: [
    { slug: "slack", label: "Slack", blurb: "Post updates", logo: null, domain: "slack.com" },
    { slug: "notion", label: "Notion", blurb: "Pages", logo: null, domain: "notion.so" },
  ],
  status: { slack: { connected: true, accounts: [{ id: "a1", status: "ACTIVE" }] } },
  servers: [{ name: "glitcho", enabled: true, url: "https://qc1.example.net/mcp", auth: "connected" }],
  featured: [{ id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" }],
  skills: [{ name: "release-notes", description: "Writes notes", source: "local-import", enabled: true }],
});
const noop = () => {};
vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

beforeEach(() => vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop }));
afterEach(() => vi.unstubAllGlobals());

describe("Plugins panel views", () => {
  it("main view: Browse Bots' layout: title and subtitle, category pills, the search with N connected, sections of two-column rows", () => {
    const html = renderToStaticMarkup(createElement(ConnectAppsView, {
      items, loading: false, search: "", onSearch: noop, filter: "all", onFilter: noop,
      onOpenManage: noop, onOpenItem: noop, type: "any", onType: noop, extraConnected: 1,
      renderAction: (item) => item.action ? createElement("button", { type: "button" }, item.action === "connect" ? "Connect" : "Add") : null,
    }));
    expect(html).toContain("Connect apps");
    expect(html).toMatch(/id="plugins-title"[^>]*>Connect apps<\/h2><p class="[^"]*text-ink-secondary[^"]*">Apps, MCP servers and skills your bots can use\.</);
    // the home page has no breadcrumb
    expect(html).not.toContain("data-breadcrumb");
    // Slack, the glitcho server and one Claude connector
    expect(html).toContain("3 connected");
    expect(html).toContain('placeholder="Search across apps and skills"');
    expect(html).not.toContain("Browse Bots");
    // pills first, then the search with the connected count at its right
    expect(html).toMatch(/data-plugins-chips[\s\S]*?placeholder="Search across apps and skills"[\s\S]*?data-plugins-connected/);
    // All, then a pill per category that has a row; no Category menu any more
    const chips = [...html.matchAll(/aria-pressed="(?:true|false)"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(chips[0]).toBe("All");
    expect(chips.length).toBeGreaterThan(1);
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).not.toContain('aria-label="Refresh');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('data-plugins-section="recommended"');
    expect(html).toContain("Recommended for you");
    expect(html).toContain('data-plugins-section="mcp"');
    expect(html).toContain('data-plugins-section="skills"');
    expect(html).toContain("md:grid-cols-2");
    expect(html).toMatch(/data-plugin-row="featured:linear"[\s\S]*?>Connect</);
    expect(html).toMatch(/data-plugin-row="app:slack"[\s\S]*?data-plugin-status="connected"/);
  });

  it("main view: Browse Bots sits top right by the title, above N connected (2026-10-16)", () => {
    const props = {
      items, loading: false, search: "", onSearch: noop, filter: "all" as const, onFilter: noop,
      onOpenManage: noop, onOpenItem: noop, type: "any" as const, onType: noop,
      renderAction: () => null,
    };
    expect(renderToStaticMarkup(createElement(ConnectAppsView, props))).not.toContain("data-plugins-browse-bots");
    const html = renderToStaticMarkup(createElement(ConnectAppsView, { ...props, onBrowseBots: noop }));
    expect(html).toMatch(/<header[\s\S]*?id="plugins-title"[\s\S]*?data-plugins-browse-bots[\s\S]*?Browse Bots[\s\S]*?<\/header>/);
    expect(html).toMatch(/data-plugins-browse-bots[\s\S]*?placeholder="Search across apps and skills"[\s\S]*?data-plugins-connected/);
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

  it("manage page: back arrow, Add manually, installed cards with status, private skills", () => {
    const html = renderToStaticMarkup(createElement(ManageView, {
      items, countLabel: () => "1 connector", sourceLabel: (source) => source, onBack: noop, onOpenItem: noop,
      onAddManually: noop, onPasteConfig: noop, refreshing: false, onRefresh: noop,
    }));
    expect(html).toContain("Manage plugins and skills");
    // breadcrumb: back, Connect apps, then this page
    expect(html).toMatch(/data-breadcrumb[\s\S]*?aria-label="Back"[\s\S]*?>Connect apps<[\s\S]*?aria-current="page"[^>]*>Manage plugins and skills</);
    expect(html).toMatch(/data-plugin-card="app:slack"[\s\S]*?1 connector[\s\S]*?Connected/);
    expect(html).toContain('data-plugin-card="mcp:glitcho"');
    // Add manually, Paste config and the rest wait in a collapsed Advanced zone, after the skills
    expect(html).toMatch(/data-plugins-skills[\s\S]*<details[^>]*data-plugins-advanced[^>]*>[\s\S]*Advanced[\s\S]*Add manually[\s\S]*Paste config/);
    expect(html).not.toMatch(/<details[^>]*data-plugins-advanced[^>]*open/);
    expect(html).not.toContain('data-plugin-card="skill:');
    expect(html).toContain("Private skills");
    expect(html).toContain("Created locally · Writes notes");
  });

  it("manage page: a card that is not connected says so, muted", () => {
    const offline = buildPluginItems({ servers: [{ name: "vault", enabled: true, url: "https://vault.example.net/mcp", auth: "required" }] });
    const html = renderToStaticMarkup(createElement(ManageView, {
      items: offline, countLabel: () => "1 connector", sourceLabel: (source) => source, onBack: noop, onOpenItem: noop,
      onAddManually: noop, onPasteConfig: noop, refreshing: false, onRefresh: noop, onNewSkill: noop,
    }));
    expect(html).toMatch(/data-plugin-card="mcp:vault"[\s\S]*?data-plugin-status="needs_auth" class="[^"]*text-ink-secondary[^"]*">Not connected</);
    expect(html).toContain("New skill");
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

  it("manage page lists the providers under Advanced, with their honest line", () => {
    const html = renderToStaticMarkup(createElement(ManageView, {
      items, countLabel: () => "", sourceLabel: (source) => source, onBack: noop, onOpenItem: noop,
      onAddManually: noop, onPasteConfig: noop, refreshing: false, onRefresh: noop, providers: createElement("div", null, "PROVIDERS"),
    }));
    expect(html).not.toContain('role="tab"');
    expect(html).toMatch(/<details[^>]*data-plugins-advanced[^>]*>[\s\S]*data-plugins-manage="providers"[\s\S]*>Providers<[\s\S]*PROVIDERS/);
    const instances = [
      { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", account: { email: "jc@example.com" } } },
      { instanceId: "codex", driverKind: "codex", displayName: "Codex", snapshot: { state: "available" } },
      { instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", snapshot: { state: "available", authenticated: false } },
      { instanceId: "gemini", driverKind: "geminiAgent", displayName: "Gemini CLI", snapshot: { state: "available" } },
    ];
    const providers = renderToStaticMarkup(createElement(ProvidersSection, { instances: instances as never }));
    for (const id of ["claude", "openai", "xai", "google"]) expect(providers).toContain(`data-provider="${id}"`);
    expect(providers).toContain("jc@example.com");
    expect(providers).toContain('data-harness-connectors="provider"');
    expect(providers).toContain("Codex: ChatGPT connectors do not reach bots in Sagax.");
    expect(providers).toContain("Grok: its connectors do not reach bots in Sagax.");
    expect(providers).toContain("Gemini: Google&#x27;s extensions do not reach bots in Sagax.");
    expect(providers).toContain("Manage on ChatGPT / Codex");
  });
});
