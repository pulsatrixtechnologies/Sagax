// "Me joindre" on the bot page (2026-10-26), through the route table on a
// real HTTP server: each person reads and saves their own choice for a bot,
// no admin; Telegram's token is write only.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { createReachMeStore } from "../reach-me/store.ts";
import { createReachMeRoutes } from "./reach-me.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TOKEN = `123456789:${"B".repeat(35)}`;

async function serve(person: string | null = "pr_member") {
  const dir = mkdtempSync(join(tmpdir(), "sagax-reach-route-"));
  dirs.push(dir);
  const settings = createReachMeStore(dir);
  const tokens: string[] = [];
  const routes = [createReachMeRoutes({
    person: () => person ?? undefined,
    bot: (id) => (id === "bot_abc" ? { id } : null),
    settings,
    channelStatus: () => ({ push: { ready: true, devices: 1 }, sms: { ready: false, reason: "x" }, teams: { ready: true }, telegram: { ready: false }, whatsapp: { ready: false } }),
    telegram: {
      connect: async (_person, _bot, token) => { tokens.push(token); return { ok: true, username: "my_bot", link: "https://t.me/my_bot?start=abc" }; },
      disconnect: () => {},
    },
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["client"] }, json, readBody });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  return { call, settings, tokens };
}

describe("Reach me routes", () => {
  it("the default is push at any hour; a member saves their own choice", async () => {
    const { call, settings } = await serve();
    const first = await call("GET", "/api/bots/bot_abc/reach-me");
    expect(first).toMatchObject({ status: 200, body: { saved: false, settings: { channels: ["push"], hours: { always: true } } } });
    const saved = await call("PUT", "/api/bots/bot_abc/reach-me", { channels: ["telegram", "sms"], smsNumber: "+1 514 555 0123", hours: { always: true } });
    expect(saved).toMatchObject({ status: 200, body: { saved: true, settings: { channels: ["telegram", "sms"], smsNumber: "+15145550123" } } });
    expect(settings.get("pr_member", "bot_abc")?.channels).toEqual(["telegram", "sms"]);
  });
  it("refuses a bad body with the field, an unknown bot, and a caller who is no person", async () => {
    const { call } = await serve();
    expect(await call("PUT", "/api/bots/bot_abc/reach-me", { channels: ["sms"] })).toMatchObject({ status: 400, body: { field: "smsNumber" } });
    expect((await call("GET", "/api/bots/bot_nope/reach-me")).status).toBe(404);
    const anonymous = await serve(null);
    expect((await anonymous.call("GET", "/api/bots/bot_abc/reach-me")).status).toBe(403);
  });
  it("Telegram: the token goes in, never comes back", async () => {
    const { call, tokens } = await serve();
    const linked = await call("POST", "/api/bots/bot_abc/reach-me/telegram", { token: TOKEN });
    expect(linked).toMatchObject({ status: 200, body: { ok: true, username: "my_bot", link: "https://t.me/my_bot?start=abc" } });
    expect(JSON.stringify(linked.body)).not.toContain(TOKEN);
    expect(tokens).toEqual([TOKEN]);
    expect((await call("DELETE", "/api/bots/bot_abc/reach-me/telegram")).status).toBe(200);
  });
});
