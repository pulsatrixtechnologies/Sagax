// The desktop of a person's server environment (organization mode): computer
// use runs as fixed sagax-desktop argv in that person's sandbox, and the live
// view (/api/desktop-viewer/sandbox/me) shows only the caller's own desktop,
// view-only unless they take control, and never starts anything from the
// WebSocket.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sandboxDesktopTarget } from "./desktop-viewer-targets.ts";
import { json, readBody } from "./harness/http.ts";
import { requiredScope, resolveRequestAuth } from "./request-auth.ts";
import { createDesktopViewer, SANDBOX_VIEWER_TARGET } from "./routes/desktop-viewer.ts";
import { SandboxError, SandboxService } from "./sandboxd-core.ts";
import { SessionRegistry } from "./sessions.ts";
import { FakeDocker } from "./testing/fake-docker.ts";
import { SandboxdRequestError, type SandboxdClient } from "./user-sandbox-client.ts";
import { UserSandboxManager } from "./user-sandbox-manager.ts";
import { sandboxNames, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";
import { callUserSandboxTool, handleUserSandboxMcp, sandboxComputerExec, SANDBOX_COMPUTER_TOOLS } from "./user-sandbox-tools.ts";
import { encodeWebSocketFrame, webSocketFrameDecoder } from "./ws-bridge.ts";

const ALICE = "pr_00000000-0000-4000-8000-00000000000a";
const BOB = "pr_00000000-0000-4000-8000-00000000000b";
const remote = { host: "sagax.example", origin: "https://sagax.example", "x-forwarded-proto": "https" };

describe("computer use in the server environment", () => {
  it("is offered with the desktop bridge's shape", async () => {
    const listed = await handleUserSandboxMcp("tools/list", {}, { exec: async () => { throw new Error("no exec"); }, overQuota: async () => false }) as { tools: { name: string }[] };
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["computer_list_tools", "computer_use", "run_command"]));
    expect(SANDBOX_COMPUTER_TOOLS.map((tool) => tool.name)).toEqual(["screenshot", "get_screen_size", "click", "move", "drag", "type_text", "key_press", "scroll", "open_url"]);
  });

  it("turns each call into a fixed argv, never a shell line", () => {
    expect(sandboxComputerExec("click", { x: 10, y: 20, button: "right", count: 2 }).argv)
      .toEqual(["sagax-desktop", "xdotool", "mousemove", "--sync", "10", "20", "click", "--repeat", "2", "--delay", "100", "3"]);
    expect(sandboxComputerExec("type_text", { text: "$(rm -rf /) ; héllo" })).toMatchObject({ argv: ["sagax-desktop", "type"], env: { SAGAX_TEXT: "$(rm -rf /) ; héllo" } });
    expect(sandboxComputerExec("open_url", { url: "https://example.com/a b" })).toMatchObject({ argv: ["sagax-desktop", "open-url"], env: { SAGAX_URL: "https://example.com/a%20b" } });
    expect(() => sandboxComputerExec("key_press", { key: "ctrl+l; reboot" })).toThrow(/X11 key/);
    expect(() => sandboxComputerExec("click", { x: -1, y: 2 })).toThrow(/x must be/);
    expect(() => sandboxComputerExec("click", { x: "1", y: 2 })).toThrow(/x must be/);
    expect(() => sandboxComputerExec("open_url", { url: "file:///etc/passwd" })).toThrow(/http/);
    expect(() => sandboxComputerExec("exec", { command: "id" })).toThrow(/unknown computer-use tool/);
  });

  it("returns a screenshot as an image and refuses a broken capture", async () => {
    const seen: string[][] = [];
    const exec = (stdout: string, exitCode = 0) => ({
      exec: async (input: { argv: string[] }) => { seen.push(input.argv); return { exitCode, stdout, stderr: "", truncated: false, timedOut: false }; },
      overQuota: async () => false,
    });
    const shot = await callUserSandboxTool("computer_use", { tool_name: "screenshot" }, exec("/9j/AAAA"));
    expect(shot).toEqual({ content: [{ type: "image", data: "/9j/AAAA", mimeType: "image/jpeg" }] });
    expect(seen[0]).toEqual(["sagax-desktop", "screenshot"]);
    expect((await callUserSandboxTool("computer_use", { tool_name: "screenshot" }, exec("", 1))).isError).toBe(true);
    expect((await callUserSandboxTool("computer_use", { tool_name: "click", arguments: [] }, exec(""))).isError).toBe(true);
    expect(await callUserSandboxTool("computer_use", { tool_name: "get_screen_size" }, exec("1280 800\n")))
      .toEqual({ content: [{ type: "text", text: '{"width":1280,"height":800}' }] });
  });
});

