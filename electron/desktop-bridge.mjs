// The desktop bridge, desktop side (server mode). While this app is signed in
// to its organization server, it is the bridge between that server and this
// computer: the server's bots, working for THIS person, run the solo-mode
// tools here (shell, files, search, fetch, browser, computer use, Local VM)
// and their network traffic leaves through here (electron/desktop-tunnel.mjs).
// The server side is server/desktop-bridge.ts.
//
// Outbound only (HTTPS long poll + one WebSocket); no port opens here. The
// session cookie and the bridge secret stay in the main process. Approvals
// happen where solo shows them: the bot's approval mode, in the chat. This
// side keeps its own last say: the app's own data, its cookies and the
// person's credential stores are never read or written through the bridge,
// sizes are bounded, and every action is recorded in this computer's
// activity log (action and target only, never contents).
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { assertOutsideProtected, createSharedCua, personalSecretPaths, protectedIdentities, sharedComputerError } from "./shared-computer-access.mjs";
import { createLendingActivity } from "./lending-activity.mjs";
import { openDesktopTunnel } from "./desktop-tunnel.mjs";
import { BASE_IMAGE, CONTAINER, CUA_SOCKET, DOCKERFILE, IMAGE, IMAGE_LABELS, MANAGED_LABEL, runArgs } from "./local-vm-recipe.mjs";

const OUTPUT_LIMIT = 512 * 1024;
const READ_DEFAULT = 256_000;
const READ_MAX = 1_000_000;
const WRITE_MAX = 1024 * 1024;
const FETCH_MAX = 256 * 1024;
const STAGE_MAX = 25 * 1024 * 1024;
const ACTIONS = new Set(["run_command", "read_file", "write_file", "list_files", "search_files", "fetch_url", "browse", "computer_tools", "computer_call", "vm_status", "vm_start", "vm_run_command", "vm_create", "stage_file"]);
const KEYS = new Set(["action", "path", "content", "encoding", "offset", "max_bytes", "command", "cwd", "timeout_seconds", "pattern", "glob", "url", "screenshot", "tool_name", "arguments", "container", "name", "final"]);
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const text = value => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
const failure = message => ({ ...text(message), isError: true });

/** The server's operation, checked for shape before anything looks at it. */
export function validBridgeOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return false;
  if (!Object.keys(operation).every(key => KEYS.has(key)) || !ACTIONS.has(operation.action)) return false;
  for (const key of ["path", "command", "cwd", "pattern", "glob", "url", "tool_name", "container", "name"]) {
    if (operation[key] !== undefined && (typeof operation[key] !== "string" || operation[key].length > 100_000)) return false;
  }
  if (operation.content !== undefined && (typeof operation.content !== "string" || operation.content.length > 1_500_000)) return false;
  for (const key of ["offset", "max_bytes", "timeout_seconds"]) {
    if (operation[key] !== undefined && (typeof operation[key] !== "number" || !Number.isFinite(operation[key]) || operation[key] < 0)) return false;
  }
  if (operation.arguments !== undefined && (!operation.arguments || typeof operation.arguments !== "object" || Array.isArray(operation.arguments))) return false;
  return true;
}

/** ~ and ~/x are the person's home; anything else must be absolute. */
export function localPath(value, home) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("Give a path");
  const expanded = value === "~" ? home : value.startsWith("~/") || value.startsWith("~\\") ? path.join(home, value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw new Error("Use an absolute path, or ~/... for your home folder");
  return path.resolve(expanded);
}

/** A name safe as one file in the attachments folder. */
export function attachmentName(value) {
  if (typeof value !== "string" || !value || value.length > 255 || /[\\/:\0]/.test(value) || value === "." || value === ".." || value.startsWith(".")) throw new Error("Invalid attachment name");
  return value;
}

