// Perspicax `sagax_integrations` (migration 0046): who manages a person's
// plugins, skills and MCP servers. The routes' refusals with `off`, their
// listings, and the engine commands refused in the person's environment.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { engineIntegrationCommand, INTEGRATIONS_ADMIN_ONLY, INTEGRATIONS_ADMIN_ONLY_COMMAND } from "./person-integrations.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createBotPluginRoutes } from "./routes/bot-plugins.ts";
import { createPersonConnectionRoutes } from "./routes/person-connections.ts";
import { dispatchRoutes, type RouteHandler } from "./routes/table.ts";
import { callUserSandboxTool } from "./user-sandbox-tools.ts";
import type { BotPlugins } from "./bot-plugins.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });

const member = (principalId: string): RequestAuth => ({
  kind: "session", via: "cookie", scopes: ["client"],
  session: { id: principalId, principalId, label: principalId, scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0 } as never,
});

async function serve(routes: RouteHandler[], auth: RequestAuth): Promise<string> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline" });
    } catch (error) { json(res, 500, { error: String(error) }); }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const send = async (base: string, method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

function connectionRoutes(locked: Set<string>, calls: string[]): RouteHandler {
  return createPersonConnectionRoutes({
    organization: () => true,
    managedByAdmin: (auth) => auth.kind === "session" && locked.has(auth.session.principalId ?? ""),
    sandboxConfigured: () => true,
    github: {
      status: () => ({ state: "none", deviceFlow: true }),
      startDevice: async () => { calls.push("device"); return { userCode: "X" }; },
      connectToken: async () => { calls.push("token"); return { state: "none", deviceFlow: true }; },
      disconnect: async () => { calls.push("disconnect"); },
    },
    servers: {
      list: async () => [{ name: "notes", kind: "remote", type: "http", url: "https://mcp.example.test/mcp", domain: "mcp.example.test", auth: "oauth", tokenConfigured: false, enabled: true, addedAt: 1 } as never],
      add: async () => { calls.push("add"); },
      setEnabled: async () => { calls.push("toggle"); },
      remove: async () => { calls.push("remove"); },
      oauthStart: async () => { calls.push("signin"); return { status: 200, body: { authorizationUrl: "https://idp.example.test/a", redirectUri: "http://localhost/cb" } }; },
      oauthDisconnect: async () => { calls.push("signout"); },
    },
  });
}

describe("Mes connexions with sagax_integrations", () => {
  it("off: the listing says so and every change is refused, a sign-in again is not", async () => {
    const calls: string[] = [];
    const base = await serve([connectionRoutes(new Set(["pr_rita"]), calls)], member("pr_rita"));
    const listed = await send(base, "GET", "/api/me/connections");
    expect(listed.status).toBe(200);
    expect(listed.body.managedByAdmin).toBe(true);
    expect((listed.body.servers as unknown[]).length).toBe(1);
    for (const [method, path, body] of [
      ["POST", "/api/me/github/device", {}],
      ["POST", "/api/me/github/token", { token: "ghp_x" }],
      ["DELETE", "/api/me/github", undefined],
      ["POST", "/api/me/mcp/servers", { name: "gh", url: "https://api.githubcopilot.com/mcp/", auth: "github" }],
      ["PATCH", "/api/me/mcp/servers/notes", { enabled: false }],
      ["DELETE", "/api/me/mcp/servers/notes", undefined],
      ["POST", "/api/me/mcp/servers/notes/oauth/disconnect", {}],
    ] as const) {
      const refused = await send(base, method, path, body);
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(refused.body).toEqual({ ...INTEGRATIONS_ADMIN_ONLY });
    }
    expect(calls).toEqual([]);
    // signing in again keeps an existing server working
    expect((await send(base, "POST", "/api/me/mcp/servers/notes/oauth/start", {})).status).toBe(200);
    expect(calls).toEqual(["signin"]);
  });

  it("manage: the person does it all without an admin, and the listing says nothing", async () => {
    const calls: string[] = [];
    const base = await serve([connectionRoutes(new Set(["pr_rita"]), calls)], member("pr_bob"));
    expect((await send(base, "GET", "/api/me/connections")).body.managedByAdmin).toBe(false);
    expect((await send(base, "POST", "/api/me/github/device", {})).status).toBe(200);
    expect((await send(base, "POST", "/api/me/github/token", { token: "ghp_x" })).status).toBe(200);
    expect((await send(base, "POST", "/api/me/mcp/servers", { name: "gh", url: "https://api.githubcopilot.com/mcp/", auth: "github" })).status).toBe(201);
    expect((await send(base, "PATCH", "/api/me/mcp/servers/notes", { enabled: false })).status).toBe(200);
    expect((await send(base, "DELETE", "/api/me/mcp/servers/notes")).status).toBe(200);
    expect((await send(base, "DELETE", "/api/me/github")).status).toBe(200);
    expect(calls).toEqual(["device", "token", "add", "toggle", "remove", "disconnect"]);
  });
});

describe("a bot's plugins with sagax_integrations", () => {
  type Bot = { id: string; owner: string };
  const BOTS: Record<string, Bot> = { scout: { id: "scout", owner: "pr_rita" } };
  function pluginRoutes(locked: Set<string>, calls: string[]): RouteHandler {
    const plugins = {
      listMarketplaces: () => [],
      listPlugins: () => [{ key: "reviewer@acme-tools", name: "reviewer", marketplace: "acme-tools", enabled: true }],
      addMarketplace: async () => { calls.push("market"); return { name: "acme-tools", source: "acme/tools", plugins: [] }; },
      updateMarketplace: async () => { calls.push("update"); return { name: "acme-tools" }; },
      removeMarketplace: async () => { calls.push("rmm"); },
      install: async () => { calls.push("install"); return { key: "reviewer@acme-tools", removed: [] }; },
      setEnabled: () => { calls.push("toggle"); return {}; },
      uninstall: async () => { calls.push("uninstall"); },
    } as unknown as BotPlugins;
    return createBotPluginRoutes<Bot>({
      plugins,
      bot: (id) => BOTS[id],
      mayRead: () => true,
      // the owner changes them
      mayChange: (auth, bot) => auth.kind === "session" && auth.session.principalId === bot.owner,
      actor: (auth) => (auth.kind === "session" ? auth.session.principalId : undefined),
      managedByAdmin: (auth) => auth.kind === "session" && locked.has(auth.session.principalId ?? ""),
      policy: () => undefined,
      engineLoadsPlugins: () => true,
    });
  }

  it("off: read-only on their own bot, every change refused with org_integrations_admin_only", async () => {
    const calls: string[] = [];
    const base = await serve([pluginRoutes(new Set(["pr_rita"]), calls)], member("pr_rita"));
    const listed = await send(base, "GET", "/api/bots/scout/plugins");
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ canChange: false, managedByAdmin: true });
    expect((listed.body.plugins as unknown[]).length).toBe(1);
    for (const [method, path, body] of [
      ["POST", "/api/bots/scout/plugins/marketplaces", { source: "acme/tools" }],
      ["POST", "/api/bots/scout/plugins/marketplaces/acme-tools/update", undefined],
      ["DELETE", "/api/bots/scout/plugins/marketplaces/acme-tools", undefined],
      ["POST", "/api/bots/scout/plugins/install", { marketplace: "acme-tools", plugin: "reviewer" }],
      ["PATCH", "/api/bots/scout/plugins/reviewer@acme-tools", { enabled: false }],
      ["DELETE", "/api/bots/scout/plugins/reviewer@acme-tools", undefined],
    ] as const) {
      const refused = await send(base, method, path, body);
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(refused.body.code).toBe("org_integrations_admin_only");
    }
    expect(calls).toEqual([]);
  });

  it("manage: the owner adds a marketplace and installs without an admin", async () => {
    const calls: string[] = [];
    const base = await serve([pluginRoutes(new Set(), calls)], member("pr_rita"));
    const listed = await send(base, "GET", "/api/bots/scout/plugins");
    expect(listed.body.canChange).toBe(true);
    expect(listed.body.managedByAdmin).toBeUndefined();
    expect((await send(base, "POST", "/api/bots/scout/plugins/marketplaces", { source: "acme/tools" })).status).toBe(201);
    expect((await send(base, "POST", "/api/bots/scout/plugins/install", { marketplace: "acme-tools", plugin: "reviewer" })).status).toBe(201);
    expect(calls).toEqual(["market", "install"]);
  });
});

