// @vitest-environment happy-dom
// Connect apps > Manage plugins and skills (2026-10-26): four tabs, one line
// per installed thing with a "..." menu, every empty section hidden, the
// connectors of the person's Claude account listed like Grok's, and nothing
// for an admin only.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { buildPluginItems } from "@/lib/plugins-model";
import { installedEntries, privateSkills } from "@/lib/installed-model";
import { GROK_CLOUD_CONNECTORS } from "../../../shared/grok-cloud-connectors";
import { bringsLabel, ManageView, type ManageViewProps } from "./ManageView";
import { HarnessConnectorGroups, connectorGroups } from "./HarnessConnectorGroups";
import { botServersAfter, botUsesServers } from "./BotsForView";

vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const servers = [
  { name: "twilio-docs", enabled: true, url: "https://mcp.twilio.com/docs", source: "twilio" },
  { name: "github", enabled: true, url: "https://api.githubcopilot.com/mcp/" },
  { name: "github-github", enabled: true, url: "https://api.githubcopilot.com/mcp/", source: "claude-plugins-official" },
];
const items = buildPluginItems({
  servers,
  skills: [{ name: "weekly-summary", description: "Mine", source: "local-import", enabled: true }],
  marketplaces: [{ name: "claude-plugins-official", plugins: [{ name: "github", installed: true, servers: ["github-github"], skills: [], updateAvailable: true }] }],
});
const noop = () => {};

function props(overrides: Partial<ManageViewProps> = {}): ManageViewProps {
  return {
    tab: "installed", onTab: noop, onBack: noop, entries: installedEntries(items), skills: privateSkills(items),
    sourceLabel: (source) => source, onOpenEntry: noop, onOpenSkill: noop, entryActions: () => ({ remove: noop }),
    refreshing: false, onRefresh: noop, ...overrides,
  };
}

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

describe("Manage plugins and skills", () => {
  it("has four tabs, Installed first, and no Advanced zone", () => {
    const html = renderToStaticMarkup(createElement(ManageView, props()));
    expect(html).toMatch(/id="plugins-title"[^>]*>Manage plugins and skills</);
    const tabs = [...html.matchAll(/role="tab"[^>]*data-plugins-tab="([a-z]+)"[^>]*>([^<]+)</g)].map((match) => [match[1], match[2]]);
    expect(tabs).toEqual([["installed", "Installed"], ["discover", "Discover"], ["accounts", "My accounts"], ["sources", "Sources"]]);
    expect(html).toMatch(/data-plugins-tab="installed"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-plugins-tab="installed"/);
    expect(html).not.toContain("data-plugins-advanced");
    expect(html).not.toContain("Advanced");
  });

  it("Installed: GitHub once, named for people, saying what it brings, then the private skills", () => {
    const html = renderToStaticMarkup(createElement(ManageView, props()));
    const names = [...html.matchAll(/data-installed-entry="[^"]+"[\s\S]*?truncate text-\[13px\] font-medium text-ink">([^<]+)</g)].map((match) => match[1]);
    expect(names).toEqual(["GitHub", "Twilio Docs"]);
    expect(html).not.toContain(">github-github<");
    expect(html).toMatch(/GitHub<\/span><span[^>]*data-installed-brings[^>]*>plugin \(claude-plugins-official\) · 1 connector</);
    expect(html).toMatch(/data-plugins-installed[\s\S]*data-plugins-skills[\s\S]*Private skills[\s\S]*weekly-summary/);
  });

  it("hides every empty section: no private skills, no list, no tools", () => {
    const html = renderToStaticMarkup(createElement(ManageView, props({ skills: [] })));
    expect(html).not.toContain("data-plugins-skills");
    expect(html).not.toContain("Private skills");
    expect(html).not.toContain("data-plugins-installed-tools");
    const empty = renderToStaticMarkup(createElement(ManageView, props({ entries: [], skills: [] })));
    expect(empty).not.toContain("data-plugins-installed");
    expect(empty).toContain("Nothing installed yet.");
    // a tab left out (no source route) is not drawn
    const noSources = renderToStaticMarkup(createElement(ManageView, props({ tabs: ["installed", "discover", "accounts"] })));
    expect(noSources).not.toContain('data-plugins-tab="sources"');
  });

  it("says nothing about an administrator", () => {
    for (const tab of ["installed", "discover", "accounts", "sources"] as const) {
      const html = renderToStaticMarkup(createElement(ManageView, props({ tab, discover: "D", accounts: "A", sources: "S" })));
      expect(html).not.toMatch(/administrator|admin/i);
    }
  });

  it("brings: app + connectors, plugin · skills", () => {
    expect(bringsLabel({ app: true, plugin: null, connectors: 2, skills: 0 })).toBe("app + 2 connectors");
    expect(bringsLabel({ app: false, plugin: "example-tools", connectors: 0, skills: 3 })).toBe("plugin (example-tools) · 3 skills");
    expect(bringsLabel({ app: false, plugin: null, connectors: 1, skills: 0 })).toBe("1 connector");
    setLocale("fr");
    expect(bringsLabel({ app: true, plugin: null, connectors: 2, skills: 0 })).toBe("app + 2 connecteurs");
  });
});

