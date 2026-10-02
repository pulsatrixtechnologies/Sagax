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
import { isBlockedAddress, isLanAddress, proxyFromPac, tunnelVerdict } from "./desktop-tunnel.mjs";

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
  const vm = createLocalVm({ dataDir: "/Users/ada/.openmausbot", platform: "linux", env: { PATH: "/usr/bin" }, exists: file => file === "/Users/ada/.openmausbot/vm-home", exec: async argv => {
    calls.push(argv.join(" "));
    if (argv[1] === "version") return { code: 0, stdout: "27.0\n", stderr: "" };
    if (argv[1] === "info") return { code: 0, stdout: "Docker Desktop\n", stderr: "" };
    if (argv[1] === "context") return { code: 0, stdout: "unix:///Users/ada/.docker/run/docker.sock\n", stderr: "" };
    if (argv[1] === "ps") return { code: 0, stdout: "openmausbot-computer\trunning\n", stderr: "" };
    if (argv[1] === "inspect") return argv[2] === "openmausbot-computer"
      ? { code: 0, stdout: JSON.stringify([{ Name: "/openmausbot-computer", State: { Running: true }, Config: { Labels: { "com.openmausbot.local-vm": "1" } }, Mounts: [{ Type: "bind", Source: "/Users/ada/.openmausbot/vm-home" }] }]), stderr: "" }
      : { code: 1, stdout: "", stderr: "no such container" };
    return { code: 0, stdout: "Linux\n", stderr: "" };
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
  assert.deepEqual(proxyFromPac("PROXY proxy.corp:3128; DIRECT"), { host: "proxy.corp", port: 3128 });
  assert.equal(proxyFromPac("DIRECT"), null);
  assert.equal(proxyFromPac("SOCKS5 s:1080"), null);
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
