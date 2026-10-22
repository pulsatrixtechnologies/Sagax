// GET /api/bots/:id/inbound-mail (contract C of 2026-10-21): the bot's own
// email address from the Perspicax relay, through the route table on a real
// HTTP server. Visibility is the one path check every client route passes
// (bot-visibility.ts pathSubject); this route answers for the bot it is given.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { BotInboundMail } from "../bot-mail-addresses.ts";
import { createBotInboundMailReadRoutes, type BotInboundMailReadDeps } from "./bot-inbound-mail.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const MAIL: Record<string, BotInboundMail> = {
  bot_abc: { available: true, address: "cryptic@bots.example.org", enabled: true },
  bot_off: { available: true, address: "ember@bots.example.org", enabled: false },
};

async function serve(deps: Partial<BotInboundMailReadDeps> = {}): Promise<string> {
  const routes = [createBotInboundMailReadRoutes({
    bot: (id) => (id === "bot_abc" || id === "bot_off" || id === "bot_local" ? { id } : null),
    organization: () => true,
    address: async (id) => MAIL[id] ?? { available: false, address: null, enabled: false },
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody,
    });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("GET /api/bots/:id/inbound-mail", () => {
  it("answers the bot's address and whether the admin turned it off, uncached", async () => {
    const base = await serve();
    const on = await fetch(`${base}/api/bots/bot_abc/inbound-mail`);
    expect(on.status).toBe(200);
    expect(on.headers.get("cache-control")).toBe("no-store");
    expect(await on.json()).toEqual({ available: true, address: "cryptic@bots.example.org", enabled: true });
    expect(await (await fetch(`${base}/api/bots/bot_off/inbound-mail`)).json()).toEqual({ available: true, address: "ember@bots.example.org", enabled: false });
  });

  it("available false on a solo server, without asking Perspicax", async () => {
    let asked = 0;
    const base = await serve({ organization: () => false, address: async () => { asked += 1; return MAIL.bot_abc!; } });
    expect(await (await fetch(`${base}/api/bots/bot_abc/inbound-mail`)).json()).toEqual({ available: false, address: null, enabled: false });
    expect(asked).toBe(0);
  });

  it("available false when the read fails", async () => {
    const base = await serve({ address: async () => { throw new Error("down"); } });
    const response = await fetch(`${base}/api/bots/bot_abc/inbound-mail`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false, address: null, enabled: false });
  });

  it("404 for a bot that is not there; other methods and paths pass", async () => {
    const base = await serve();
    expect((await fetch(`${base}/api/bots/nobody/inbound-mail`)).status).toBe(404);
    expect(await (await fetch(`${base}/api/bots/bot_abc/inbound-mail`, { method: "POST" })).json()).toEqual({ from: "inline routes" });
    expect(await (await fetch(`${base}/api/bots/bot_abc/inbound-mail/x`)).json()).toEqual({ from: "inline routes" });
  });
});