/** No Sagax, Electron or credential variables reach a command. */
export function commandEnvironment(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (/^(OMB_|SAGAX_|ELECTRON_|OPENMAUSBOT_|CHROME_)/i.test(key)) continue;
    if (/(API_KEY|_TOKEN$|SECRET|PASSWORD|_KEY_FILE$)/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

/** A command in the person's own shell (login shell on macOS and Linux,
 * PowerShell on Windows), like their terminal. */
export function runCommand(command, { cwd, timeoutSeconds = 120, signal, env = commandEnvironment(), argv } = {}) {
  if (!argv && (typeof command !== "string" || !command.trim())) throw new Error("Give a command");
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const [file, ...args] = argv ?? (windows
      ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")]
      : [process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : "/bin/sh", "-lc", command]);
    const child = spawn(file, args, { cwd, env, detached: !windows, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const out = []; const err = []; let bytes = 0; let truncated = false; let stopped = null;
    const stop = reason => { stopped = reason; killTree(child); };
    const timer = setTimeout(() => stop("time limit reached"), Math.min(600, Math.max(1, timeoutSeconds)) * 1000);
    const abort = () => stop("the requesting turn ended");
    signal?.addEventListener("abort", abort, { once: true });
    const take = target => chunk => {
      bytes += chunk.length;
      if (bytes <= OUTPUT_LIMIT) target.push(chunk); else if (!truncated) { truncated = true; }
    };
    child.stdout.on("data", take(out));
    child.stderr.on("data", take(err));
    child.once("error", error => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
    child.once("close", code => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      const parts = [stdout, stderr ? `${stdout ? "\n" : ""}[stderr]\n${stderr}` : "", truncated ? "\n[output shortened]" : "", stopped ? `\n[stopped: ${stopped}]` : "", `\n[exit ${code ?? "unknown"}]`];
      resolve({ ...text(parts.join("").trimStart()), ...(code === 0 && !stopped ? {} : { isError: true }) });
    });
  });
}

function globRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/** File names matching a glob and/or lines matching a pattern, bounded. */
export async function searchFiles(root, { pattern, glob, protectedRoots, signal }) {
  const nameMatch = glob ? globRegex(glob) : null;
  let lineMatch = null;
  if (pattern) { try { lineMatch = new RegExp(pattern); } catch { throw new Error("pattern is not a valid regular expression"); } }
  const results = []; let visited = 0;
  const skip = new Set([".git", "node_modules", ".Trash", "Library", "AppData"]);
  const pending = [root];
  while (pending.length && results.length < 200 && visited < 20_000) {
    signal?.throwIfAborted();
    const dir = pending.shift();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (results.length >= 200 || visited >= 20_000) break;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      try { await assertOutsideProtected(protectedRoots, full); } catch { continue; }
      visited++;
      if (entry.isDirectory()) { if (!skip.has(entry.name)) pending.push(full); continue; }
      if (!entry.isFile()) continue;
      if (nameMatch && !nameMatch.test(entry.name)) continue;
      if (!lineMatch) { results.push(full); continue; }
      try {
        const info = await fs.stat(full);
        if (info.size > 2 * 1024 * 1024) continue;
        const content = await fs.readFile(full);
        if (content.includes(0)) continue;
        const lines = content.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length && results.length < 200; index++) {
          if (lineMatch.test(lines[index])) results.push(`${full}:${index + 1}: ${lines[index].slice(0, 300)}`);
        }
      } catch { /* unreadable */ }
    }
  }
  return text(results.length ? `${results.join("\n")}${results.length >= 200 || visited >= 20_000 ? "\n[more results not shown]" : ""}` : "No matches.");
}

/** Local VM: the Sagax Linux desktop container(s) on this computer, by
 * their labels; nothing else is ever started or entered. `create` makes the
 * shared Local VM the way solo mode does (the pinned image and hardened run
 * arguments of electron/local-vm-recipe.mjs, generated from
 * server/container-computer.ts), only after the person said yes on this
 * computer (`confirm`, the desktop app's own prompt). */
