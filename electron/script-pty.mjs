// A real terminal (a PTY) for one program, without a native module: the
// system's own `script` command allocates it. Used by the in-chat terminal
// for "This computer", the Local VM (`docker exec -it` needs a terminal on
// its side) and SSH hosts (`ssh -t` forwards the window size), on the server
// (solo) and in the desktop app (organization server, the desktop bridge).
//
// How the size works: a small sh wrapper inside the PTY writes the PTY's
// name to a private file, sets the first size, then execs the program. A
// later resize sets the size of that PTY from outside (stty -f on macOS,
// stty -F on Linux), which signals the program (SIGWINCH) as a terminal
// window would. macOS `script` refuses a socket on its standard input, so
// there the input goes through `cat` (an anonymous pipe; a FIFO is a socket
// on macOS too), and the whole group is stopped when the program ends so
// `cat` does not keep it alive.
//
// Windows has no `script`: the program runs on plain pipes (no PTY), so
// line editing and full-screen programs are limited there.
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

const WRAPPER = 'tty > "$SAGAX_PTY_FILE" 2>/dev/null; stty cols "$SAGAX_PTY_COLS" rows "$SAGAX_PTY_ROWS" 2>/dev/null; exec "$@"';

/** The system's own folders on PATH, after the caller's: `script`, `cat`,
 * `tty` and `stty` must resolve even from an app or a server started with
 * a bare PATH. */
export function withSystemPath(env = process.env) {
  const parts = String(env.PATH ?? "").split(":").filter(Boolean);
  for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) if (!parts.includes(dir)) parts.push(dir);
  return { ...env, PATH: parts.join(":") };
}

const clampSize = (value, low, high, fallback) => (Number.isInteger(value) && value >= low && value <= high ? value : fallback);

/** One argument for `sh -c`, quoted. */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/** The command line that runs `argv` inside a new PTY on this platform, or
 * null when there is no `script` (Windows). Pure, for tests. */
export function scriptPtyCommand(argv, { platform = process.platform } = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((arg) => typeof arg !== "string" || arg.includes("\u0000"))) {
    throw new Error("argv must be non-empty strings");
  }
  if (platform === "win32") return null;
  const inner = ["/bin/sh", "-c", WRAPPER, "sagax-pty", ...argv];
  if (platform === "darwin") {
    // BSD script: `script -q /dev/null cmd args...`, input through a pipe.
    const relay = 'cat | { /usr/bin/script -q /dev/null "$@"; kill 0; }';
    return { command: "/bin/sh", args: ["-c", relay, "sagax-pipe", ...inner] };
  }
  // util-linux script: one command string.
  return { command: "script", args: ["-q", "-f", "-e", "-c", inner.map(shellQuote).join(" "), "/dev/null"] };
}

/** stty's flag for "this device" on this platform. */
const sttyDevice = (platform) => (platform === "darwin" ? "-f" : "-F");

/** Start `argv` in a PTY. Returns the byte streams (input to it, output from
 * it), resize and close. `env` and `cwd` are the program's. */
export function spawnScriptPty(argv, { platform = process.platform, cols = 100, rows = 28, env = process.env, cwd, spawnImpl = spawn, execFileImpl = execFile } = {}) {
  const command = scriptPtyCommand(argv, { platform });
  const width = clampSize(cols, 2, 1000, 100);
  const height = clampSize(rows, 1, 500, 28);
  const input = new PassThrough();
  const output = new PassThrough();
  const dir = command ? mkdtempSync(path.join(os.tmpdir(), "sagax-pty-")) : null;
  const ptyFile = dir ? path.join(dir, "tty") : null;
  const childEnv = {
    ...(command ? withSystemPath(env) : env),
    TERM: "xterm-256color",
    ...(ptyFile ? { SAGAX_PTY_FILE: ptyFile, SAGAX_PTY_COLS: String(width), SAGAX_PTY_ROWS: String(height) } : {}),
  };
  const proc = command
    ? spawnImpl(command.command, command.args, { env: childEnv, cwd, stdio: ["pipe", "pipe", "pipe"], detached: true })
    : spawnImpl(argv[0], argv.slice(1), { env: childEnv, cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let closed = false;
  let device = null;
  const readDevice = () => {
    if (device || !ptyFile) return device;
    try {
      const name = readFileSync(ptyFile, "utf8").trim();
      if (/^\/dev\/[\w/]+$/.test(name)) device = name;
    } catch { /* not written yet */ }
    return device;
  };
  const cleanup = () => {
    if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder */ }
  };
  proc.stdout.on("data", (chunk) => output.write(chunk));
  proc.stderr.on("data", (chunk) => output.write(chunk));
  proc.stdin.on("error", () => { /* the program ended */ });
  input.on("data", (chunk) => { if (!closed) proc.stdin.write(chunk); });
  const end = () => {
    if (closed) return;
    closed = true;
    cleanup();
    output.end();
    input.destroy();
  };
  proc.on("exit", end);
  proc.on("error", (error) => {
    output.write(`\r\n${error.message}\r\n`);
    end();
  });
  const killAll = (signal) => {
    try {
      if (command && proc.pid) process.kill(-proc.pid, signal);
      else proc.kill(signal);
    } catch { /* already gone */ }
  };
  return {
    input,
    output,
    proc,
    resize(nextCols, nextRows) {
      const target = readDevice();
      if (!target || closed) return;
      const c = clampSize(nextCols, 2, 1000, width);
      const r = clampSize(nextRows, 1, 500, height);
      execFileImpl("stty", [sttyDevice(platform), target, "cols", String(c), "rows", String(r)], { env: withSystemPath(env) }, () => { /* a closed PTY */ });
    },
    close() {
      if (!closed) {
        killAll("SIGHUP");
        const timer = setTimeout(() => killAll("SIGKILL"), 2_000);
        timer.unref?.();
      }
      end();
      output.destroy();
    },
  };
}
