// The desktop bridge, desktop side (electron/desktop-bridge.mjs and
// electron/desktop-tunnel.mjs): what runs on this computer for the person's
// own bots, what never does, and the connector's round trip.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { attachmentName, commandEnvironment, createDesktopBridge, createLocalVm, executeBridgeOperation, localPath, validBridgeOperation } from "./desktop-bridge.mjs";
import net from "node:net";

import { coarseFailure, isBlockedAddress, isLanAddress, openConnection, openDesktopTunnel, proxyChain, proxyCredentialsFromEnv, tunnelVerdict, TUNNEL, tunnelMessage } from "./desktop-tunnel.mjs";
import { createProxyCredentialStore, createProxyCredentials, proxyPasswordPage } from "./proxy-credentials.mjs";
import { CONTAINER, IMAGE, IMAGE_LABELS } from "./local-vm-recipe.mjs";

const posix = process.platform !== "win32";

function sandboxHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "omb-bridge-home-"));
  fs.mkdirSync(path.join(home, ".ssh"));
  fs.writeFileSync(path.join(home, ".ssh", "id_ed25519"), "PRIVATE");
  fs.mkdirSync(path.join(home, "app-data"));
  fs.writeFileSync(path.join(home, "app-data", "Cookies"), "cookie jar");
  fs.mkdirSync(path.join(home, "work"));
  fs.writeFileSync(path.join(home, "work", "notes.md"), "line one\nTODO: ship the bridge\n");
  return home;
}

const deps = home => ({
  home, attachmentsDir: path.join(home, "tmp", "attachments"),
  protectedPaths: [path.join(home, "app-data"), path.join(home, ".ssh")],
  fetchUrl: globalThis.fetch, localVm: createLocalVm({ run: async () => ({ content: [{ type: "text", text: "[exit 1]" }], isError: true }) }),
});
const signal = () => new AbortController().signal;

test("operations are checked for shape before anything runs", () => {
  assert.equal(validBridgeOperation({ action: "run_command", command: "ls" }), true);
  assert.equal(validBridgeOperation({ action: "rm_rf" }), false);
  assert.equal(validBridgeOperation({ action: "read_file", path: "~/x", extra: 1 }), false);
  assert.equal(validBridgeOperation({ action: "read_file", offset: -1 }), false);
  assert.equal(validBridgeOperation({ action: "computer_call", arguments: [] }), false);
});

test("paths are absolute or the person's home; attachment names are one file", () => {
  assert.equal(localPath("~/work/notes.md", "/home/ada"), path.resolve("/home/ada/work/notes.md"));
  assert.throws(() => localPath("work/notes.md", "/home/ada"));
  assert.equal(attachmentName("0b5a3c1e-README.md"), "0b5a3c1e-README.md");
  for (const bad of ["../x", "a/b", ".hidden", "..", "c:x"]) assert.throws(() => attachmentName(bad));
});

test("commands get no Sagax, Electron or credential variables", () => {
  const env = commandEnvironment({ PATH: "/bin", HOME: "/h", OMB_PORT: "1", SAGAX_X: "1", ELECTRON_RUN_AS_NODE: "1", OPENAI_API_KEY: "k", GITHUB_TOKEN: "t", LANG: "C" });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH"]);
});

test("files: read, write, list, search on this computer; the app's data and credential stores never", async () => {
  const home = sandboxHome();
  const d = deps(home);
  const read = await executeBridgeOperation({ action: "read_file", path: "~/work/notes.md" }, d, signal());
  assert.match(read.content[0].text, /TODO: ship the bridge/);
  const partial = await executeBridgeOperation({ action: "read_file", path: "~/work/notes.md", max_bytes: 4 }, d, signal());
  assert.match(partial.content[0].text, /^line\n\[\d+ more bytes; read again with offset 4\]/);
  await executeBridgeOperation({ action: "write_file", path: "~/work/new/out.txt", content: "hello" }, d, signal());
  assert.equal(fs.readFileSync(path.join(home, "work", "new", "out.txt"), "utf8"), "hello");
  const listed = JSON.parse((await executeBridgeOperation({ action: "list_files", path: "~/work" }, d, signal())).content[0].text);
  assert.deepEqual(listed.entries.map(entry => entry.name).sort(), ["new", "notes.md"]);
  const found = await executeBridgeOperation({ action: "search_files", path: "~", pattern: "TODO" }, d, signal());
  assert.match(found.content[0].text, /notes\.md:2: TODO: ship the bridge/);
  const names = await executeBridgeOperation({ action: "search_files", glob: "*.md" }, d, signal());
  assert.match(names.content[0].text, /notes\.md/);
  assert.doesNotMatch(names.content[0].text, /Cookies|id_ed25519/);
  await assert.rejects(executeBridgeOperation({ action: "read_file", path: "~/.ssh/id_ed25519" }, d, signal()), /cannot be accessed/);
  await assert.rejects(executeBridgeOperation({ action: "read_file", path: "~/app-data/Cookies" }, d, signal()), /cannot be accessed/);
  await assert.rejects(executeBridgeOperation({ action: "write_file", path: "~/app-data/evil", content: "x" }, d, signal()), /cannot be accessed/);
  await assert.rejects(executeBridgeOperation({ action: "list_files", path: "~/.ssh" }, d, signal()), /cannot be accessed/);
  fs.rmSync(home, { recursive: true, force: true });
});