export function createLocalVm({
  run = (argv, options) => runCommand("", { ...options, argv }), confirm = null, workspaceDir = null,
  password = () => randomBytes(6).toString("base64url"), readyWaitMs = 90_000, pollMs = 2000,
} = {}) {
  let runtime;
  let creating = null;
  let confirming = false;
  const cli = async () => {
    if (runtime) return runtime;
    for (const candidate of ["docker", "podman"]) {
      const answer = await run([candidate, "version", "--format", "{{.Client.Version}}"], { timeoutSeconds: 15 }).catch(() => null);
      if (answer && !answer.isError) { runtime = candidate; return runtime; }
    }
    return null;
  };
  const list = async () => {
    const tool = await cli();
    if (!tool) throw new Error("No container runtime (Docker or Podman) on this computer, so there is no Local VM here.");
    const answer = await run([tool, "ps", "-a", "--filter", `label=${MANAGED_LABEL}=1`, "--format", "{{.Names}}\t{{.State}}"], { timeoutSeconds: 30 });
    if (answer.isError) throw new Error("The container runtime did not answer.");
    return answer.content[0].text.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("[exit")).map(line => { const [name, state] = line.split("\t"); return { name, state }; }).filter(entry => /^[\w.-]+$/.test(entry.name ?? ""));
  };
  const pick = async container => {
    const all = await list();
    if (!all.length) throw new Error("No Local VM exists on this computer yet. Create one with the local_vm action create (the person confirms it on this computer).");
    const chosen = container ? all.find(entry => entry.name === container) : all[0];
    if (!chosen) throw new Error("That Local VM does not exist on this computer.");
    return chosen;
  };
  const output = answer => (answer?.content?.[0]?.text ?? "").split("\n").filter(line => line.trim() && !line.startsWith("[exit")).slice(-3).join(" ").slice(0, 400);
  /** The image is there and carries the labels solo mode checks. */
  const imageReady = async tool => {
    const answer = await run([tool, "image", "inspect", IMAGE, "--format", "{{json .Config.Labels}}"], { timeoutSeconds: 30 }).catch(() => null);
    if (!answer || answer.isError) return false;
    try {
      const labels = JSON.parse(answer.content[0].text.split("\n")[0]);
      return Object.entries(IMAGE_LABELS).every(([key, value]) => labels?.[key] === value);
    } catch { return false; }
  };
  const until = (promise, signal) => new Promise((resolve, reject) => {
    if (!signal) { promise.then(resolve, reject); return; }
    const stop = () => resolve(failure("The turn ended while the Local VM was being created. It keeps being created on this computer; ask for its status later."));
    if (signal.aborted) { stop(); return; }
    signal.addEventListener("abort", stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
  const provision = async (tool, needsImage, step) => {
    const steps = [];
    const say = message => { steps.push(message); step(message); };
    if (needsImage) {
      say("Downloading the Local VM desktop image (the first time takes several minutes)");
      const pulled = await run([tool, "pull", BASE_IMAGE], { timeoutSeconds: 600 });
      if (pulled.isError) throw new Error(`Downloading the desktop image failed: ${output(pulled)}`);
      say("Building the Local VM desktop image");
      const context = await fs.mkdtemp(path.join(os.tmpdir(), "sagax-local-vm-"));
      try {
        await fs.writeFile(path.join(context, "Dockerfile"), DOCKERFILE, { mode: 0o600 });
        const built = await run([tool, "build", "-t", IMAGE, context], { timeoutSeconds: 600 });
        if (built.isError) throw new Error(`Building the desktop image failed: ${output(built)}`);
      } finally { await fs.rm(context, { recursive: true, force: true }).catch(() => {}); }
      if (!(await imageReady(tool))) throw new Error("The desktop image was built but does not carry the expected labels.");
    }
    say("Creating the Local VM");
    await fs.mkdir(workspaceDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await fs.chmod(workspaceDir, 0o700);
    const created = await run([tool, ...runArgs(tool, password(), workspaceDir)], { timeoutSeconds: 120 });
    if (created.isError) throw new Error(`Creating the Local VM failed: ${output(created)}`);
    say("Waiting for the Local VM desktop to start");
    const deadline = Date.now() + readyWaitMs;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      const probe = await run([tool, "exec", "-u", "cua", CONTAINER, "test", "-S", CUA_SOCKET], { timeoutSeconds: 15 }).catch(() => null);
      ready = Boolean(probe && !probe.isError);
      if (!ready) await delay(pollMs);
    }
    const done = ready ? `The Local VM ${CONTAINER} is ready on this computer (${tool}).` : `The Local VM ${CONTAINER} was created on this computer (${tool}); its desktop is still starting. Check again with status in a minute.`;
    return text(`${done}\n${steps.map(entry => `- ${entry}`).join("\n")}`);
  };
  return {
    async status() { return text({ localVms: await list(), ...(creating ? { creating: creating.step } : {}) }); },
    async start(container) {
      const tool = await cli(); const chosen = await pick(container);
      if (/running/i.test(chosen.state ?? "")) return text(`${chosen.name} is already running`);
      return run([tool, "start", chosen.name], { timeoutSeconds: 120 });
    },
    async exec(container, command, options) {
      const tool = await cli(); const chosen = await pick(container);
      if (!/running/i.test(chosen.state ?? "")) throw new Error(`${chosen.name} is not running; start it first`);
      return run([tool, "exec", "-u", "cua", chosen.name, "bash", "-lc", command], options);
    },
    /** Create the Local VM here, after the person's yes on this computer.
     * Progress goes to `progress` (the turn), only once the person said yes;
     * a turn that ends does not stop a creation already under way. */
    async create({ signal, progress = () => {} } = {}) {
      const report = message => { try { progress(message); } catch { /* best effort */ } };
      if (creating) { report(`Already being created on this computer: ${creating.step}`); return until(creating.promise, signal); }
      if (!confirm || !workspaceDir) throw new Error("This Sagax desktop app cannot create a Local VM here. Update it, or create the Local VM from its settings.");
      const tool = await cli();
      if (!tool) throw new Error("No container runtime (Docker or Podman) on this computer. Install Docker Desktop or Podman, start it, then ask again.");
      const existing = await list();
      if (existing.length) {
        const running = existing.find(entry => /running/i.test(entry.state ?? ""));
        return text(running ? `A Local VM already exists and is running on this computer: ${running.name}.` : `A Local VM already exists on this computer: ${existing[0].name} (${existing[0].state ?? "stopped"}). Start it with the action start.`);
      }
      if (confirming) throw new Error("A Local VM creation is already waiting for the person's answer on this computer.");
      const needsImage = !(await imageReady(tool));
      // Nothing is reported before the person's yes: the server starts showing
      // the bot's computer being set up at the first step it receives.
      confirming = true;
      let allowed;
      try { allowed = await confirm({ runtime: tool, needsImage, signal }); } finally { confirming = false; }
      if (signal?.aborted) return failure("The turn ended before the person answered. Nothing was created.");
      if (!allowed) return failure("The person declined creating a Local VM on their computer. Nothing was created.");
      if (creating) return until(creating.promise, signal);
      const entry = { step: "starting" };
      entry.promise = provision(tool, needsImage, message => { entry.step = message; report(message); }).finally(() => { if (creating === entry) creating = null; });
      entry.promise.catch(() => {});
      creating = entry;
      return until(entry.promise, signal);
    },
  };
}

/** Run one operation on this computer. `deps` holds what only Electron or
 * the person's settings provide. */
export async function executeBridgeOperation(operation, deps, signal) {
  const home = deps.home;
  const protectedRoots = await protectedIdentities(deps.protectedPaths);
  switch (operation.action) {
    case "run_command": {
      const cwd = operation.cwd ? localPath(operation.cwd, home) : home;
      return runCommand(operation.command, { cwd, timeoutSeconds: operation.timeout_seconds ?? 120, signal });
    }
    case "read_file": {
      const target = localPath(operation.path, home);
      await assertOutsideProtected(protectedRoots, target);
      const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error("Not a file");
        const max = Math.min(READ_MAX, Math.max(1, Math.floor(operation.max_bytes ?? READ_DEFAULT)));
        const offset = Math.max(0, Math.floor(operation.offset ?? 0));
        const buffer = Buffer.alloc(Math.min(max, Math.max(0, info.size - offset)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        const data = buffer.subarray(0, bytesRead);
        const more = offset + bytesRead < info.size ? `\n[${info.size - offset - bytesRead} more bytes; read again with offset ${offset + bytesRead}]` : "";
        if (operation.encoding === "base64") return text(`${data.toString("base64")}${more}`);
        if (data.includes(0)) return failure("This is a binary file; read it with encoding base64.");
        return text(`${data.toString("utf8")}${more}`);
      } finally { await handle.close(); }
    }
    case "write_file": {
      const target = localPath(operation.path, home);
      await assertOutsideProtected(protectedRoots, target);
      const data = Buffer.from(operation.content ?? "", operation.encoding === "base64" ? "base64" : "utf8");
      if (data.length > WRITE_MAX) throw new Error("Files are limited to 1 MiB per write");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await assertOutsideProtected(protectedRoots, target);
      await fs.writeFile(target, data, { flag: "w" });
      return text(`wrote ${data.length} bytes to ${target}`);
    }
    case "list_files": {
      const target = operation.path ? localPath(operation.path, home) : home;
      await assertOutsideProtected(protectedRoots, target);
      const entries = await fs.readdir(target, { withFileTypes: true });
      const shown = [];
      for (const entry of entries.slice(0, 500)) {
        const full = path.join(target, entry.name);
        let size;
        if (entry.isFile()) { try { size = (await fs.stat(full)).size; } catch { /* vanished */ } }
        shown.push({ name: entry.name, type: entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other", ...(size !== undefined ? { size } : {}) });
      }
      return text({ path: target, entries: shown, truncated: entries.length > 500 });
    }
    case "search_files": {
      const root = operation.path ? localPath(operation.path, home) : home;
      await assertOutsideProtected(protectedRoots, root);
      return searchFiles(root, { pattern: operation.pattern, glob: operation.glob, protectedRoots, signal });
    }
    case "fetch_url": {
      const url = new URL(operation.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("http or https only");
      const response = await deps.fetchUrl(url.href, { redirect: "follow", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
      const reader = response.body?.getReader();
      const chunks = []; let bytes = 0; let truncated = false;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > FETCH_MAX) { truncated = true; chunks.push(Buffer.from(value).subarray(0, value.length - (bytes - FETCH_MAX))); await reader.cancel().catch(() => {}); break; }
        chunks.push(Buffer.from(value));
      }
      const body = Buffer.concat(chunks);
      const type = response.headers.get("content-type") ?? "";
      const shown = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|[^;]*\+(json|xml))/i.test(type) || !body.includes(0) ? body.toString("utf8") : `[${body.length} bytes of ${type || "binary data"}]`;
      return { ...text(`HTTP ${response.status} ${type}\n\n${shown}${truncated ? "\n[response shortened]" : ""}`), ...(response.ok ? {} : { isError: true }) };
    }
    case "browse": {
      if (!deps.browse) throw new Error("No browser is available on this computer");
      return deps.browse(operation.url, operation.screenshot === true, signal);
    }
    case "computer_tools":
    case "computer_call": {
      if (!deps.computer) throw new Error("Computer use is unavailable on this computer. Enable it in the desktop app and grant the OS permissions first.");
      return deps.computer(operation, signal);
    }
    case "vm_status": return deps.localVm.status();
    case "vm_start": return deps.localVm.start(operation.container);
    case "vm_run_command": return deps.localVm.exec(operation.container, operation.command, { timeoutSeconds: operation.timeout_seconds ?? 120, signal });
    case "vm_create": return deps.localVm.create({ signal, progress: deps.progress });
    case "stage_file": {
      const dir = deps.attachmentsDir;
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const target = path.join(dir, attachmentName(operation.name));
      const data = Buffer.from(operation.content ?? "", "base64");
      const offset = Math.floor(operation.offset ?? 0);
      if (offset + data.length > STAGE_MAX) throw new Error("Attachment too large");
      if (offset === 0) await fs.writeFile(target, data, { mode: 0o600 });
      else {
        const info = await fs.stat(target);
        if (info.size !== offset) throw new Error("Attachment chunks out of order");
        await fs.appendFile(target, data);
      }
      return text(operation.final ? `saved ${target}` : "ok");
    }
    default:
      throw new Error("Unsupported operation");
  }
}

const describe = operation => {
  switch (operation.action) {
    case "run_command": case "vm_run_command": return String(operation.command ?? "").slice(0, 300);
    case "read_file": case "write_file": case "list_files": case "search_files": return String(operation.path ?? "~").slice(0, 300);
    case "fetch_url": case "browse": try { return new URL(operation.url).host; } catch { return ""; }
    case "computer_call": return String(operation.tool_name ?? "");
    case "stage_file": return String(operation.name ?? "");
    default: return "";
  }
};

/** The connector: keeps this desktop registered with its organization
 * server while the app is in server mode and signed in. */
export function createDesktopBridge({
  environment, fetch: fetchImpl, cookieHeader, home = os.homedir(), attachmentsDir, protectedPaths = [], activityFile,
  fetchUrl = globalThis.fetch, browse, cuaConnection, hostControl, resolveProxy, proxyCredentials, lookup, tunnelConnect, WebSocketImpl = globalThis.WebSocket,
  platform = process.platform, hostname = os.hostname(), onChange = () => {}, confirmLocalVm = null, localVmWorkspace = null,
  localVm = createLocalVm({ confirm: confirmLocalVm, workspaceDir: localVmWorkspace }), retryMs = 5000,
}) {
  const roots = [...protectedPaths, ...personalSecretPaths(home)];
  const activity = createLendingActivity(activityFile);
  let running = null;
  let state = { connected: false, tunnel: false };
  const set = next => { state = { ...state, ...next }; try { onChange(state); } catch { /* indicator only */ } };
  let network = "all";

  const request = async (env, route, body, signal, secret) => {
    const origin = new URL(env.origin);
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new Error("The desktop bridge requires an HTTPS server address");
    const response = await fetchImpl(`${env.origin}${route}`, {
      method: body === undefined ? "GET" : "POST", credentials: "include", redirect: "error", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(10_000),
      headers: { origin: env.origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(secret ? { "x-sagax-bridge-secret": secret } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let json; try { json = JSON.parse(raw); } catch { json = null; }
    if (!response.ok) throw Object.assign(new Error(json?.error ?? `Server request failed (${response.status})`), { status: response.status });
    return json;
  };

  const run = env => {
    const abort = new AbortController();
    const signal = abort.signal;
    let tunnel = null;
    let cua = null;
    let registered = null;
    const loop = async () => {
      while (!signal.aborted) {
        const id = randomUUID();
        const secret = randomBytes(32).toString("hex");
        // One registration: its tunnel and preference refresh end with it.
        const connection = new AbortController();
        const live = AbortSignal.any([signal, connection.signal]);
        try {
          const session = await request(env, "/api/auth/session");
          if (session?.kind !== "session" || session?.identity !== "perspicax") throw Object.assign(new Error("Sign in to this server first"), { quiet: true });
          await request(env, "/api/desktop-bridge/connect", {
            id, name: hostname.slice(0, 120) || "Computer", platform: ["darwin", "win32", "linux"].includes(platform) ? platform : "linux", attachmentsDir,
            capabilities: { shell: true, files: true, fetch: true, browser: Boolean(browse), computer: Boolean(cuaConnection), localVm: true },
          }, signal, secret);
          registered = { id, secret };
          set({ connected: true, error: undefined });
          const preferences = async () => {
            try {
              const record = await request(env, "/api/me/preferences");
              const value = JSON.parse(record?.preferences?.["sagax.botWorkplace.v1"] ?? "{}");
              network = value?.network === "lan" ? "lan" : "all";
            } catch { /* keep the last one */ }
          };
          await preferences();
          const refresh = setInterval(() => void preferences(), 60_000);
          live.addEventListener("abort", () => clearInterval(refresh), { once: true });
          // The tunnel: the cookie and the secret ride its handshake only.
          const startTunnel = async () => {
            if (!WebSocketImpl || live.aborted) return;
            try {
              tunnel = openDesktopTunnel({
                url: `${env.origin.replace(/^http/, "ws")}/api/desktop-bridge/${id}/tunnel`,
                headers: { cookie: await cookieHeader(env.origin), origin: env.origin, "x-sagax-bridge-secret": secret },
                network: () => network, resolveProxy, proxyCredentials, lookup, WebSocketImpl, ...(tunnelConnect ? { connect: tunnelConnect } : {}),
                record: ({ host, port, ok, error, via }) => activity.record({ env, action: "network", detail: `${host}:${port}${via && via !== "direct" ? ` via ${via}` : ""}`, ok, error }),
              });
              live.addEventListener("abort", () => tunnel?.close(), { once: true });
              await tunnel.ready;
              set({ tunnel: true });
              await tunnel.closed;
            } catch { /* retried below */ }
            set({ tunnel: false });
            if (!live.aborted) { await delay(retryMs, undefined, { signal: live }).catch(() => {}); void startTunnel(); }
          };
          void startTunnel();
          const call = (action, body = {}) => request(env, `/api/desktop-bridge/${id}/${action}`, body, signal, secret);
          while (!signal.aborted) {
            const { job } = await call("poll");
            if (!job) continue;
            if (!uuid(job.id) || !validBridgeOperation(job.operation)) {
              activity.record({ env, action: "invalid", detail: "", ok: false, error: "Refused a malformed request" });
              await call("result", { jobId: job.id, result: sharedComputerError(new Error("Invalid request")) }).catch(() => {});
              continue;
            }
            const operation = job.operation;
            const jobAbort = new AbortController();
            const jobSignal = AbortSignal.any([signal, jobAbort.signal]);
            const heartbeat = setInterval(() => {
              void call("lease", { jobId: job.id }).then(answer => { if (!answer?.active) jobAbort.abort(); }, () => jobAbort.abort());
            }, 2000);
            let result;
            let control;
            // Progress for the turn (Local VM creation): best effort, bounded.
            let progressSent = 0;
            const progress = message => {
              if (progressSent++ >= 50) return;
              void call("progress", { jobId: job.id, message: String(message).slice(0, 300) }).catch(() => {});
            };
            try {
              result = await executeBridgeOperation(operation, {
                home, attachmentsDir, protectedPaths: roots, fetchUrl, browse, localVm, progress,
                computer: cuaConnection ? async (op, sig) => {
                  if (hostControl) control = await hostControl(job.id, sig);
                  if (!cua) {
                    const connection = await cuaConnection();
                    if (!connection?.mcpCommand || !Array.isArray(connection.mcpArgs)) throw new Error("Computer use is unavailable. Enable it in the desktop app and grant the OS permissions first.");
                    cua = createSharedCua(connection);
                  }
                  return cua.call(op, sig);
                } : null,
              }, jobSignal);
            } catch (error) {
              result = sharedComputerError(error);
              if (["computer_tools", "computer_call"].includes(operation.action)) { cua?.close(); cua = null; }
            } finally {
              clearInterval(heartbeat);
              await control?.release?.().catch(() => {});
            }
            activity.record({ env, action: operation.action, detail: describe(operation), ok: result?.isError !== true, error: result?.isError ? result?.content?.[0]?.text : undefined });
            // Never retried: a result that cannot be delivered is lost, and
            // the server says the outcome is unknown.
            await call("result", { jobId: job.id, result }).catch(() => {});
          }
        } catch (error) {
          connection.abort();
          if (signal.aborted) break;
          tunnel?.close(); tunnel = null;
          set({ connected: false, tunnel: false, ...(error?.quiet ? {} : { error: error?.message }) });
          await delay(retryMs, undefined, { signal }).catch(() => {});
        }
      }
      tunnel?.close();
      cua?.close();
    };
    void loop();
    return {
      stop() {
        abort.abort();
        tunnel?.close();
        cua?.close();
        // Say goodbye so the server stops routing here at once (best effort).
        if (registered) void request(env, `/api/desktop-bridge/${registered.id}/disconnect`, {}, undefined, registered.secret).catch(() => {});
        registered = null;
        set({ connected: false, tunnel: false });
      },
    };
  };

  return {
    /** Keep the bridge running for the server-mode environment, or stop it. */
    sync() {
      const env = environment();
      if (running && running.origin === env?.origin) return;
      running?.stop();
      running = null;
      if (env) running = { origin: env.origin, ...run(env) };
    },
    state: () => ({ ...state }),
    activity: limit => activity.list(limit),
    close() { running?.stop(); running = null; },
  };
}
