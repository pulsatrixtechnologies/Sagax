// @vitest-environment happy-dom
// Connect apps, one page with four tabs (2026-10-27; Manage plugins and
// skills of 2026-10-26 moved up): one line per installed thing with a "..."
// menu, every empty section hidden, the connectors of the person's engine
// accounts listed by engine with a pill per service, no "What your engines
// reach" panel, and every GitHub setting in Sources (the organization's
// part for an admin only, as before).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { buildPluginItems } from "@/lib/plugins-model";
import { installedEntries, privateSkills } from "@/lib/installed-model";
import { GROK_CLOUD_CONNECTORS } from "../../../shared/grok-cloud-connectors";
import { bringsLabel, InstalledView, type InstalledViewProps } from "./InstalledView";
import { ConnectAppsView, connectedCounts, normalizeConnectAppsTab, CONNECT_APPS_TABS, connectAppsTabLabel } from "./ConnectAppsView";
import { HarnessConnectorGroups, connectorGroups, noticeAction } from "./HarnessConnectorGroups";
import { AccountsView, accountServices } from "./AccountsView";
import { SourcesView } from "./SourcesView";
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

function props(overrides: Partial<InstalledViewProps> = {}): InstalledViewProps {
  return {
    entries: installedEntries(items), skills: privateSkills(items),
    sourceLabel: (source) => source, onOpenEntry: noop, onOpenSkill: noop, entryActions: () => ({ remove: noop }),
    onDiscover: noop, ...overrides,
  };
}
const ManageView = InstalledView;

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