describe("live view of the server environment desktop", () => {
  let dir: string;
  let docker: FakeDocker;
  let service: SandboxService;
  let manager: UserSandboxManager;
  let sessions: SessionRegistry;
  let app: Server;
  let port: number;
  let viewer: ReturnType<typeof createDesktopViewer>;
  let alice: string;
  let bob: string;
  let adminWithoutPerson: string;
  const peers = new Set<Duplex>();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "sbx-desktop-"));
    docker = new FakeDocker();
    service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" }));
    await service.installEgressPolicy();
    const client: SandboxdClient = {
      info: async () => ({ instance: "default", egress: service.egress, maxRunning: 2, idleMinutes: 15 }),
      status: (key) => service.status(key), ensure: (key) => service.ensure(key), stop: (key) => service.stop(key),
      remove: (key, options) => service.remove(key, options), exec: (key, input) => service.exec(key, input),
      // As over HTTP: the provisioner's refusal arrives with its code.
      desktopStream: (key, options) => service.desktopStream(key, options).catch((error: unknown) => {
        throw error instanceof SandboxError ? new SandboxdRequestError(error.status, error.code, error.message) : error;
      }),
    };
    manager = new UserSandboxManager({ client, instance: "default", stateFile: join(dir, "deletions.json") });
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    alice = sessions.issue({ label: "Alice", scopes: ["client"], principalId: ALICE }).token;
    bob = sessions.issue({ label: "Bob", scopes: ["client"], principalId: BOB }).token;
    adminWithoutPerson = sessions.issue({ label: "Console", scopes: ["admin", "client"] }).token;
    viewer = createDesktopViewer({
      target: (id, auth) => {
        if (id !== SANDBOX_VIEWER_TARGET) return;
        const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : "";
        return principalId ? sandboxDesktopTarget(manager, principalId) : undefined;
      },
      live: (auth) => auth.kind === "loopback" || sessions.isLive(auth.session.id),
    });
    const handle = async (req: Parameters<typeof resolveRequestAuth>[0], res: Parameters<typeof json>[0]) => {
      const url = new URL(req.url!, "http://localhost");
      const gate = resolveRequestAuth(req, { sessions, cookieName: "s", url, streamPath: "/api/events", loopbackTrust: "service", features: { orgDirectory: true } });
      if (!gate.auth) return json(res, gate.status, { error: gate.error });
      await viewer.route({ req, res, url, path: url.pathname, method: req.method!, auth: gate.auth, json, readBody });
    };
    app = createServer((req, res) => void handle(req, res));
    viewer.attach(app, handle);
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    port = (app.address() as { port: number }).port;
  });

  afterEach(async () => {
    viewer.closeAll();
    for (const peer of peers) peer.destroy();
    peers.clear();
    await new Promise<void>((resolve) => { app.close(() => resolve()); app.closeAllConnections(); });
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string, token: string, extra: Record<string, string> = {}) => new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: { ...remote, cookie: `s=${token}`, ...extra } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text || "{}") as Record<string, unknown> }));
    });
    req.once("error", reject);
    req.end();
  });

  const open = (path: string, token: string) => new Promise<{ status: number; socket?: Duplex }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: {
      ...remote, cookie: `s=${token}`, Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13",
    } });
    req.once("upgrade", (res, socket, head) => {
      peers.add(socket);
      if (head.length) socket.unshift(head);
      resolve({ status: res.statusCode!, socket });
    });
    req.once("response", (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode! })); });
    req.once("error", reject);
    req.end();
  });

  const lastStart = () => docker.execs.filter((entry) => entry.exec.Cmd.includes("sagax-desktop") && entry.exec.Cmd.includes("start")).at(-1)!;
  const envOf = (entry: { exec: { Env: string[] } }) => Object.fromEntries(entry.exec.Env.map((pair) => pair.split("=", 2) as [string, string]));

  it("is a client-scope route on an organization server only", () => {
    expect(requiredScope("GET", "/api/desktop-viewer/sandbox/me", { orgDirectory: true })).toBe("client");
    expect(requiredScope("GET", "/api/desktop-viewer/sandbox/me/websockify", { orgDirectory: true })).toBe("client");
    expect(requiredScope("GET", "/api/desktop-viewer/sandbox/me", {})).toBe("admin");
    expect(requiredScope("GET", "/api/desktop-viewer/local/shared", { orgDirectory: true })).toBe("admin");
  });

  it("opens the caller's own desktop, view-only by default, control on request", async () => {
    const view = await get("/api/desktop-viewer/sandbox/me", alice);
    expect(view.status).toBe(200);
    expect(view.body.viewOnly).toBe(true);
    const start = lastStart();
    expect(start.name).toBe(sandboxNames(manager.keyFor(ALICE)).container);
    expect(view.body.password).toBe(envOf(start).SAGAX_VNC_VIEW);
    expect(envOf(start).SAGAX_VNC_FULL).not.toBe(envOf(start).SAGAX_VNC_VIEW);

    const control = await get("/api/desktop-viewer/sandbox/me?control=1", alice);
    expect(control.body).toMatchObject({ viewOnly: false, password: envOf(lastStart()).SAGAX_VNC_FULL });
  });

  it("never reaches another person's desktop", async () => {
    await get("/api/desktop-viewer/sandbox/me", alice);
    const bobView = await get("/api/desktop-viewer/sandbox/me", bob);
    expect(bobView.status).toBe(200);
    expect(lastStart().name).toBe(sandboxNames(manager.keyFor(BOB)).container);
    expect(bobView.body.password).not.toBe(envOf(docker.execs.find((entry) => entry.name === sandboxNames(manager.keyFor(ALICE)).container)!).SAGAX_VNC_VIEW);
    // No id names someone else: only `me` exists.
    expect((await get(`/api/desktop-viewer/sandbox/${ALICE}`, bob)).status).not.toBe(200);
    // The target itself refuses any other session.
    const target = sandboxDesktopTarget(manager, ALICE);
    const bobSession = sessions.authenticate(bob)!;
    expect(target.allows!({ kind: "session", session: bobSession, via: "cookie", scopes: bobSession.scopes })).toBe(false);
    expect(target.allows!({ kind: "loopback", scopes: ["admin", "client"] })).toBe(false);
  });

  it("refuses a session that is no person, a cross-origin page and a signed-out person", async () => {
    expect((await get("/api/desktop-viewer/sandbox/me", adminWithoutPerson)).status).toBe(404);
    expect((await get("/api/desktop-viewer/sandbox/me", alice, { origin: "https://evil.example" })).status).toBe(403);
    await manager.personOut(ALICE);
    expect((await get("/api/desktop-viewer/sandbox/me", alice)).status).toBe(403);
    expect((await open("/api/desktop-viewer/sandbox/me/websockify", alice)).status).toBe(403);
  });

  it("does not start a stopped environment from the WebSocket", async () => {
    expect((await open("/api/desktop-viewer/sandbox/me/websockify", alice)).status).toBe(409);
    expect(docker.containers.size).toBe(0);
    await get("/api/desktop-viewer/sandbox/me", alice);
    await service.stop(manager.keyFor(ALICE));
    expect((await open("/api/desktop-viewer/sandbox/me/websockify", alice)).status).toBe(409);
  });

  it("frames the desktop's RFB stream as WebSocket and closes when the environment stops", async () => {
    await get("/api/desktop-viewer/sandbox/me", alice);
    const answer = await open("/api/desktop-viewer/sandbox/me/websockify", alice);
    expect(answer.status).toBe(101);
    const socket = answer.socket!;
    const frames: Buffer[] = [];
    const decode = (chunk: Buffer) => {
      // Server frames are unmasked: read them directly.
      let offset = 0;
      while (offset + 2 <= chunk.length) {
        const length = chunk[offset + 1]! & 0x7f;
        frames.push(chunk.subarray(offset + 2, offset + 2 + length));
        offset += 2 + length;
      }
    };
    socket.on("data", decode);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(Buffer.concat(frames).toString()).toBe("RFB 003.008\n");
    // A masked client frame reaches the desktop.
    const payload = Buffer.from("hi");
    const mask = Buffer.from([1, 2, 3, 4]);
    socket.write(Buffer.concat([Buffer.from([0x82, 0x80 | payload.length]), mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index & 3]!))]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(Buffer.concat(frames).toString()).toBe("RFB 003.008\necho:hi");
    const closed = new Promise((resolve) => socket.once("close", resolve));
    docker.streams.at(-1)!.destroy();
    await closed;
  });
});