test("attachments are copied in order into the desktop's own folder", async () => {
  const home = sandboxHome();
  const d = deps(home);
  await executeBridgeOperation({ action: "stage_file", name: "0b5a3c1e-README.md", content: Buffer.from("# He").toString("base64"), offset: 0 }, d, signal());
  await executeBridgeOperation({ action: "stage_file", name: "0b5a3c1e-README.md", content: Buffer.from("llo").toString("base64"), offset: 4, final: true }, d, signal());
  assert.equal(fs.readFileSync(path.join(d.attachmentsDir, "0b5a3c1e-README.md"), "utf8"), "# Hello");
  await assert.rejects(executeBridgeOperation({ action: "stage_file", name: "0b5a3c1e-README.md", content: "eA==", offset: 99 }, d, signal()), /out of order/);
  await assert.rejects(executeBridgeOperation({ action: "stage_file", name: "../escape", content: "eA==", offset: 0 }, d, signal()), /Invalid attachment name/);
  fs.rmSync(home, { recursive: true, force: true });
});

test("commands run in the person's shell, in their home, with a time limit", { skip: !posix }, async () => {
  const home = sandboxHome();
  const result = await executeBridgeOperation({ action: "run_command", command: "pwd; echo out; echo err >&2" }, deps(home), signal());
  assert.match(result.content[0].text, /out/);
  assert.match(result.content[0].text, /\[stderr\]\nerr/);
  assert.match(result.content[0].text, /\[exit 0\]$/);
  const slow = await executeBridgeOperation({ action: "run_command", command: "sleep 5", timeout_seconds: 1 }, deps(home), signal());
  assert.equal(slow.isError, true);
  assert.match(slow.content[0].text, /time limit/);
  fs.rmSync(home, { recursive: true, force: true });
});

