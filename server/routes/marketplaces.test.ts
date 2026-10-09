import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { PluginMarketplaces } from "../plugin-marketplaces.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createMarketplaceRoutes, type MarketplaceRouteDeps } from "./marketplaces.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });
const OWNER: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const MEMBER: RequestAuth = { kind: "loopback", trust: "service", scopes: ["admin", "client"] };

interface Installed { key: string; marketplace: string; plugin: string; version?: string; revision?: string; servers: string[]; skills: string[] }

async function serve(auth: RequestAuth, update?: MarketplaceRouteDeps["update"]) {
  const installed: Installed[] = [
    { key: "notes@acme", marketplace: "acme", plugin: "notes", version: "1.0.0", revision: "sha256:old", servers: ["notes"], skills: ["note-taking"] },
  ];
  const audits: Array<Parameters<MarketplaceRouteDeps["audit"]>[1]> = [];
  const updates: string[] = [];
  const store = {
    installed: () => installed,
    list: () => [{ name: "acme" }],
  } as unknown as PluginMarketplaces;
  const routes = [createMarketplaceRoutes({
    store,
    mayManage: (caller) => caller.kind === "loopback" && caller.trust !== "service",
    actor: () => undefined,
    install: async () => ({ status: 200, body: {} }),
    uninstall: async () => ({ status: 200, body: {} }),
    update: update ?? (async (marketplace, plugin) => {
      updates.push(`${plugin}@${marketplace}`);
      installed[0] = { ...installed[0]!, version: "1.1.0", revision: "sha256:new", servers: ["notes", "notes-search"], skills: ["note-taking"] };
      return { status: 200, body: { plugin: installed[0], skipped: [] } };
    }),
    audit: (_auth, row) => { audits.push(row); },
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/marketplaces`;
  const post = (path: string, type = "application/json") => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": type }, body: "{}" });
  return { base, post, audits, updates };
}

describe("marketplace plugin update route", () => {
  it("updates an installed plugin in place and writes one audit row", async () => {
    const { post, audits, updates } = await serve(OWNER);
    const res = await post("/acme/plugins/notes/update");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ plugin: { version: "1.1.0" }, marketplaces: [{ name: "acme" }] });
    expect(updates).toEqual(["notes@acme"]);
    expect(audits).toEqual([{
      action: "plugin.update",
      target: { kind: "plugin", id: "notes@acme", name: "notes" },
      before: { version: "1.0.0", revision: "sha256:old", servers: ["notes"], skills: ["note-taking"] },
      after: { version: "1.1.0", revision: "sha256:new", servers: ["notes", "notes-search"], skills: ["note-taking"] },
    }]);
  });

  it("refuses a plugin that is not installed, without calling the update", async () => {
    const { post, audits, updates } = await serve(OWNER);
    const res = await post("/acme/plugins/other/update");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_installed" });
    expect(updates).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("writes no audit row when the update fails", async () => {
    const { post, audits } = await serve(OWNER, async () => ({ status: 409, body: { error: "MCP servers are already being updated." } }));
    expect((await post("/acme/plugins/notes/update")).status).toBe(409);
    expect(audits).toEqual([]);
  });

  it("is for whoever manages marketplaces, as JSON, by POST", async () => {
    const member = await serve(MEMBER);
    expect((await member.post("/acme/plugins/notes/update")).status).toBe(403);
    expect(member.updates).toEqual([]);
    const owner = await serve(OWNER);
    expect((await owner.post("/acme/plugins/notes/update", "text/plain")).status).toBe(415);
    expect((await fetch(`${owner.base}/acme/plugins/notes/update`)).status).toBe(405);
    expect(owner.updates).toEqual([]);
  });
});