describe("WebSocket framing", () => {
  it("decodes masked, fragmented and large frames and refuses unmasked or oversized ones", () => {
    const mask = Buffer.from([9, 8, 7, 6]);
    const masked = (opcode: number, payload: Buffer, fin = true) => {
      const header = payload.length < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length])
        : Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126]), Buffer.from([payload.length >> 8, payload.length & 255])]);
      return Buffer.concat([header, mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index & 3]!))]);
    };
    const decode = webSocketFrameDecoder(1024);
    const big = Buffer.alloc(300, 7);
    const all = Buffer.concat([masked(2, Buffer.from("ab"), false), masked(0, Buffer.from("cd")), masked(2, big)]);
    expect(decode(all.subarray(0, 5))).toEqual([]);
    const frames = decode(all.subarray(5)) as { payload: Buffer }[];
    expect(frames.map((frame) => frame.payload.toString("hex"))).toEqual([Buffer.from("ab").toString("hex"), Buffer.from("cd").toString("hex"), big.toString("hex")]);
    expect(webSocketFrameDecoder()(Buffer.from([0x82, 0x01, 0x41]))).toEqual({ error: 1002 });
    expect(webSocketFrameDecoder(10)(masked(2, Buffer.alloc(11)))).toEqual({ error: 1009 });
    expect(encodeWebSocketFrame(2, Buffer.alloc(70000)).subarray(0, 2)).toEqual(Buffer.from([0x82, 127]));
  });
});
