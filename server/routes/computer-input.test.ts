import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { createComputerInputRoutes, type ComputerInputRouteDeps, type ControlState } from "./computer-input.ts";
import { dispatchRoutes } from "./table.ts";

type Bot = { id: string };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });
const OWNER: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };

interface Harness { scripts: string[]; audits: Array<{ action: string; detail: Record<string, unknown> }>; base: string }

async function serve(options: { control?: ControlState; hasComputer?: boolean; mayDrive?: boolean; stdout?: string; ok?: boolean; auth?: RequestAuth } = {}): Promise<Harness> {
  const scripts: string[] = [];
  const audits: Harness["audits"] = [];
  const deps: ComputerInputRouteDeps<Bot> = {
    bot: (id) => (id === "scout" ? { id } : undefined),
    mayDrive: () => options.mayDrive ?? true,
    control: (_bot, lease) => (options.control ?? (lease === "wrong" ? "other" : "held")),
    shell: () => options.hasComputer === false ? null : {
      kind: "cloud", maxScript: 3_500,
      run: async (script) => { scripts.push(script); return { ok: options.ok ?? true, stdout: options.stdout ?? "" }; },
    },
    audit: (_auth, _req, _bot, action, detail) => { audits.push({ action, detail }); },
  };
  const routes = [createComputerInputRoutes(deps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: options.auth ?? OWNER, json, readBody })) json(res, 404, { from: "inline" });
    } catch (error) { json(res, 500, { error: String(error) }); }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return { scripts, audits, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const send = (base: string, path: string, method: string, body?: unknown) => fetch(base + path, {
  method, headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("computer input routes", () => {
  it("stay admin scope for sessions (the companion lists them behind its desktop capability)", () => {
    expect(requiredScope("POST", "/api/bots/scout/computer/input")).toBe("admin");
    expect(requiredScope("GET", "/api/bots/scout/computer/clipboard")).toBe("admin");
    expect(requiredScope("PUT", "/api/bots/scout/computer/clipboard")).toBe("admin");
  });

  it("sends events while control is held, and audits counts only", async () => {
    const { base, scripts, audits } = await serve();
    const res = await send(base, "/api/bots/scout/computer/input", "POST", { events: [{ type: "move", dx: 1, dy: 2 }, { type: "text", text: "password123" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: 2 });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("xdotool mousemove_relative --sync -- 1 2 && xdotool type");
    expect(JSON.stringify(audits)).not.toContain("password123");
    expect(audits).toEqual([{ action: "input", detail: { computer: "cloud", events: { move: 1, text: 1 } } }]);
  });

  it("answers 409 without control, 404 without a computer, 403 for others, 400 for bad events, 415 for forms", async () => {
    const body = { events: [{ type: "move", dx: 1, dy: 1 }] };
    const free = await send((await serve({ control: "free" })).base, "/api/bots/scout/computer/input", "POST", body);
    expect(free.status).toBe(409);
    expect(await free.json()).toMatchObject({ code: "no_control" });
    const other = await send((await serve()).base, "/api/bots/scout/computer/input", "POST", { ...body, controlLeaseId: "wrong" });
    expect(await other.json()).toMatchObject({ code: "control_lease" });
    const none = await send((await serve({ hasComputer: false })).base, "/api/bots/scout/computer/input", "POST", body);
    expect(none.status).toBe(404);
    expect(await none.json()).toMatchObject({ code: "no_computer" });
    expect((await send((await serve({ mayDrive: false })).base, "/api/bots/scout/computer/input", "POST", body)).status).toBe(403);
    expect((await send((await serve()).base, "/api/bots/ghost/computer/input", "POST", body)).status).toBe(404);
    expect((await send((await serve()).base, "/api/bots/scout/computer/input", "POST", { events: [{ type: "key", key: "a;id" }] })).status).toBe(400);
    expect((await send((await serve()).base, "/api/bots/scout/computer/input", "POST", { events: [{ type: "teleport" }] })).status).toBe(400);
    const form = await fetch(`${(await serve()).base}/api/bots/scout/computer/input`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1" });
    expect(form.status).toBe(415);
    const failed = await send((await serve({ ok: false })).base, "/api/bots/scout/computer/input", "POST", body);
    expect(failed.status).toBe(502);
  });

  it("reads and writes the clipboard", async () => {
    const read = await serve({ stdout: Buffer.from("from the desktop").toString("base64") });
    const got = await send(read.base, "/api/bots/scout/computer/clipboard", "GET");
    expect(await got.json()).toEqual({ text: "from the desktop" });
    expect(read.audits).toEqual([{ action: "clipboard.read", detail: { computer: "cloud", bytes: 16 } }]);
    const write = await serve();
    const put = await send(write.base, "/api/bots/scout/computer/clipboard", "PUT", { text: "from the phone" });
    expect(put.status).toBe(200);
    expect(write.scripts.join("\n")).toContain(Buffer.from("from the phone").toString("base64"));
    expect((await send(write.base, "/api/bots/scout/computer/clipboard", "PUT", { text: "x".repeat(20_000) })).status).toBe(400);
    expect((await send((await serve({ control: "free" })).base, "/api/bots/scout/computer/clipboard", "GET")).status).toBe(409);
  });
});