describe("the \"...\" menu of an entry", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });
  const click = (element: Element | null) => flushSync(() => (element as HTMLElement).click());

  it("offers Update, For which bots and Remove, and runs the chosen one", () => {
    const update = vi.fn();
    const bots = vi.fn();
    const remove = vi.fn();
    flushSync(() => root.render(createElement(ManageView, props({
      entryActions: (entry) => (entry.name === "GitHub" ? { update, bots, remove } : { bots }),
    }))));
    const github = host.querySelector('[data-installed-entry="plugin:github@claude-plugins-official"]')!;
    expect(github.querySelector("[data-entry-update-dot]")).not.toBeNull();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    click(github.querySelector("[data-entry-menu]"));
    const actions = [...host.querySelectorAll("[data-entry-action]")].map((node) => [node.getAttribute("data-entry-action"), node.textContent]);
    expect(actions).toEqual([["update", "Update"], ["bots", "For which bots"], ["remove", "Remove"]]);
    click(host.querySelector('[data-entry-action="bots"]'));
    expect(bots).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    // the other entry offers only what it can do
    click(host.querySelector('[data-installed-entry="mcp:twilio-docs"] [data-entry-menu]'));
    expect([...host.querySelectorAll("[data-entry-action]")].map((node) => node.getAttribute("data-entry-action"))).toEqual(["bots"]);
  });

  it("French labels", () => {
    setLocale("fr");
    flushSync(() => root.render(createElement(ManageView, props({ entryActions: () => ({ update: noop, bots: noop, remove: noop }) }))));
    click(host.querySelector("[data-entry-menu]"));
    expect([...host.querySelectorAll("[data-entry-action]")].map((node) => node.textContent)).toEqual(["Mettre à jour", "Pour quels bots", "Retirer"]);
    expect([...host.querySelectorAll('[role="tab"]')].map((node) => node.textContent)).toEqual(["Installés", "Découvrir", "Mes comptes", "Sources"]);
  });
});

describe("My accounts: the engines' connectors", () => {
  const claude = {
    available: true,
    connectors: [
      { name: "Gmail", status: "connected" as const },
      { name: "Google Drive", status: "connected" as const },
      { name: "Google Calendar", status: "connected" as const },
      { name: "Canva", status: "needs_auth" as const },
    ],
  };

  it("lists the Claude account's connectors like Grok's, grouped by engine, with real logos", () => {
    const html = renderToStaticMarkup(createElement(HarnessConnectorGroups, { groups: connectorGroups({ claude, grok: { connectors: GROK_CLOUD_CONNECTORS } }) }));
    expect(html).toMatch(/data-harness-group="claude"[\s\S]*Connectors of your Claude account[\s\S]*data-harness-group="grok"[\s\S]*Connectors of your Grok account/);
    for (const name of ["Gmail", "Google Drive", "Google Calendar", "Canva"]) expect(html).toContain(`data-harness-connector="claude:${name}"`);
    expect(html).toContain('data-harness-connector="grok:Outlook (Exchange)"');
    // Gmail, Drive and Calendar draw their product mark, not the Google "G"
    expect(html).toContain("gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png");
    expect(html).toContain("gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png");
    expect(html).toContain("gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png");
    expect(html).toMatch(/data-harness-connector="claude:Gmail"[\s\S]*?data-harness-status="connected"[^>]*>Connected</);
    expect(html).toMatch(/data-harness-connector="claude:Canva"[\s\S]*?data-harness-status="needs_auth"/);
    expect(html).toMatch(/data-harness-connector="grok:X"[\s\S]*?data-harness-status="managed"[^>]*>Managed on Grok</);
    expect(html).toContain("Manage on Claude");
    expect(html).toContain("Manage on Grok");
    expect(html).toContain("data-engine-capabilities");
  });

  it("hides an engine with no connector, and everything when none has one", () => {
    expect(connectorGroups({ claude: { available: false, connectors: [] }, grok: null })).toEqual([]);
    expect(connectorGroups({ claude: { available: true, connectors: [] }, grok: null })).toEqual([]);
    expect(connectorGroups({ claude, grok: null }).map((group) => group.id)).toEqual(["claude"]);
    expect(renderToStaticMarkup(createElement(HarnessConnectorGroups, { groups: [] }))).toBe("");
  });
});

describe("For which bots", () => {
  it("switches an entry's servers on one bot, keeping the bot's other choices", () => {
    const enabled = ["github", "github-github", "twilio-docs"];
    // a bot on every server: off for GitHub leaves the rest
    expect(botUsesServers(null, enabled, ["github", "github-github"])).toBe(true);
    expect(botServersAfter(null, enabled, ["github", "github-github"], false)).toEqual(["twilio-docs"]);
    expect(botUsesServers(["twilio-docs"], enabled, ["github", "github-github"])).toBe(false);
    expect(botServersAfter(["twilio-docs"], enabled, ["github", "github-github"], true)).toEqual(["twilio-docs", "github", "github-github"]);
    expect(botUsesServers(["github"], enabled, ["github", "github-github"])).toBe(false);
  });
});
