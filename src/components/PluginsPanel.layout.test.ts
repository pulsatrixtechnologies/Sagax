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
  it("main view: title, connected count, search, chips and sections of two-column rows", () => {
    const html = renderToStaticMarkup(createElement(ConnectAppsView, {
      items, loading: false, search: "", onSearch: noop, filter: "all", onFilter: noop, refreshing: false, onRefresh: noop, onClose: noop,
      onOpenManage: noop, onOpenItem: noop, type: "any", onType: noop, onBotTemplates: noop, extraConnected: 1,
      renderAction: (item) => item.action ? createElement("button", { type: "button" }, item.action === "connect" ? "Connect" : "Add") : null,
    }));
    expect(html).toContain("Connect apps");
    // Slack, the glitcho server and one Claude connector
    expect(html).toContain("3 connected");
    expect(html).toContain('placeholder="Search across apps and skills"');
    expect(html).toMatch(/data-plugins-bot-templates[^>]*>Bot templates<svg/);
    // the reference's chips, in its order; types are not chips
    const chips = [...html.matchAll(/aria-pressed="(?:true|false)"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(chips).toEqual(["All", "Password managers", "Productivity", "Communication", "Design", "Code"]);
    expect(html).toMatch(/aria-haspopup="menu"[^>]*>More</);
    expect(html).not.toMatch(/aria-pressed="false"[^>]*>(Connected apps|MCP servers|Skills)</);
    expect(html).toMatch(/data-plugins-type[\s\S]*?All types/);
    // no top-level Connected apps / MCP servers tabs any more
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('data-plugins-section="recommended"');
    expect(html).toContain("Recommended for you");
    expect(html).toContain('data-plugins-section="mcp"');
    expect(html).toContain('data-plugins-section="skills"');
    expect(html).toContain("md:grid-cols-2");
    expect(html).toMatch(/data-plugin-row="featured:linear"[\s\S]*?>Connect</);
    expect(html).toMatch(/data-plugin-row="app:slack"[\s\S]*?data-plugin-status="connected"/);
  });

  it("manage page: back arrow, Add manually, installed cards with status, private skills", () => {
    const html = renderToStaticMarkup(createElement(ManageView, {
      items, countLabel: () => "1 connector", sourceLabel: (source) => source, onBack: noop, onClose: noop, onOpenItem: noop,
      onAddManually: noop, onPasteConfig: noop, refreshing: false, onRefresh: noop,
    }));
    expect(html).toContain("Manage plugins and skills");
    expect(html).toContain('aria-label="Back to Connect apps"');
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
      items: offline, countLabel: () => "1 connector", sourceLabel: (source) => source, onBack: noop, onClose: noop, onOpenItem: noop,
      onAddManually: noop, onPasteConfig: noop, refreshing: false, onRefresh: noop, onNewSkill: noop,
    }));
    expect(html).toMatch(/data-plugin-card="mcp:vault"[\s\S]*?data-plugin-status="needs_auth" class="[^"]*text-ink-secondary[^"]*">Not connected</);
    expect(html).toContain("New skill");
  });

  it("skill page: header, Delete Skill in red, the description, then Name, Description, Instructions and Save", () => {
    const skill = { name: "release-notes", description: "Writes notes", source: "local-import", enabled: true, tags: [], version: null, importedAt: "2026-10-08T00:00:00Z", warnings: [], assignedBots: [] };
    const html = renderToStaticMarkup(createElement(SkillPage, { skill, onBack: noop, onClose: noop, onSaved: noop, onDeleted: noop }));
    expect(html).toContain("Private skill");
    expect(html).toMatch(/data-skill-delete[^>]*class="[^"]*text-danger[^"]*"[\s\S]*?Delete Skill/);
    expect(html).not.toContain("Publish");
    expect(html).toContain("Writes notes");
    for (const field of ["name", "description", "instructions"]) expect(html).toContain(`data-skill-field="${field}"`);
    expect(html).toMatch(/type="submit"[^>]*>Save</);
    const readOnly = renderToStaticMarkup(createElement(SkillPage, { skill, readOnlyReason: "The plugin kit brought this skill: uninstall the plugin to remove it.", onBack: noop, onClose: noop, onSaved: noop, onDeleted: noop }));
    expect(readOnly).not.toContain("Delete Skill");
    expect(readOnly).not.toContain('type="submit"');
  });

  it("detail page: header with Uninstall, accounts, collapsible tools, details", () => {
    const item = items.find((entry) => entry.key === "mcp:glitcho")!;
    const html = renderToStaticMarkup(createElement(PluginDetailView, {
      item, subtitle: "https://qc1.example.net/mcp", busy: false, onBack: noop, onClose: noop, onUninstall: noop,
      enabled: { value: true, onToggle: noop, label: "Turn glitcho off" },
      accounts: [{ id: "oauth", label: "qc1.example.net", status: "connected" }],
      tools: { list: [{ name: "search", enabled: true }, { name: "delete", enabled: false }], loading: false, onToggle: noop },
      details: [{ label: "Source", value: "Added manually" }, { label: "Transport", value: "HTTP" }],
    }));
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain("Uninstall");
    expect(html).toContain("Accounts");
    expect(html).toMatch(/qc1\.example\.net[\s\S]*?Connected/);
    expect(html).toContain("1 of 2 enabled");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Added manually");
    expect(html).toContain("HTTP");
  });

  it("manage page has a Providers tab listing every provider with its honest line", () => {
    const html = renderToStaticMarkup(createElement(ManageView, {
      items, countLabel: () => "", sourceLabel: (source) => source, onBack: noop, onClose: noop, onOpenItem: noop,
      onAddManually: noop, onPasteConfig: noop, refreshing: false, onRefresh: noop, providers: createElement("div", null, "PROVIDERS"),
    }));
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Plugins and skills</);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>Providers</);
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