test("fetch_url fetches from this computer's network", async () => {
  const server = http.createServer((req, res) => { res.setHeader("content-type", "text/plain"); res.end(`local ${req.url}`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const home = sandboxHome();
  const result = await executeBridgeOperation({ action: "fetch_url", url: `http://127.0.0.1:${server.address().port}/x` }, deps(home), signal());
  assert.match(result.content[0].text, /^HTTP 200 text\/plain\n\nlocal \/x$/);
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test("Local VM: only labelled Sagax containers", async () => {
  const calls = [];
  const vm = createLocalVm({ run: async argv => {
    calls.push(argv.join(" "));
    if (argv[1] === "version") return { content: [{ type: "text", text: "27.0\n[exit 0]" }] };
    if (argv[1] === "ps") return { content: [{ type: "text", text: "openmausbot-computer\trunning\n[exit 0]" }] };
    return { content: [{ type: "text", text: "Linux\n[exit 0]" }] };
  } });
  assert.match((await vm.status()).content[0].text, /openmausbot-computer/);
  await vm.exec(undefined, "uname");
  assert.ok(calls.includes("docker exec -u cua openmausbot-computer bash -lc uname"));
  assert.ok(calls.some(call => call.includes("label=com.openmausbot.local-vm=1")));
  await assert.rejects(vm.exec("some-other-container", "id"), /does not exist/);
});

test("network: this computer's own services and link-local never; local network only when asked", async () => {
  for (const address of ["127.0.0.1", "::1", "169.254.169.254", "0.0.0.0", "::ffff:127.0.0.1", "fe80::1"]) assert.equal(isBlockedAddress(address), true, address);
  for (const address of ["10.0.0.5", "192.168.1.2", "100.64.0.1", "8.8.8.8"]) assert.equal(isBlockedAddress(address), false, address);
  assert.equal(isLanAddress("192.168.1.2"), true);
  assert.equal(isLanAddress("8.8.8.8"), false);
  const lookup = async host => host === "intranet.test" ? [{ address: "10.1.2.3" }] : host === "public.test" ? [{ address: "93.184.216.34" }] : host === "self.test" ? [{ address: "127.0.0.1" }] : Promise.reject(new Error("nx"));
  assert.deepEqual(await tunnelVerdict("intranet.test", 443, "lan", lookup), { ok: true, address: "10.1.2.3" });
  assert.equal((await tunnelVerdict("public.test", 443, "lan", lookup)).code, "outside-lan");
  assert.equal((await tunnelVerdict("public.test", 443, "all", lookup)).ok, true);
  assert.equal((await tunnelVerdict("self.test", 80, "all", lookup)).code, "blocked");
  assert.equal((await tunnelVerdict("nowhere.test", 80, "all", lookup)).code, "unresolved");
  assert.equal((await tunnelVerdict("localhost", 80, "all", lookup, { proxied: true })).code, "blocked");
  assert.deepEqual(await tunnelVerdict("only-the-proxy.test", 443, "all", lookup, { proxied: true }), { ok: true, address: null });
  assert.equal((await tunnelVerdict("only-the-proxy.test", 443, "lan", lookup, { proxied: true })).code, "unresolved");
});

test("the connector registers as the signed-in person and answers a job", async () => {
  const seen = { connect: null, results: [] };
  let served = false;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = value => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    if (req.url === "/api/auth/session") return send({ kind: "session", identity: "perspicax" });
    if (req.url === "/api/me/preferences") return send({ preferences: {} });
    if (req.url === "/api/desktop-bridge/connect") { seen.connect = { body: JSON.parse(body), secret: req.headers["x-sagax-bridge-secret"] }; return send({ ok: true }); }
    if (req.url.endsWith("/poll")) {
      if (served) { await new Promise(resolve => setTimeout(resolve, 200)); return send({ job: null }); }
      served = true;
      return send({ job: { id: "6f9619ff-8b86-4011-b42d-00c04fc964ff", operation: { action: "list_files", path: "~/work" } } });
    }
    if (req.url.endsWith("/lease")) return send({ active: true });
    if (req.url.endsWith("/result")) { seen.results.push(JSON.parse(body)); return send({ ok: true }); }
    res.statusCode = 404; send({});
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const home = sandboxHome();
  const bridge = createDesktopBridge({
    environment: () => ({ id: "org", name: "GOX", origin }), fetch: globalThis.fetch, cookieHeader: async () => "",
    home, attachmentsDir: path.join(home, "tmp"), protectedPaths: [path.join(home, "app-data")], activityFile: path.join(home, "app-data", "bridge-activity.jsonl"),
    WebSocketImpl: null, hostname: "Ada-Mac", platform: "darwin", retryMs: 50,
  });
  bridge.sync();
  for (let tries = 0; tries < 100 && !seen.results.length; tries++) await new Promise(resolve => setTimeout(resolve, 30));
  bridge.close();
  server.close();
  assert.equal(seen.connect.body.name, "Ada-Mac");
  assert.equal(seen.connect.body.platform, "darwin");
  assert.match(seen.connect.secret, /^[a-f0-9]{64}$/);
  assert.equal(seen.connect.body.capabilities.computer, false);
  assert.equal(seen.results[0].jobId, "6f9619ff-8b86-4011-b42d-00c04fc964ff");
  assert.match(seen.results[0].result.content[0].text, /notes\.md/);
  assert.equal(bridge.activity(5)[0].action, "list_files");
  fs.rmSync(home, { recursive: true, force: true });
});

// ── system proxies: HTTP, SOCKS5 (with and without auth), SOCKS4a, PAC ──

test("the system's proxy answer (PAC result) becomes the routes to try, in order", () => {
  assert.deepEqual(proxyChain("PROXY proxy.corp:3128; DIRECT"), [{ type: "http", host: "proxy.corp", port: 3128 }, { type: "direct" }]);
  assert.deepEqual(proxyChain("DIRECT"), [{ type: "direct" }]);
  assert.deepEqual(proxyChain(""), [{ type: "direct" }]);
  assert.deepEqual(proxyChain("SOCKS5 s:1080"), [{ type: "socks5", host: "s", port: 1080 }]);
  assert.deepEqual(proxyChain("SOCKS s:1080; HTTPS [::1]:8443"), [{ type: "socks4", host: "s", port: 1080 }, { type: "https", host: "::1", port: 8443 }]);
  assert.deepEqual(proxyChain("QUIC q:443; PROXY p:99999"), [{ type: "direct" }]);
});

test("SOCKS credentials come from the desktop's environment, for that proxy only", () => {
  const find = proxyCredentialsFromEnv({ ALL_PROXY: "socks5h://ada:p%40ss@Socks.Corp:1081", HTTP_PROXY: "http://x:y@h:1" });
  assert.deepEqual(find({ host: "socks.corp", port: 1081 }), { username: "ada", password: "p@ss", source: "env" });
  assert.equal(find({ host: "socks.corp", port: 1080 }), null);
  assert.equal(find({ host: "h", port: 1 }), null);
  assert.equal(proxyCredentialsFromEnv({ ALL_PROXY: "socks5://s:1080" })({ host: "s", port: 1080 }), null);
});

/** An echo server that answers "hello" first, then echoes. */
async function echoServer() {
  // A client that resets its side (a test that ends, a refused route) must
  // not surface as an unhandled ECONNRESET after the test.
  const server = net.createServer(socket => { socket.on("error", () => {}); socket.write("hello:"); socket.pipe(socket); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server;
}

/** A minimal SOCKS5 proxy (RFC 1928/1929) that sends every CONNECT to
 * `upstreamPort` on loopback and remembers what it was asked. */
async function fakeSocks5({ upstreamPort, credentials = null, version = 5 }) {
  const seen = [];
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    let stage = "greeting";
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (version === 4 && stage === "greeting") {
          const nul = buffer.indexOf(0, 8);
          if (nul < 0) return;
          const nameEnd = buffer.indexOf(0, nul + 1);
          const isName = buffer[4] === 0 && buffer[5] === 0 && buffer[6] === 0 && buffer[7] !== 0;
          if (isName && nameEnd < 0) return;
          seen.push({ host: isName ? buffer.subarray(nul + 1, nameEnd).toString() : [...buffer.subarray(4, 8)].join("."), port: buffer.readUInt16BE(2) });
          buffer = buffer.subarray(isName ? nameEnd + 1 : nul + 1);
          stage = "relay";
          const upstream = net.connect({ host: "127.0.0.1", port: upstreamPort }, () => {
            socket.write(Buffer.from([0, 0x5a, 0, 0, 0, 0, 0, 0]));
            socket.removeAllListeners("data"); if (buffer.length) upstream.write(buffer); socket.pipe(upstream); upstream.pipe(socket);
          });
          upstream.on("error", () => socket.destroy());
          return;
        }
        if (stage === "greeting") {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
          const methods = [...buffer.subarray(2, 2 + buffer[1])];
          buffer = buffer.subarray(2 + buffer[1]);
          const want = credentials ? 2 : 0;
          if (!methods.includes(want)) { socket.end(Buffer.from([5, 0xff])); return; }
          socket.write(Buffer.from([5, want]));
          stage = credentials ? "auth" : "request";
        } else if (stage === "auth") {
          if (buffer.length < 2) return;
          const userLength = buffer[1];
          if (buffer.length < 3 + userLength) return;
          const passLength = buffer[2 + userLength];
          if (buffer.length < 3 + userLength + passLength) return;
          const user = buffer.subarray(2, 2 + userLength).toString();
          const pass = buffer.subarray(3 + userLength, 3 + userLength + passLength).toString();
          buffer = buffer.subarray(3 + userLength + passLength);
          const ok = user === credentials.username && pass === credentials.password;
          socket.write(Buffer.from([1, ok ? 0 : 1]));
          if (!ok) { socket.end(); return; }
          stage = "request";
        } else if (stage === "request") {
          if (buffer.length < 5) return;
          const type = buffer[3];
          const length = type === 1 ? 4 : type === 4 ? 16 : 1 + buffer[4];
          if (buffer.length < 4 + length + 2) return;
          const host = type === 3 ? buffer.subarray(5, 5 + buffer[4]).toString() : type === 1 ? [...buffer.subarray(4, 8)].join(".") : buffer.subarray(4, 20).toString("hex");
          seen.push({ host, port: buffer.readUInt16BE(4 + length) });
          buffer = buffer.subarray(4 + length + 2);
          stage = "relay";
          const upstream = net.connect({ host: "127.0.0.1", port: upstreamPort }, () => {
            // The reply and the first relayed bytes may share one packet.
            socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
            socket.removeAllListeners("data"); if (buffer.length) upstream.write(buffer); socket.pipe(upstream); upstream.pipe(socket);
          });
          upstream.on("error", () => socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
          return;
        } else return;
      }
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, seen, port: server.address().port };
}

const exchange = (socket, message) => new Promise((resolve, reject) => {
  let got = "";
  socket.on("data", chunk => { got += chunk; if (got.length >= 6 + message.length) { resolve(got); socket.destroy(); } });
  socket.on("error", reject);
  socket.resume();
  socket.write(message);
});

test("SOCKS5 without a password: the proxy resolves the name, nothing goes direct", async () => {
  const echo = await echoServer();
  const socks = await fakeSocks5({ upstreamPort: echo.address().port });
  const direct = [];
  const { socket, via } = await openConnection("intranet.corp", 443, null, proxyChain(`SOCKS5 127.0.0.1:${socks.port}`), {
    connect: options => { if (options.port !== socks.port) direct.push(options); return new Promise((resolve, reject) => { const s = net.connect(options, () => resolve(s)); s.once("error", reject); }); },
  });
  assert.equal(via, `socks5 127.0.0.1:${socks.port}`);
  assert.equal(await exchange(socket, "ping"), "hello:ping");
  assert.deepEqual(socks.seen, [{ host: "intranet.corp", port: 443 }]);
  assert.deepEqual(direct, []);
  socks.server.close(); echo.close();
});

test("SOCKS5 with a user name and password", async () => {
  const echo = await echoServer();
  const socks = await fakeSocks5({ upstreamPort: echo.address().port, credentials: { username: "ada", password: "s3cret" } });
  const chain = proxyChain(`SOCKS5 127.0.0.1:${socks.port}`);
  const { socket } = await openConnection("93.184.216.34", 80, "93.184.216.34", chain, { credentials: () => ({ username: "ada", password: "s3cret" }) });
  assert.equal(await exchange(socket, "x"), "hello:x");
  assert.deepEqual(socks.seen, [{ host: "93.184.216.34", port: 80 }]);
  await assert.rejects(openConnection("a.test", 80, null, chain, { credentials: () => ({ username: "ada", password: "wrong" }) }), /refused the user name and password/);
  await assert.rejects(openConnection("a.test", 80, null, chain), /asks for a user name and password/);
  socks.server.close(); echo.close();
});

test("SOCKS4a (the PAC keyword SOCKS)", async () => {
  const echo = await echoServer();
  const socks = await fakeSocks5({ upstreamPort: echo.address().port, version: 4 });
  const { socket, via } = await openConnection("wiki.corp", 8080, null, proxyChain(`SOCKS 127.0.0.1:${socks.port}`));
  assert.equal(via, `socks4 127.0.0.1:${socks.port}`);
  assert.equal(await exchange(socket, "y"), "hello:y");
  assert.deepEqual(socks.seen, [{ host: "wiki.corp", port: 8080 }]);
  socks.server.close(); echo.close();
});

test("HTTP CONNECT keeps bytes that arrive with the proxy's answer", async () => {
  const proxy = net.createServer(socket => socket.on("error", () => {}).once("data", () => socket.write("HTTP/1.1 200 Connection established\r\n\r\nhello:")));
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const { socket } = await openConnection("example.test", 443, null, proxyChain(`PROXY 127.0.0.1:${proxy.address().port}`));
  const first = await new Promise(resolve => { socket.once("data", chunk => resolve(String(chunk))); socket.resume(); });
  assert.equal(first, "hello:");
  socket.destroy(); proxy.close();
});

test("a proxy that fails is never replaced by a direct connection, unless the PAC answer lists DIRECT after it", async () => {
  const dead = net.createServer(); await new Promise(resolve => dead.listen(0, "127.0.0.1", resolve));
  const port = dead.address().port; dead.close();
  const echo = await echoServer();
  await assert.rejects(openConnection("127.0.0.1", echo.address().port, "127.0.0.1", proxyChain(`SOCKS5 127.0.0.1:${port}`)), /ECONNREFUSED/);
  const { socket, via } = await openConnection("127.0.0.1", echo.address().port, "127.0.0.1", proxyChain(`SOCKS5 127.0.0.1:${port}; DIRECT`));
  assert.equal(via, "direct");
  socket.destroy(); echo.close();
});

test("the tunnel asks the system (PAC) per destination and records the route", async () => {
  const echo = await echoServer();
  const socks = await fakeSocks5({ upstreamPort: echo.address().port });
  const asked = [];
  const records = [];
  const frames = [];
  class FakeSocket {
    constructor() { this.bufferedAmount = 0; this.readyState = 1; FakeSocket.last = this; queueMicrotask(() => this.onopen?.()); }
    send(data) { frames.push(Buffer.from(data)); }
    close() { this.onclose?.(); }
  }
  const tunnel = openDesktopTunnel({
    url: "ws://server.test/tunnel", headers: {}, WebSocketImpl: FakeSocket,
    resolveProxy: async url => { asked.push(url); return `SOCKS5 127.0.0.1:${socks.port}`; },
    lookup: async () => { throw new Error("no local DNS for it"); },
    record: entry => records.push(entry),
  });
  await tunnel.ready;
  FakeSocket.last.onmessage({ data: tunnelMessage(TUNNEL.OPEN, 7, Buffer.from(JSON.stringify({ host: "app.corp", port: 443 }))) });
  for (let tries = 0; tries < 100 && !frames.some(frame => frame[0] === TUNNEL.DATA); tries++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(asked, ["https://app.corp/"]);
  assert.equal(frames[0][0], TUNNEL.OPENED);
  assert.equal(frames.find(frame => frame[0] === TUNNEL.DATA).subarray(5).toString(), "hello:");
  assert.deepEqual(records, [{ host: "app.corp", port: 443, ok: true, via: `socks5 127.0.0.1:${socks.port}` }]);
  tunnel.close(); socks.server.close(); echo.close();
});

/** A proxy password store on a temp file, "encrypted" by base64 so the test
 * can see nothing is stored in clear. */
function testStore(dir) {
  const file = path.join(dir, "proxy-passwords.bin");
  const encryption = { available: async () => true, encrypt: async value => Buffer.from(Buffer.from(value).toString("base64")), decrypt: async buffer => ({ result: Buffer.from(buffer.toString(), "base64").toString() }) };
  return { file, store: createProxyCredentialStore({ file, encryption, fs }) };
}

test("SOCKS5 with a password set in the system settings only: the person is asked once, the answer kept encrypted per proxy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omb-proxy-pw-"));
  const echo = await echoServer();
  const socks = await fakeSocks5({ upstreamPort: echo.address().port, credentials: { username: "ada", password: "s3cret" } });
  const asked = [];
  const { file, store } = testStore(dir);
  // No ALL_PROXY: an app started from Finder, the Dock or the Start menu.
  const credentials = createProxyCredentials({ env: {}, store, prompt: async proxy => { asked.push(proxy); await new Promise(resolve => setTimeout(resolve, 20)); return { username: "ada", password: "s3cret" }; } });
  const chain = proxyChain(`SOCKS5 127.0.0.1:${socks.port}`);
  const options = { credentials, askCredentials: credentials.ask, credentialsRefused: credentials.refused };
  // two connections at once: one question
  const [first, second] = await Promise.all([openConnection("a.test", 80, null, chain, options), openConnection("b.test", 80, null, chain, options)]);
  assert.equal(await exchange(first.socket, "1"), "hello:1");
  assert.equal(await exchange(second.socket, "2"), "hello:2");
  assert.deepEqual(asked, [{ host: "127.0.0.1", port: socks.port }]);
  assert.equal(fs.readFileSync(file, "utf8").includes("s3cret"), false, "never stored in clear");
  // a later launch: the saved answer, no question
  const later = createProxyCredentials({ env: {}, store: testStore(dir).store, prompt: async () => { throw new Error("asked again"); } });
  const third = await openConnection("c.test", 80, null, chain, { credentials: later, askCredentials: later.ask, credentialsRefused: later.refused });
  assert.equal(await exchange(third.socket, "3"), "hello:3");
  socks.server.close(); echo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("SOCKS5 password questions: Cancel is not asked again, a refused saved password is forgotten and asked again", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omb-proxy-pw-"));
  const echo = await echoServer();
  const socks = await fakeSocks5({ upstreamPort: echo.address().port, credentials: { username: "ada", password: "new" } });
  const chain = proxyChain(`SOCKS5 127.0.0.1:${socks.port}`);
  const proxy = { host: "127.0.0.1", port: socks.port };
  let asked = 0;
  const declining = createProxyCredentials({ env: {}, store: testStore(dir).store, prompt: async () => { asked++; return null; } });
  const decline = { credentials: declining, askCredentials: declining.ask, credentialsRefused: declining.refused };
  await assert.rejects(openConnection("a.test", 80, null, chain, decline), error => error.code === "proxy-auth" && error.proxy === true);
  await assert.rejects(openConnection("a.test", 80, null, chain, decline), /asks for a user name and password/);
  assert.equal(asked, 1);
  // an old saved password: refused, forgotten, the person asked, the new one kept
  const { store } = testStore(dir);
  await store.set(proxy, { username: "ada", password: "old" });
  const answers = [];
  const changed = createProxyCredentials({ env: {}, store, prompt: async () => { answers.push("asked"); return { username: "ada", password: "new" }; } });
  const { socket } = await openConnection("a.test", 80, null, chain, { credentials: changed, askCredentials: changed.ask, credentialsRefused: changed.refused });
  assert.equal(await exchange(socket, "z"), "hello:z");
  assert.deepEqual(answers, ["asked"]);
  assert.deepEqual(await testStore(dir).store.get(proxy), { username: "ada", password: "new" });
  // the environment wins, and a refused environment password is not replaced by a question
  const fromEnv = createProxyCredentials({ env: { ALL_PROXY: `socks5://ada:wrong@127.0.0.1:${socks.port}` }, store, prompt: async () => { throw new Error("asked"); } });
  await assert.rejects(openConnection("a.test", 80, null, chain, { credentials: fromEnv, askCredentials: fromEnv.ask, credentialsRefused: fromEnv.refused }), /refused the user name and password/);
  assert.deepEqual(await store.get(proxy), { username: "ada", password: "new" });
  socks.server.close(); echo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the proxy password question names the proxy, in French or English, with nothing to load", () => {
  const en = proxyPasswordPage({ host: "socks.corp", port: 1080 });
  assert.match(en, /socks\.corp:1080/);
  assert.match(en, /type="password"/);
  assert.match(en, /default-src 'none'/);
  assert.match(proxyPasswordPage({ host: "s", port: 1, french: true }), /Mot de passe/);
  assert.doesNotMatch(proxyPasswordPage({ host: "<img src=x>", port: 1 }), /<img/);
});

test("the server learns a coarse reason; the proxy's address and the local error stay in the activity log", async () => {
  const dead = net.createServer(); await new Promise(resolve => dead.listen(0, "127.0.0.1", resolve));
  const port = dead.address().port; dead.close();
  const records = [];
  const frames = [];
  class FakeSocket {
    constructor() { this.bufferedAmount = 0; this.readyState = 1; FakeSocket.last = this; queueMicrotask(() => this.onopen?.()); }
    send(data) { frames.push(Buffer.from(data)); }
    close() { this.onclose?.(); }
  }
  const tunnel = openDesktopTunnel({
    url: "ws://server.test/tunnel", headers: {}, WebSocketImpl: FakeSocket,
    resolveProxy: async () => `SOCKS5 127.0.0.1:${port}`,
    lookup: async () => [{ address: "93.184.216.34" }],
    record: entry => records.push(entry),
  });
  await tunnel.ready;
  FakeSocket.last.onmessage({ data: tunnelMessage(TUNNEL.OPEN, 3, Buffer.from(JSON.stringify({ host: "example.test", port: 443 }))) });
  for (let tries = 0; tries < 100 && !frames.some(frame => frame[0] === TUNNEL.FAILED); tries++) await new Promise(resolve => setTimeout(resolve, 20));
  const failed = JSON.parse(frames.find(frame => frame[0] === TUNNEL.FAILED).subarray(5).toString());
  assert.equal(failed.message, "Could not connect to example.test:443 from this computer (the system proxy refused the connection or could not be reached)");
  assert.doesNotMatch(failed.message, new RegExp(String(port)));
  assert.match(records[0].error, /ECONNREFUSED/);
  assert.equal(coarseFailure(Object.assign(new Error("x"), { code: "proxy-auth" })), "the system proxy needs a user name and password");
  assert.equal(coarseFailure(new Error("connect ECONNREFUSED 10.1.2.3:443")), "the destination refused the connection or could not be reached");
  tunnel.close();
});

test("a system proxy lookup that fails (PAC out of reach) goes direct, and the activity log says why", async () => {
  const echo = await echoServer();
  const records = [];
  const frames = [];
  class FakeSocket {
    constructor() { this.bufferedAmount = 0; this.readyState = 1; FakeSocket.last = this; queueMicrotask(() => this.onopen?.()); }
    send(data) { frames.push(Buffer.from(data)); }
    close() { this.onclose?.(); }
  }
  const tunnel = openDesktopTunnel({
    url: "ws://server.test/tunnel", headers: {}, WebSocketImpl: FakeSocket,
    resolveProxy: async () => { throw new Error("PAC script failed"); },
    lookup: async () => [{ address: "93.184.216.34" }],
    connect: () => new Promise((resolve, reject) => { const s = net.connect({ host: "127.0.0.1", port: echo.address().port }, () => resolve(s)); s.once("error", reject); }),
    record: entry => records.push(entry),
  });
  await tunnel.ready;
  FakeSocket.last.onmessage({ data: tunnelMessage(TUNNEL.OPEN, 5, Buffer.from(JSON.stringify({ host: "example.test", port: 443 }))) });
  for (let tries = 0; tries < 100 && !records.length; tries++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(records, [{ host: "example.test", port: 443, ok: true, via: "direct (system proxy lookup failed)" }]);
  tunnel.close(); echo.close();
});

// ── Local VM creation on this computer, after the person's yes ──

function fakeRuntime({ image = false, containers = "", fail = {} } = {}) {
  const calls = [];
  let created = false;
  let built = image;
  const out = value => ({ content: [{ type: "text", text: `${value}\n[exit 0]` }] });
  const bad = value => ({ content: [{ type: "text", text: `${value}\n[exit 1]` }], isError: true });
  const run = async argv => {
    calls.push(argv);
    const [, verb] = argv;
    if (verb === "version") return out("27.0");
    if (verb === "ps") return out(created ? `${CONTAINER}\trunning` : containers);
    if (verb === "image") return built ? out(JSON.stringify(IMAGE_LABELS)) : bad("No such image");
    if (verb === "pull") return fail.pull ? bad("network down") : out("pulled");
    if (verb === "build") { built = true; return out("built"); }
    if (verb === "run") { created = true; return out("abc123"); }
    if (verb === "exec") return out("");
    return bad("unexpected");
  };
  return { run, calls };
}

test("Local VM create: the person declines on this computer, nothing is created", async () => {
  const home = sandboxHome();
  const runtime = fakeRuntime();
  const asked = [];
  const vm = createLocalVm({ run: runtime.run, workspaceDir: path.join(home, "vm-home"), confirm: async question => { asked.push(question); return false; } });
  const progress = [];
  const result = await vm.create({ progress: message => progress.push(message) });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /declined/);
  // nothing reported before (or without) the yes: the turn never shows set up
  assert.deepEqual(progress, []);
  assert.equal(asked[0].runtime, "docker");
  assert.equal(asked[0].needsImage, true);
  assert.equal(runtime.calls.some(argv => ["pull", "build", "run"].includes(argv[1])), false);
  fs.rmSync(home, { recursive: true, force: true });
});

test("Local VM create: yes on this computer, the image is prepared and the VM created like solo mode, progress goes to the turn", async () => {
  const home = sandboxHome();
  const runtime = fakeRuntime();
  const progress = [];
  const workspaceDir = path.join(home, "vm-home");
  const vm = createLocalVm({ run: runtime.run, workspaceDir, confirm: async () => true, password: () => "pw", pollMs: 1 });
  const result = await vm.create({ progress: message => progress.push(message) });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /is ready on this computer \(docker\)/);
  assert.deepEqual(runtime.calls.filter(argv => ["pull", "build", "run"].includes(argv[1])).map(argv => argv[1]), ["pull", "build", "run"]);
  const runArgv = runtime.calls.find(argv => argv[1] === "run");
  assert.ok(runArgv.includes(IMAGE));
  assert.ok(runArgv.includes("VNC_PW=pw"));
  assert.ok(runArgv.some(arg => arg.includes(`source=${workspaceDir}`)));
  assert.ok(runArgv.includes("ALL"), "capabilities dropped");
  assert.equal(fs.statSync(workspaceDir).isDirectory(), true);
  assert.deepEqual(progress.map(message => message.split(" (")[0]), [
    "Downloading the Local VM desktop image",
    "Building the Local VM desktop image",
    "Creating the Local VM",
    "Waiting for the Local VM desktop to start",
  ]);
  fs.rmSync(home, { recursive: true, force: true });
});

test("Local VM create: an existing VM, a prepared image, no runtime, a failed download", async () => {
  const home = sandboxHome();
  const existing = createLocalVm({ run: fakeRuntime({ containers: `${CONTAINER}\texited` }).run, workspaceDir: home, confirm: async () => assert.fail("no prompt for an existing VM") });
  assert.match((await existing.create()).content[0].text, /already exists .*Start it/);
  const prepared = fakeRuntime({ image: true });
  const asked = [];
  await createLocalVm({ run: prepared.run, workspaceDir: path.join(home, "w"), confirm: async question => { asked.push(question); return true; }, pollMs: 1 }).create();
  assert.equal(asked[0].needsImage, false);
  assert.equal(prepared.calls.some(argv => argv[1] === "pull"), false);
  const none = createLocalVm({ run: async () => ({ content: [{ type: "text", text: "[exit 127]" }], isError: true }), workspaceDir: home, confirm: async () => true });
  await assert.rejects(none.create(), /No container runtime/);
  const offline = createLocalVm({ run: fakeRuntime({ fail: { pull: true } }).run, workspaceDir: home, confirm: async () => true });
  await assert.rejects(offline.create(), /Downloading the desktop image failed: network down/);
  const old = createLocalVm({ run: fakeRuntime().run });
  await assert.rejects(old.create(), /cannot create a Local VM here/);
  fs.rmSync(home, { recursive: true, force: true });
});

test("Local VM create: a turn that ends does not stop a creation under way; the next one attaches to it", async () => {
  const home = sandboxHome();
  const runtime = fakeRuntime();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const slow = async argv => { if (argv[1] === "pull") await gate; return runtime.run(argv); };
  const vm = createLocalVm({ run: slow, workspaceDir: path.join(home, "w"), confirm: async () => true, pollMs: 1 });
  const turn = new AbortController();
  const first = vm.create({ signal: turn.signal });
  for (let tries = 0; tries < 50 && !runtime.calls.some(argv => argv[1] === "pull"); tries++) await new Promise(resolve => setTimeout(resolve, 5));
  turn.abort();
  assert.match((await first).content[0].text, /keeps being created/);
  assert.match((await vm.status()).content[0].text, /"creating":"Downloading/);
  const progress = [];
  const second = vm.create({ progress: message => progress.push(message) });
  release();
  assert.match((await second).content[0].text, /is ready/);
  assert.match(progress[0], /^Already being created on this computer/);
  assert.equal(runtime.calls.filter(argv => argv[1] === "run").length, 1);
  fs.rmSync(home, { recursive: true, force: true });
});

test("the connector sends a Local VM creation's progress to the server", async () => {
  const seen = { progress: [], results: [] };
  let served = false;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = value => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    if (req.url === "/api/auth/session") return send({ kind: "session", identity: "perspicax" });
    if (req.url === "/api/me/preferences") return send({ preferences: {} });
    if (req.url === "/api/desktop-bridge/connect") return send({ ok: true });
    if (req.url.endsWith("/poll")) {
      if (served) { await new Promise(resolve => setTimeout(resolve, 200)); return send({ job: null }); }
      served = true;
      return send({ job: { id: "6f9619ff-8b86-4011-b42d-00c04fc964fe", operation: { action: "vm_create", timeout_seconds: 600 } } });
    }
    if (req.url.endsWith("/lease")) return send({ active: true });
    if (req.url.endsWith("/progress")) { seen.progress.push(JSON.parse(body)); return send({ ok: true }); }
    if (req.url.endsWith("/result")) { seen.results.push(JSON.parse(body)); return send({ ok: true }); }
    res.statusCode = 404; send({});
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const home = sandboxHome();
  const bridge = createDesktopBridge({
    environment: () => ({ id: "org", name: "GOX", origin }), fetch: globalThis.fetch, cookieHeader: async () => "",
    home, attachmentsDir: path.join(home, "tmp"), activityFile: path.join(home, "app-data", "bridge-activity.jsonl"),
    WebSocketImpl: null, retryMs: 50,
    localVm: createLocalVm({ run: fakeRuntime({ image: true }).run, workspaceDir: path.join(home, "vm-home"), confirm: async () => true, pollMs: 1 }),
  });
  bridge.sync();
  for (let tries = 0; tries < 100 && !seen.results.length; tries++) await new Promise(resolve => setTimeout(resolve, 30));
  bridge.close();
  server.close();
  assert.match(seen.results[0].result.content[0].text, /is ready/);
  assert.ok(seen.progress.length >= 2);
  assert.ok(seen.progress.every(entry => entry.jobId === "6f9619ff-8b86-4011-b42d-00c04fc964fe"));
  assert.ok(seen.progress.some(entry => entry.message === "Creating the Local VM"));
  fs.rmSync(home, { recursive: true, force: true });
});