describe("Connect apps tabs", () => {
  const shell = (tab: "installed" | "discover" | "providers" | "pages" | "sources") => renderToStaticMarkup(createElement(ConnectAppsView, {
    tab, onTab: noop, refreshing: false, onRefresh: noop,
    installed: createElement(InstalledView, props()), discover: "D", providers: "A", pages: "G", sources: "S",
  }));

  it("no N connected button: its count sits on Installed and Providers (2026-10-28)", () => {
    const entries = installedEntries(items);
    // GitHub (three rows folded into one) and Twilio Docs: two entries, as Installed shows them
    expect(connectedCounts({ entries, engineConnected: 3 })).toEqual({ installed: 2, providers: 3 });
    expect(connectedCounts({ entries: [], engineConnected: 0 })).toEqual({});
    const html = renderToStaticMarkup(createElement(ConnectAppsView, { tab: "discover", onTab: noop, counts: { installed: 6, providers: 3 }, refreshing: false, onRefresh: noop }));
    expect(html).not.toContain("data-plugins-connected");
    expect(html).not.toMatch(/\d+ connected</);
    expect(html).toMatch(/aria-label="Installed, 6 connected"[^>]*data-plugins-tab="installed"[\s\S]*?data-plugins-tab-count="6"/);
    expect(html).toMatch(/aria-label="Providers, 3 connected"[^>]*data-plugins-tab="providers"/);
    // no counter where nothing is connected
    expect(html).not.toMatch(/data-plugins-tab="discover"[^>]*>[\s\S]*?data-plugins-tab-count[\s\S]*?data-plugins-tab="installed"/);
  });

  it("has four tabs on the Connect Apps page itself, and no Advanced zone", () => {
    const html = shell("installed");
    expect(html).toMatch(/id="plugins-title"[^>]*>Connect Apps</);
    const tabs = [...html.matchAll(/role="tab"[^>]*data-plugins-tab="([a-z]+)"[^>]*><span data-plugins-tab-label="[^"]*">([^<]+)</g)].map((match) => [match[1], match[2]]);
    expect(tabs).toEqual([["discover", "Discover"], ["installed", "Installed"], ["providers", "Providers"], ["pages", "Pages"], ["sources", "Sources"]]);
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
    expect(empty).not.toContain("data-plugins-installed=");
    expect(empty).not.toMatch(/data-plugins-installed(?!-)/);
    expect(empty).toContain("Nothing installed yet.");
    expect(empty).toContain("data-plugins-go-discover");
  });

  it("says nothing about an administrator to a member", () => {
    for (const tab of ["installed", "discover", "providers", "pages", "sources"] as const) {
      expect(shell(tab)).not.toMatch(/administrator|admin/i);
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
    flushSync(() => root.render(createElement(ConnectAppsView, { tab: "installed", onTab: noop, counts: { installed: 2 }, refreshing: false, onRefresh: noop })));
    expect([...host.querySelectorAll('[role="tab"]')].map((node) => node.textContent)).toEqual(["Découvrir", "Installés2", "Fournisseurs", "Pages", "Sources"]);
    expect(host.querySelector('[data-plugins-tab="installed"]')?.getAttribute("aria-label")).toBe("Installés, 2 connectés");
  });
});

describe("Providers: the engines' connectors", () => {
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
    // 2026-10-27: no "What your engines reach" panel; each card names its service
    expect(html).not.toContain("data-engine-capabilities");
    expect(html).not.toContain("What your engines reach");
    expect(html).toMatch(/data-harness-connector="grok:Outlook \(Exchange\)"[\s\S]*?data-connector-capabilities[^>]*>Email · Calendar</);
    expect(html).toContain("data-harness-grok-note");
  });

  it("a ChatGPT group shows only once the server lists that account's connectors", () => {
    expect(connectorGroups({ codex: { available: false } }).map((group) => group.id)).toEqual(["claude", "grok"]);
    const groups = connectorGroups({ claude, codex: { available: true, connectors: [{ name: "Notion", status: "connected" }] } });
    expect(groups.map((group) => [group.id, group.name])).toEqual([["claude", "Claude"], ["grok", "Grok"], ["codex", "ChatGPT"]]);
  });

  it("Providers: a pill per service, one click shows only that one", () => {
    const groups = connectorGroups({ claude, grok: { connectors: GROK_CLOUD_CONNECTORS } });
    expect(accountServices(groups, true)).toEqual(["all", "claude", "grok", "servers"]);
    expect(accountServices(groups.slice(0, 1), false)).toEqual([]);
    const html = renderToStaticMarkup(createElement(AccountsView, { groups, servers: "MY-SERVERS" }));
    const pills = [...html.matchAll(/data-accounts-service-pill="([^"]+)"[^>]*>([^<]+)</g)].map((match) => [match[1], match[2]]);
    expect(pills).toEqual([["all", "All"], ["claude", "Claude"], ["grok", "Grok"], ["servers", "My MCP servers"]]);
    expect(html).toContain("MY-SERVERS");
    expect(html).not.toContain("Your connections");
    expect(html).not.toContain("GitHub");
  });

  it("Claude and Grok never vanish: a section with no connector says why and how to connect (2026-10-28)", () => {
    const notice = (input: Parameters<typeof connectorGroups>[0]) => connectorGroups(input).map((group) => [group.id, group.notice ? (group.notice.kind === "unavailable" ? group.notice.reason : group.notice.kind) : group.connectors.length]);
    // still reading, then the reasons the server gives
    expect(notice({ claude: null, claudeLoading: true, grok: null })).toEqual([["claude", "loading"], ["grok", "no_account"]]);
    expect(notice({ claude: null, claudeLoading: false, grok: null })).toEqual([["claude", "unknown"], ["grok", "no_account"]]);
    for (const reason of ["not_signed_in", "key", "no_engine", "not_operator", "managed_policy", "unknown"] as const) {
      expect(notice({ claude: { available: false, reason, connectors: [] }, grok: { connectors: GROK_CLOUD_CONNECTORS } })[0]).toEqual(["claude", reason]);
    }
    expect(notice({ claude: { available: true, connectors: [] }, grok: null })[0]).toEqual(["claude", "empty"]);
    expect(notice({ claude, grok: null })).toEqual([["claude", 4], ["grok", "no_account"]]);
    // what each offers: sign in for a missing account, check again when Claude did not answer
    expect(noticeAction({ kind: "unavailable", reason: "not_signed_in" })).toBe("setup");
    expect(noticeAction({ kind: "unavailable", reason: "key" })).toBe("setup");
    expect(noticeAction({ kind: "unavailable", reason: "unknown" })).toBe("retry");
    expect(noticeAction({ kind: "no_account" })).toBe("setup");
    expect(noticeAction({ kind: "loading" })).toBeNull();
    expect(renderToStaticMarkup(createElement(HarnessConnectorGroups, { groups: [] }))).toBe("");
  });

  it("Providers with a Grok account and a Claude sign-in the server could not read: both sections, the Claude pill, the reason and the way to connect", () => {
    const groups = connectorGroups({ claude: { available: false, reason: "not_signed_in", connectors: [] }, grok: { connectors: GROK_CLOUD_CONNECTORS } });
    const html = renderToStaticMarkup(createElement(AccountsView, { groups, servers: "MY-SERVERS", onSetUp: noop }));
    const pills = [...html.matchAll(/data-accounts-service-pill="([^"]+)"[^>]*>([^<]+)</g)].map((match) => match[2]);
    expect(pills).toEqual(["All", "Claude", "Grok", "My MCP servers"]);
    expect(html).toMatch(/data-harness-group="claude"[\s\S]*?Connectors of your Claude account[\s\S]*?Manage on Claude[\s\S]*?data-harness-notice="not_signed_in"[\s\S]*?not signed in to Claude[\s\S]*?data-harness-setup="claude"[^>]*>Connect Claude</);
    expect(html).toMatch(/data-harness-group="grok"[\s\S]*?data-harness-connector="grok:/);
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

describe("Providers and Sources: a click on a service pill, GitHub in Providers", () => {
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

  it("Grok alone: its connectors only, no other engine, no servers, no pages", () => {
    const groups = connectorGroups({ claude: { available: true, connectors: [{ name: "Gmail", status: "connected" }] }, grok: { connectors: GROK_CLOUD_CONNECTORS } });
    flushSync(() => root.render(createElement(AccountsView, { groups, servers: createElement("div", { "data-servers": "" }) })));
    flushSync(() => (host.querySelector('[data-accounts-service-pill="grok"]') as HTMLElement).click());
    expect(host.querySelector("[data-accounts-service]")?.getAttribute("data-accounts-service")).toBe("grok");
    expect(host.querySelector('[data-harness-group="grok"]')).not.toBeNull();
    expect(host.querySelector('[data-harness-group="claude"]')).toBeNull();
    expect(host.querySelector("[data-servers]")).toBeNull();
    flushSync(() => (host.querySelector('[data-accounts-service-pill="all"]') as HTMLElement).click());
    expect(host.querySelector('[data-harness-group="claude"]')).not.toBeNull();
    expect(host.querySelector("[data-servers]")).not.toBeNull();
  });

  it("Sources: the marketplaces only, then the organization's part marked for admins; no GitHub section", () => {
    const html = renderToStaticMarkup(createElement(SourcesView, { marketplaces: "MARKETS", organization: "ORG" }));
    expect(html).toMatch(/data-plugins-sources[\s\S]*MARKETS[\s\S]*data-plugins-sources-admin[\s\S]*Organization sources and access[\s\S]*Admins only[\s\S]*ORG/);
    expect(html).not.toContain("GitHub");
    expect(html).not.toContain("data-accounts-github");
    const member = renderToStaticMarkup(createElement(SourcesView, { marketplaces: "MARKETS" }));
    expect(member).not.toContain("data-plugins-sources-admin");
    expect(member).not.toMatch(/admin/i);
  });

  it("Providers: GitHub is a service of its own, first; in All one card, opened on its pill with the account and the other credentials", () => {
    const groups = connectorGroups({ claude: { available: true, connectors: [{ name: "Gmail", status: "connected" }] } });
    flushSync(() => root.render(createElement(AccountsView, { groups, github: createElement("div", { "data-github-here": "" }), githubSummary: "Connected as @octo", servers: createElement("div", { "data-servers": "" }) })));
    const pills = [...host.querySelectorAll("[data-accounts-service-pill]")].map((pill) => pill.getAttribute("data-accounts-service-pill"));
    expect(pills).toEqual(["all", "github", "claude", "grok", "servers"]);
    // All: the card only (its name, the account, Open), not the section
    expect(host.querySelector("[data-github-here]")).toBeNull();
    const card = host.querySelector("[data-plugins-github-card]")!;
    expect(card.textContent).toContain("GitHub");
    expect(card.textContent).toContain("Connected as @octo");
    expect(card.textContent).toContain("Open GitHub");
    expect(host.querySelector('[data-harness-group="claude"]')).not.toBeNull();
    // Open GitHub: the pill, its whole content, nothing else
    flushSync(() => (host.querySelector("[data-plugins-github-open]") as HTMLElement).click());
    expect(host.querySelector("[data-accounts-service]")?.getAttribute("data-accounts-service")).toBe("github");
    expect(host.querySelector("[data-github-here]")).not.toBeNull();
    expect(host.querySelector("[data-plugins-github-card]")).toBeNull();
    expect(host.querySelector('[data-harness-group="claude"]')).toBeNull();
    expect(host.querySelector("[data-servers]")).toBeNull();
    flushSync(() => (host.querySelector('[data-accounts-service-pill="all"]') as HTMLElement).click());
    expect(host.querySelector("[data-github-here]")).toBeNull();
    expect(host.querySelector("[data-plugins-github-card]")).not.toBeNull();
  });

  it("Providers: a link to GitHub (the parent's service) opens its card", () => {
    flushSync(() => root.render(createElement(AccountsView, { groups: connectorGroups({}), github: createElement("div", { "data-github-here": "" }), service: "github", onService: () => {} })));
    expect(host.querySelector("[data-github-here]")).not.toBeNull();
    expect(host.querySelector("[data-plugins-github-card]")).toBeNull();
  });

});

describe("Providers (once My accounts) and Pages: names and old links", () => {
  it("the tab is named for the providers, Pages has its own tab", () => {
    expect(CONNECT_APPS_TABS).toEqual(["discover", "installed", "providers", "pages", "sources"]);
    expect(connectAppsTabLabel("providers")).toBe("Providers");
    expect(connectAppsTabLabel("pages")).toBe("Pages");
    setLocale("fr");
    try {
      expect(connectAppsTabLabel("providers")).toBe("Fournisseurs");
      expect(connectAppsTabLabel("pages")).toBe("Pages");
    } finally {
      setLocale("en");
    }
  });

  it("the old tab id and the old link lead to Providers; Pages and the rest stay", () => {
    expect(normalizeConnectAppsTab("accounts")).toBe("providers");
    for (const tab of CONNECT_APPS_TABS) expect(normalizeConnectAppsTab(tab)).toBe(tab);
    expect(normalizeConnectAppsTab("nope")).toBeNull();
    expect(normalizeConnectAppsTab(null)).toBeNull();
  });

  it("Providers no longer draws the pages", () => {
    const html = renderToStaticMarkup(createElement(AccountsView, { groups: [] }));
    expect(html).not.toContain("data-plugins-pages");
    expect(accountServices([], false, false)).toEqual([]);
  });
});
