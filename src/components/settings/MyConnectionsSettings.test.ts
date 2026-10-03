// Settings > Mes connexions (organization server) and the bot panel's
// Library > Plugins: what each state draws, in English and in French.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { parseArgsLine, parseEnvLines, suggestServerName, type BotPluginsView, type MyConnections } from "@/lib/my-connections";
import { BotPluginsCard } from "../bot-settings/BotPluginsCard";
import { LIBRARY_VIEWS } from "../bot-settings/LibraryTab";
import { organizationHidesSection } from "../SettingsModal";
import { MyConnectionsSettings } from "./MyConnectionsSettings";

afterEach(() => setLocale("en"));

const base: MyConnections = { github: { state: "none", deviceFlow: true }, servers: [], sandbox: true };

describe("Mes connexions", () => {
  it("is a section of an organization server only", () => {
    expect(organizationHidesSection("myConnections", false)).toBe(true);
    expect(organizationHidesSection("myConnections", true)).toBe(false);
    expect(organizationHidesSection("mail", true)).toBe(true);
  });

  it("offers Connect GitHub and a token, and Add an MCP server", () => {
    const html = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: base }));
    expect(html).toContain('data-github-state="none"');
    expect(html).toContain("Connect GitHub");
    expect(html).toContain("Use a token");
    expect(html).toContain("Add an MCP server");
    expect(html).toContain("No MCP server of your own yet.");
  });

  it("says why there is no Connect GitHub button, in French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, github: { state: "none", deviceFlow: false } } }));
    expect(html).not.toContain("Connecter GitHub</button>");
    expect(html).toContain("Utiliser un jeton");
    expect(html).toContain("application OAuth GitHub");
    expect(html).toContain("Ajouter un serveur MCP");
  });

  it("shows the code to type at GitHub, then who is connected", () => {
    const pending = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, github: { state: "pending", deviceFlow: true, userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresAt: 1 } } }));
    expect(pending).toContain("WDJB-MJHT");
    expect(pending).toContain("Open GitHub");
    const connected = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, github: { state: "connected", deviceFlow: true, login: "octo", via: "device", connectedAt: 1 } } }));
    expect(connected).toContain("Connected as @octo");
    expect(connected).toContain("Disconnect");
  });

  it("lists a person's servers with where they run and what they need", () => {
    const html = renderToStaticMarkup(createElement(MyConnectionsSettings, { initial: { ...base, servers: [
      { name: "notes", kind: "remote", type: "http", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", auth: "oauth", tokenConfigured: false, enabled: true, addedAt: 1, authState: "needs_sign_in" },
      { name: "tools", kind: "stdio", command: "npx", args: ["-y", "x"], envKeys: ["API_KEY"], runsIn: "environment", enabled: true, addedAt: 1, authState: "ready" },
    ] } }));
    expect(html).toContain('data-personal-server="notes"');
    expect(html).toContain("sign-in needed");
    expect(html).toContain(">Sign in<");
    expect(html).toContain("npx in your server environment");
  });

  it("reads names, arguments and variables the way a person types them", () => {
    expect(suggestServerName("https://api.githubcopilot.com/mcp/")).toBe("githubcopilot");
    expect(suggestServerName("@modelcontextprotocol/server-github")).toBe("server-github");
    expect(parseArgsLine(`-y "@scope/pkg name" --flag`)).toEqual(["-y", "@scope/pkg name", "--flag"]);
    expect(parseEnvLines("A=1\nB=x=y\n")).toEqual({ ok: true, env: { A: "1", B: "x=y" } });
    expect(parseEnvLines("nope")).toEqual({ ok: false, line: "nope" });
  });
});

describe("Library > Plugins", () => {
  const view: BotPluginsView = {
    marketplaces: [{ name: "acme-tools", source: "acme/tools", addedAt: 1, updatedAt: 1, plugins: [{ name: "reviewer", description: "Reviews code", installed: true, external: false }, { name: "linter", installed: false, external: false }] }],
    plugins: [{ key: "reviewer@acme-tools", name: "reviewer", marketplace: "acme-tools", enabled: true, removed: ["hooks"], declaredMcpServers: ["db"] }],
    policy: { mode: "any" },
    engine: { loadsPlugins: true },
    canChange: true,
  };

  it("has Files, Skills and Plugins", () => {
    expect(LIBRARY_VIEWS).toEqual(["files", "skills", "plugins"]);
  });

  it("lets the owner add a marketplace and install, and says what was left out", () => {
    const html = renderToStaticMarkup(createElement(BotPluginsCard, { bot: { id: "b1" }, initial: view }));
    expect(html).toContain('data-plugin="reviewer@acme-tools"');
    expect(html).toContain("Left out: hooks");
    expect(html).toContain("Declares MCP servers db");
    expect(html).toContain("Add a marketplace");
    expect(html).toContain(">Install<");
  });

  it("is read-only for a person who only uses the bot, and says when the engine is not Claude Code", () => {
    const html = renderToStaticMarkup(createElement(BotPluginsCard, { bot: { id: "b1" }, initial: { ...view, canChange: false, engine: { loadsPlugins: false }, policy: { mode: "list", allow: ["acme/*"] } } }));
    expect(html).toContain("Only the bot&#x27;s owner, or someone who manages it");
    expect(html).toContain("only when this bot runs on Claude Code");
    expect(html).toContain("Your organization allows: acme/*");
    expect(html).not.toContain("Add a marketplace");
    expect(html).not.toContain(">Install<");
  });
});
