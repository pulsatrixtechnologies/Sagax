import { execFile, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const driver = path.join(root, "dist-native", "cua-linux-x64", "cua-driver");
if (process.platform !== "linux") throw new Error("the X11 input smoke is Linux-only");
if (!process.env.DISPLAY) throw new Error("the X11 input smoke needs an active DISPLAY");
if (!existsSync(driver)) throw new Error(`missing staged Cua Driver: ${driver}`);

const prefix = "omb-cua-x11-input-";
const sandbox = mkdtempSync(path.join(tmpdir(), prefix));
if (path.dirname(sandbox) !== path.resolve(tmpdir()) || !path.basename(sandbox).startsWith(prefix)) {
  throw new Error(`unexpected smoke directory: ${sandbox}`);
}
const runtime = path.join(sandbox, "runtime");
const home = path.join(sandbox, "home");
const socketPath = path.join(runtime, "driver.sock");
const pidFile = path.join(runtime, "driver.pid");
mkdirSync(runtime, { mode: 0o700 });
mkdirSync(home, { mode: 0o700 });
chmodSync(runtime, 0o700);
chmodSync(home, 0o700);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const title = `Sagax CUA input safety ${process.pid}`;
// Driver 0.33 reads _NET_ACTIVE_WINDOW as a WINDOW, which only a window
// manager publishes. xvfb-run does not start one, and xprop -set stores a
// CARDINAL the driver ignores. Openbox has to be up before the test window.
let windowManagerError = "";
// --sm-disable: a session bus is already up (dbus-run-session) and openbox
// must manage this display instead of waiting on a session manager.
const windowManager = spawn("openbox", ["--sm-disable"], { env: process.env, stdio: ["ignore", "ignore", "pipe"] });
windowManager.stderr.setEncoding("utf8");
windowManager.stderr.on("data", (chunk) => {
  windowManagerError = (windowManagerError + chunk).slice(-4_000);
});
windowManager.on("error", (error) => {
  windowManagerError += String(error);
});
{
  const deadline = Date.now() + 5_000;
  let ready = false;
  while (Date.now() < deadline && windowManager.exitCode === null && windowManager.signalCode === null) {
    try {
      const { stdout } = await execFileAsync("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"]);
      if (/_NET_SUPPORTING_WM_CHECK\(WINDOW\)/.test(stdout)) {
        ready = true;
        break;
      }
    } catch {
      // Openbox has not claimed the display yet.
    }
    await delay(50);
  }
  if (!ready) {
    windowManager.kill("SIGTERM");
    rmSync(sandbox, { recursive: true, force: true });
    throw new Error(`openbox did not claim the display\n${windowManagerError}`);
  }
  // The supporting-WM property is set before openbox is in its event loop.
  // A map in that gap stays IsUnMapped for the whole smoke.
  await delay(300);
}
// Line-buffered so a timeout still shows Map and Reparent events. xev's own
// stdout is fully buffered on a pipe and would hide them.
const xev = spawn(
  "stdbuf",
  ["-oL", "-eL", "xev", "-name", title, "-geometry", "320x180+40+40"],
  { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
let xevOutput = "";
for (const stream of [xev.stdout, xev.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    xevOutput += chunk;
  });
}

// The driver is started only after xdotool has seen the test window.
// Starting it first holds the X server, and the search then waits out.
let driverProcess;
let driverError = "";
let proxy;
let proxyError = "";
function startDriver() {
  driverProcess = spawn(
    driver,
    [
      "serve",
      "--embedded",
      "--no-overlay",
      "--socket",
      socketPath,
      "--pid-file",
      pidFile,
      "--permission-mode",
      "standard",
    ],
    {
      env: {
        ...process.env,
        HOME: home,
        XDG_RUNTIME_DIR: runtime,
        XDG_SESSION_TYPE: "x11",
        CUA_DRIVER_EMBEDDED: "1",
        CUA_DRIVER_PARENT_LIVENESS_STDIN: "1",
        CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
        CUA_DRIVER_RS_UPDATE_CHECK: "false",
      },
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  driverError = "";
  driverProcess.stderr.setEncoding("utf8");
  driverProcess.stderr.on("data", (chunk) => {
    driverError += chunk;
  });
}

async function until(probe, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (driverProcess.exitCode !== null || driverProcess.signalCode !== null) {
      throw new Error(
        `Cua Driver exited before ${description}: ${driverProcess.exitCode ?? driverProcess.signalCode}\n${driverError}`,
      );
    }
    await delay(25);
  }
  throw new Error(`timed out waiting for ${description}\n${driverError}\n${xevOutput}`);
}

function driverRequest(method) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let response = "";
    client.setEncoding("utf8");
    client.once("connect", () => client.write(`${JSON.stringify({ method })}\n`));
    client.on("data", (chunk) => {
      response += chunk;
      const newline = response.indexOf("\n");
      if (newline === -1) return;
      client.end();
      try {
        resolve(JSON.parse(response.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    client.once("error", reject);
  });
}

function createMcpClient() {
  proxy = spawn(driver, ["mcp", "--socket", socketPath], {
    env: {
      ...process.env,
      HOME: home,
      XDG_RUNTIME_DIR: runtime,
      XDG_SESSION_TYPE: "x11",
      CUA_DRIVER_EMBEDDED: "1",
      CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
      CUA_DRIVER_RS_UPDATE_CHECK: "false",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let buffer = "";
  let nextId = 1;
  proxy.stderr.setEncoding("utf8");
  proxy.stderr.on("data", (chunk) => {
    proxyError += chunk;
  });
  proxy.stdout.setEncoding("utf8");
  proxy.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const settle = pending.get(message.id);
      if (settle) {
        pending.delete(message.id);
        settle(message);
      }
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out${proxyError ? `: ${proxyError.trim()}` : ""}`));
      }, 20_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      proxy.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
}

function assertToolResult(result, name) {
  if (result?.isError) throw new Error(result.content?.[0]?.text || `${name} failed`);
  return result;
}

async function publishActiveWindow(windowId) {
  await execFileAsync("xdotool", ["windowactivate", "--sync", windowId], { timeout: 3_000 });
  await execFileAsync("xdotool", ["windowfocus", "--sync", windowId], { timeout: 3_000 });
  const { stdout } = await execFileAsync("xprop", ["-root", "_NET_ACTIVE_WINDOW"]);
  const hex = `0x${Number(windowId).toString(16)}`;
  if (!stdout.includes("(WINDOW)") || !stdout.toLowerCase().includes(hex)) {
    throw new Error(`the window manager did not focus ${hex}: ${stdout.trim()}`);
  }
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin?.end();
  const deadline = Date.now() + 2_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await delay(25);
  }
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
}

function outerWindowId() {
  const match = /Outer window is (0x[0-9a-fA-F]+)/.exec(xevOutput);
  return match?.[1] ?? "";
}

try {
  // xev prints its window id before the window is viewable. Name search is
  // not the signal: on the runner it kept exiting while this id was already
  // in xev's log, and a short timeout there kills the client mid-request.
  const windowDeadline = Date.now() + 15_000;
  let windowId = "";
  let lastState = "";
  let sawWindowAt = 0;
  let forcedMap = false;
  while (Date.now() < windowDeadline) {
    if (xev.exitCode !== null || xev.signalCode !== null) {
      throw new Error(`xev exited before its test window appeared:\n${xevOutput}`);
    }
    if (windowManager.exitCode !== null || windowManager.signalCode !== null) {
      throw new Error(`openbox exited before the test window was viewable: ${windowManager.exitCode ?? windowManager.signalCode}\n${windowManagerError}`);
    }
    windowId = outerWindowId();
    if (windowId) {
      sawWindowAt ||= Date.now();
      try {
        const { stdout } = await execFileAsync("xwininfo", ["-id", windowId], { timeout: 3_000 });
        lastState = /Map State:\s+(\S+)/.exec(stdout)?.[1] ?? "";
        if (lastState === "IsViewable") break;
      } catch (error) {
        lastState = error instanceof Error ? error.message : String(error);
      }
      // A MapRequest openbox never answers leaves the window IsUnMapped.
      // Withdraw it and map as override-redirect so it becomes viewable
      // without that request. windowactivate still publishes
      // _NET_ACTIVE_WINDOW as a WINDOW.
      if (!forcedMap && sawWindowAt && Date.now() - sawWindowAt > 1_000 && (lastState === "IsUnMapped" || lastState === "IsUnviewable")) {
        forcedMap = true;
        await execFileAsync("xdotool", ["windowunmap", windowId], { timeout: 2_000 }).catch(() => {});
        await execFileAsync("xdotool", ["set_window", "--overrideredirect", "1", windowId], { timeout: 2_000 }).catch(() => {});
        await execFileAsync("xdotool", ["windowmap", windowId], { timeout: 2_000 }).catch(() => {});
      }
    }
    await delay(50);
  }
  if (!windowId || lastState !== "IsViewable") {
    let tree = "";
    try {
      tree = (await execFileAsync("xwininfo", ["-root", "-tree"], { timeout: 3_000 })).stdout.slice(-2_000);
    } catch (error) {
      tree = error instanceof Error ? error.message : String(error);
    }
    throw new Error(
      `timed out waiting for the unrelated X11 test window ${windowId || "(no id)"} state=${lastState}\n${windowManagerError}\n${tree}\n${xevOutput.slice(-2_000)}`,
    );
  }
  startDriver();

  const metadata = await until(
    async () => {
      if (!existsSync(socketPath)) return null;
      const response = await driverRequest("metadata");
      return response?.ok === true ? response.result : null;
    },
    "the overlay-free driver handshake",
  );
  if (metadata.driver_version !== "0.33.0" || metadata.embedded !== true) {
    throw new Error(`unexpected driver metadata: ${JSON.stringify(metadata)}`);
  }

  const { stdout: tree } = await execFileAsync("xwininfo", ["-root", "-tree"]);
  if (tree.includes("Cua.AgentCursorOverlay")) {
    throw new Error("Cua created its full-screen cursor overlay despite --no-overlay");
  }

  const rpc = createMcpClient();
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "openmausbot-x11-input-smoke", version: "1" },
  });
  proxy.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const listed = await rpc("tools/list");
  const toolNames = new Set(listed.tools.map(({ name }) => name));
  for (const required of ["start_session", "get_window_state", "click", "type_text"]) {
    if (!toolNames.has(required)) throw new Error(`Cua MCP did not expose ${required}`);
  }

  const session = `openmausbot-x11-smoke-${process.pid}`;
  assertToolResult(
    await rpc("tools/call", {
      name: "start_session",
      arguments: { session, capture_scope: "window" },
    }),
    "start_session",
  );
  xevOutput = "";
  const target = {
    session,
    pid: xev.pid,
    window_id: Number(windowId),
    x: 80,
    y: 80,
    scope: "window",
    delivery_mode: "foreground",
  };
  // Driver 0.33 refuses a pixel click until this session has a screenshot of the window.
  assertToolResult(
    await rpc("tools/call", {
      name: "get_window_state",
      arguments: { session, pid: xev.pid, window_id: Number(windowId), include_screenshot: true },
    }),
    "get_window_state",
  );
  await publishActiveWindow(windowId);
  assertToolResult(
    await rpc("tools/call", { name: "click", arguments: target }),
    "click",
  );
  await publishActiveWindow(windowId);
  assertToolResult(
    await rpc("tools/call", { name: "type_text", arguments: { ...target, text: "a" } }),
    "type_text",
  );
  await until(
    async () => /ButtonPress event/.test(xevOutput) && /KeyPress event/.test(xevOutput),
    "an unrelated X11 window to receive pointer and keyboard input",
  );
  console.log(
    "[smoke-cua-x11-input] OK: no full-screen Cua overlay; Cua click and type_text reached an unrelated window",
  );
} finally {
  if (proxy) await stop(proxy);
  if (driverProcess) await stop(driverProcess);
  if (xev.exitCode === null && xev.signalCode === null) xev.kill("SIGTERM");
  if (windowManager && windowManager.exitCode === null && windowManager.signalCode === null) {
    windowManager.kill("SIGTERM");
  }
  rmSync(sandbox, { recursive: true, force: true });
}
