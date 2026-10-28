import { execFile } from "node:child_process";

/** Resolve only after the launcher really spawns or reports an error. */
function launch(executable, args, options, run = execFile) {
  return new Promise((resolve) => {
    let child;
    try {
      child = run(executable, args, options);
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (ok) child.unref?.();
      resolve(ok);
    };
    child.once("spawn", () => finish(true));
    child.once("error", () => finish(false));
  });
}

/** A folder a terminal may start in: an absolute path of this computer,
 * nothing a shell would read as more than one argument. */
export function terminalFolder(value) {
  if (typeof value !== "string") return null;
  const folder = value.trim();
  const windows = /^[A-Za-z]:[\\/]/.test(folder);
  if (!folder.startsWith("/") && !windows) return null;
  // A backslash is a path separator on Windows and nothing else here, so
  // only a POSIX path refuses one.
  if (/[\0\r\n"'$`;]/.test(folder) || (!windows && folder.includes("\\"))) return null;
  return folder;
}

/** Open a blank terminal. Installer text is deliberately not accepted here,
 * so renderer-controlled input can never become a process argument. */
export async function openBlankTerminal(platform = process.platform, run = execFile) {
  if (platform === "darwin") {
    return launch(
      "osascript",
      ["-e", 'tell application "Terminal" to activate'],
      undefined,
      run,
    );
  }
  if (platform === "win32") {
    // Launched directly, PowerShell's stdin and stdout are pipes to this app,
    // and from the windowless app it gets no visible window: the app reports
    // a terminal nobody can see or type into. A hidden PowerShell hands the
    // real one to Start-Process, which gives it a console window of its own.
    // The command is fixed text.
    return launch(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Start-Process powershell.exe"],
      { windowsHide: true },
      run,
    );
  }
  if (platform === "linux") {
    for (const terminal of ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]) {
      if (await launch(terminal, [], undefined, run)) return true;
    }
  }
  return false;
}

/** Open a terminal already standing in `folder`. The folder is checked by
 * `terminalFolder` first: it is data for the one command, never a command. */
export async function openTerminalAt(folder, platform = process.platform, run = execFile) {
  const cwd = terminalFolder(folder);
  if (!cwd) return false;
  if (platform === "darwin") {
    // The folder is one quoted AppleScript string. A quote cannot reach it:
    // terminalFolder refuses one.
    return launch("osascript", ["-e", `tell application "Terminal" to do script "cd ${JSON.stringify(cwd)}"`, "-e", 'tell application "Terminal" to activate'], undefined, run);
  }
  if (platform === "win32") {
    return launch(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Start-Process powershell.exe -WorkingDirectory $args[0]", cwd],
      { windowsHide: true },
      run,
    );
  }
  if (platform === "linux") {
    const quoted = JSON.stringify(cwd);
    const candidates = [
      ["gnome-terminal", [`--working-directory=${cwd}`]],
      ["konsole", ["--workdir", cwd]],
      ["xterm", ["-e", "/bin/sh", "-c", `cd ${quoted} && exec /bin/sh`]],
      ["x-terminal-emulator", ["-e", "/bin/sh", "-c", `cd ${quoted} && exec /bin/sh`]],
    ];
    for (const [terminal, args] of candidates) {
      if (await launch(terminal, args, undefined, run)) return true;
    }
  }
  return false;
}
