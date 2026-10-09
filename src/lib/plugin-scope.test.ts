import { describe, expect, it } from "vitest";

import type { BotPluginsView } from "./my-connections";
import { botPluginState, botScopeMarketplaces, initialPluginScope, marketplaceRoute, pluginScopeBot } from "./plugin-scope";

const view: BotPluginsView = {
  marketplaces: [{
    name: "acme-tools", source: "acme/tools", addedAt: 1, updatedAt: 1,
    plugins: [
      { name: "reviewer", description: "Reviews code", installed: true, external: false, contents: { agents: ["critic"], commands: ["review"], skills: ["style"] } },
      { name: "linter", installed: false, external: true },
    ],
  }],
  plugins: [{ key: "reviewer@acme-tools", name: "reviewer", marketplace: "acme-tools", enabled: true, removed: ["hooks"], declaredMcpServers: [] }],
  policy: { mode: "any" },
  engine: { loadsPlugins: true },
  canChange: true,
};

describe("plugin scope", () => {
  const bots = [{ id: "maya" }, { id: "rex" }];

  it("is about the bot a bot panel sent the person with, else the open conversation", () => {
    expect(pluginScopeBot({ pluginsBotId: "rex", selectedId: "maya", bots })?.id).toBe("rex");
    expect(pluginScopeBot({ pluginsBotId: null, selectedId: "maya", bots })?.id).toBe("maya");
    expect(pluginScopeBot({ pluginsBotId: null, selectedId: "group-1", bots })).toBeNull();
  });

  it("opens on the bot's scope only when a bot panel asked for it", () => {
    expect(initialPluginScope("rex", { id: "rex" })).toBe("bot");
    expect(initialPluginScope(null, { id: "maya" })).toBe("workspace");
    expect(initialPluginScope("rex", null)).toBe("workspace");
  });

  it("reads the one marketplace list with installed meaning on this bot, linking nothing of the workspace", () => {
    const [market] = botScopeMarketplaces(view);
    expect(market.name).toBe("acme-tools");
    expect(market.plugins.map((plugin) => [plugin.name, plugin.installed])).toEqual([["reviewer", true], ["linter", false]]);
    expect(market.plugins.every((plugin) => plugin.servers.length === 0 && plugin.skills.length === 0)).toBe(true);
  });

  it("carries this bot's token flag and its own update offer", () => {
    const next: BotPluginsView = {
      ...view,
      marketplaces: [{ ...view.marketplaces[0]!, hasToken: true, plugins: [
        { name: "reviewer", version: "1.3.0", installedVersion: "1.2.0", updateAvailable: true, installed: true, external: false },
        { name: "linter", installed: false, external: true, updateAvailable: true },
      ] }],
    };
    const [market] = botScopeMarketplaces(next);
    expect(market.hasToken).toBe(true);
    expect(market.plugins[0]).toMatchObject({ installedVersion: "1.2.0", updateAvailable: true });
    // an update is only ever about an install
    expect(market.plugins[1]!.updateAvailable).toBeUndefined();
    expect(botScopeMarketplaces(view)[0]!.hasToken).toBeUndefined();
  });

  it("finds a plugin row's state on the bot", () => {
    const reviewer = botPluginState(view, "reviewer@acme-tools");
    expect(reviewer).toMatchObject({ plugin: "reviewer", marketplace: "acme-tools", contents: { agents: ["critic"] } });
    expect(reviewer?.installed?.enabled).toBe(true);
    expect(botPluginState(view, "linter@acme-tools")).toMatchObject({ external: true, installed: null });
    expect(botPluginState(view, "ghost@acme-tools")).toBeNull();
    expect(botPluginState(null, "reviewer@acme-tools")).toBeNull();
  });

  it("routes marketplace changes: the workspace for its managers, the bot for its owner", () => {
    expect(marketplaceRoute({ workspaceManager: true, scope: "workspace", botView: view })).toBe("workspace");
    expect(marketplaceRoute({ workspaceManager: true, scope: "bot", botView: view })).toBe("bot");
    expect(marketplaceRoute({ workspaceManager: false, scope: "workspace", botView: view })).toBe("bot");
    expect(marketplaceRoute({ workspaceManager: false, scope: "bot", botView: { ...view, canChange: false } })).toBeNull();
    expect(marketplaceRoute({ workspaceManager: true, scope: "bot", botView: { ...view, canChange: false } })).toBe("workspace");
  });
});
