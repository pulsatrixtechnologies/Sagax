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
  const whatsapp: Array<{ call: string; args: unknown }> = [];
  const routes = [createReachMeRoutes({
    person: () => person ?? undefined,
    bot: (id) => (id === "bot_abc" ? { id } : null),
    settings,
    channelStatus: () => ({ push: { ready: true, devices: 1 }, sms: { ready: false, reason: "x" }, teams: { ready: true }, telegram: { ready: false }, whatsapp: { ready: false } }),
    telegram: {
      connect: async (_person, _bot, token) => { tokens.push(token); return { ok: true, username: "my_bot", link: "https://t.me/my_bot?start=abc" }; },
      disconnect: () => {},
    },
    whatsapp: {
      connect: async (_person, _bot, input) => { whatsapp.push({ call: "connect", args: input }); return { ok: true }; },
      update: (_person, _bot, input) => { whatsapp.push({ call: "update", args: input }); return { ok: true }; },
      disconnect: () => { whatsapp.push({ call: "disconnect", args: null }); },
      renewLink: () => { whatsapp.push({ call: "renewLink", args: null }); return { ok: true }; },
      sendCode: async (_person, _bot, number) => { whatsapp.push({ call: "sendCode", args: number }); return { ok: true }; },
      confirm: (_person, _bot, code) => { whatsapp.push({ call: "confirm", args: code }); return code === "K7Q2WX" ? { ok: true } : { ok: false, status: 400, error: "That is not the code." }; },
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
  return { call, settings, tokens, whatsapp };
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
  it("WhatsApp: the person connects their own number, the token and app secret never come back, the code proves their number", async () => {
    const { call, whatsapp } = await serve();
    const accessToken = "FAKEACCESSTOKENFORTESTS0123456789";
    const appSecret = "0123456789abcdef0123456789abcdef";
    expect((await call("POST", "/api/bots/bot_abc/reach-me/whatsapp", { accessToken })).status).toBe(400);
    const connected = await call("POST", "/api/bots/bot_abc/reach-me/whatsapp", { accessToken, phoneNumberId: "106540352242922", appSecret, templateName: "sagax_card", templateLanguage: "fr" });
    expect(connected.status).toBe(200);
    expect(JSON.stringify(connected.body)).not.toContain(accessToken);
    expect(JSON.stringify(connected.body)).not.toContain(appSecret);
    expect(whatsapp[0]).toEqual({ call: "connect", args: { accessToken, phoneNumberId: "106540352242922", appSecret, templateName: "sagax_card", templateLanguage: "fr" } });
    expect((await call("PUT", "/api/bots/bot_abc/reach-me/whatsapp", { templateName: "sagax_card_v2" })).status).toBe(200);
    expect((await call("POST", "/api/bots/bot_abc/reach-me/whatsapp/link", {})).status).toBe(200);
    expect((await call("POST", "/api/bots/bot_abc/reach-me/whatsapp/link", { number: "+1 514 555 0123" })).status).toBe(200);
    expect(await call("POST", "/api/bots/bot_abc/reach-me/whatsapp/link", { code: "WRONG1" })).toMatchObject({ status: 400 });
    expect((await call("POST", "/api/bots/bot_abc/reach-me/whatsapp/link", { code: "K7Q2WX" })).status).toBe(200);
    expect((await call("DELETE", "/api/bots/bot_abc/reach-me/whatsapp")).status).toBe(200);
    expect(whatsapp.map((entry) => entry.call)).toEqual(["connect", "update", "renewLink", "sendCode", "confirm", "confirm", "disconnect"]);
  });
});