describe("engine plugin and MCP commands in the person's environment", () => {
  it("recognizes the engines' install, add and remove subcommands", () => {
    for (const command of [
      "claude plugin install reviewer@acme-tools",
      "claude plugin marketplace add acme/tools",
      "claude plugins remove x",
      "claude mcp add github https://api.githubcopilot.com/mcp/",
      "claude mcp add-json gh '{}'",
      "cd /workspace && claude mcp remove gh",
      "/usr/local/bin/claude plugin enable x",
      "env FOO=1 claude mcp add x y",
      "codex mcp add gh -- npx x",
      "gemini extensions install https://github.com/x/y",
      "echo $(claude plugin install x)",
      "npx -y @anthropic-ai/claude-code mcp add x y",
    ]) expect(engineIntegrationCommand(command), command).toBe(true);
    for (const command of [
      "claude mcp list",
      "claude plugin list",
      "claude --version",
      "git clone https://github.com/acme/tools",
      "echo 'claude-plugin install notes'",
      "ls ~/.claude/plugins",
      "npm install @modelcontextprotocol/server-github",
    ]) expect(engineIntegrationCommand(command), command).toBe(false);
  });

  it("run_command answers the refusal and never runs it", async () => {
    const ran: string[][] = [];
    const exec = {
      exec: async (input: { argv: string[] }) => { ran.push(input.argv); return { stdout: "ok", stderr: "", exitCode: 0, truncated: false, timedOut: false }; },
      overQuota: async () => false,
      commandRefusal: (command: string) => (engineIntegrationCommand(command) ? INTEGRATIONS_ADMIN_ONLY_COMMAND : null),
    };
    const refused = await callUserSandboxTool("run_command", { command: "claude plugin install x@y" }, exec as never);
    expect(refused).toEqual({ content: [{ type: "text", text: INTEGRATIONS_ADMIN_ONLY_COMMAND }], isError: true });
    expect(ran).toEqual([]);
    const allowed = await callUserSandboxTool("run_command", { command: "ls" }, exec as never);
    expect(allowed.isError).toBeUndefined();
    expect(ran).toEqual([["bash", "-lc", "ls"]]);
  });
});
