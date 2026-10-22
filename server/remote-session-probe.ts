// Fixed read-only probes for a Tailcat session. The command text is ours:
// nothing the person or the model typed is interpolated into it.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { REMOTE_SESSION_ID, type RemoteSessionOs } from "../shared/remote-session.ts";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type RunCommand = (argv: string[], timeoutMs: number) => Promise<CommandResult>;

const SHOT_NAME = "px-sagax-shot.png";

export function flowHome(): string {
  const fromEnv = process.env.PX_FLOW_HOME?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(homedir(), ".pulsatrix-flow");
}

export function sessionDir(home: string, id: string): string {
  return path.join(home, "tailcat", id);
}

function validAddress(address: string): boolean {
  // oxlint-disable-next-line no-control-regex -- a tunnel address never contains control characters
  return address.startsWith("tc") && address.length <= 512 && !/[\s\u0000-\u001f]/.test(address);
}

/** A session Sagax opened itself (server/remote-support-local.ts): the
 * technician key is `<dir>/technician.private.json` and the address is in
 * `<dir>/sessions/<CODE>/address`, next to a `session` file holding the id. */
export function readSupportTunnel(dir: string, id: string): { keyPath: string; address: string } | null {
  if (!REMOTE_SESSION_ID.test(id)) return null;
  const root = path.resolve(dir);
  const keyPath = path.join(root, "technician.private.json");
  try {
    readFileSync(keyPath);
  } catch {
    return null;
  }
  let codes: string[] = [];
  try {
    codes = readdirSync(path.join(root, "sessions"));
  } catch {
    return null;
  }
  for (const code of codes) {
    if (!/^[A-Z0-9]{6}$/.test(code)) continue;
    const folder = path.join(root, "sessions", code);
    let session = "";
    try {
      session = readFileSync(path.join(folder, "session"), "utf8").trim();
    } catch {
      continue;
    }
    if (session !== id) continue;
    let address = "";
    try {
      address = readFileSync(path.join(folder, "address"), "utf8").trim();
    } catch {
      return null;
    }
    return validAddress(address) ? { keyPath, address } : null;
  }
  return null;
}

/** The on-disk tunnel, or null when this host does not have it. The address
 * stays in the file; callers pass it only as an argv element and never log it.
 * The Flow session folder first, then the folder of a session Sagax opened. */
export function readTunnel(home: string, id: string, supportDir?: string): { keyPath: string; address: string } | null {
  if (!REMOTE_SESSION_ID.test(id)) return null;
  const flow = readFlowTunnel(home, id);
  if (flow) return flow;
  return supportDir ? readSupportTunnel(supportDir, id) : null;
}

function readFlowTunnel(home: string, id: string): { keyPath: string; address: string } | null {
  const dir = sessionDir(home, id);
  const keyPath = path.join(dir, "client.private.json");
  const addressPath = path.join(dir, "address");
  let address = "";
  try {
    address = readFileSync(addressPath, "utf8").trim();
  } catch {
    return null;
  }
  if (!validAddress(address)) return null;
  try {
    readFileSync(keyPath);
  } catch {
    return null;
  }
  const root = path.resolve(sessionDir(home, id));
  if (!path.resolve(keyPath).startsWith(root + path.sep)) return null;
  return { keyPath, address };
}

export function inventoryCommand(os: RemoteSessionOs): string {
  if (os === "windows") {
    return [
      "powershell.exe -NoProfile -NonInteractive -Command",
      "\"$cs=Get-CimInstance Win32_ComputerSystem;",
      "$bios=Get-CimInstance Win32_BIOS;",
      "$osInfo=Get-CimInstance Win32_OperatingSystem;",
      "$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1;",
      "$disk=Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DeviceID -eq 'C:' } | Select-Object -First 1;",
      "$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);",
      "Write-Output ('hostname=' + $cs.Name);",
      "Write-Output ('user=' + $cs.UserName);",
      "Write-Output ('model=' + $cs.Model);",
      "Write-Output ('serial=' + $bios.SerialNumber);",
      "Write-Output ('cpu=' + $cpu.Name);",
      "Write-Output ('os=' + $osInfo.Caption);",
      "Write-Output ('admin=' + $admin);",
      "Write-Output ('ramBytes=' + $cs.TotalPhysicalMemory);",
      "Write-Output ('diskFreeKb=' + [math]::Round($disk.FreeSpace/1KB));",
      "Write-Output ('diskTotalKb=' + [math]::Round($disk.Size/1KB))\"",
    ].join(" ");
  }
  const serial = os === "macos"
    ? "ioreg -l | awk -F'\"' '/IOPlatformSerialNumber/{print $4; exit}'"
    : "cat /sys/class/dmi/id/product_serial 2>/dev/null";
  const model = os === "macos"
    ? "sysctl -n hw.model"
    : "cat /sys/class/dmi/id/product_name 2>/dev/null";
  const cpu = os === "macos"
    ? "sysctl -n machdep.cpu.brand_string"
    : "awk -F: '/model name/{gsub(/^[ \\t]+/, \"\", $2); print $2; exit}' /proc/cpuinfo";
  const ram = os === "macos" ? "sysctl -n hw.memsize" : "awk '/MemTotal/{print $2 * 1024; exit}' /proc/meminfo";
  return [
    "hostname=$(hostname)",
    "user=$(id -un)",
    `model=$(${model})`,
    `serial=$(${serial})`,
    `cpu=$(${cpu})`,
    "os=$(uname -sr)",
    "admin=$(id -Gn | grep -Eq 'admin|sudo|wheel' && printf true || printf false)",
    `ramBytes=$(${ram})`,
    "printf 'hostname=%s\\nuser=%s\\nmodel=%s\\nserial=%s\\ncpu=%s\\nos=%s\\nadmin=%s\\nramBytes=%s\\n' \"$hostname\" \"$user\" \"$model\" \"$serial\" \"$cpu\" \"$os\" \"$admin\" \"$ramBytes\"",
    "df -k / | awk 'NR==2{printf \"diskFreeKb=%s\\ndiskTotalKb=%s\\n\", $4, $2}'",
  ].join("; ");
}

export function screenshotPlan(os: RemoteSessionOs): { command: string; remotePathHint: string } {
  if (os === "windows") {
    return {
      remotePathHint: SHOT_NAME,
      command: [
        "powershell.exe -NoProfile -NonInteractive -Command",
        "\"Add-Type -AssemblyName System.Windows.Forms;",
        "Add-Type -AssemblyName System.Drawing;",
        "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;",
        "$bmp=New-Object System.Drawing.Bitmap([Math]::Max(1,$b.Width),[Math]::Max(1,$b.Height));",
        "$g=[System.Drawing.Graphics]::FromImage($bmp);",
        "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);",
        `$path=Join-Path $env:TEMP '${SHOT_NAME}';`,
        "$bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png);",
        "$g.Dispose(); $bmp.Dispose(); Write-Output $path\"",
      ].join(" "),
    };
  }
  const dir = os === "macos" ? "/tmp" : "/tmp";
  const remote = `${dir}/${SHOT_NAME}`;
  const shot = os === "macos"
    ? `screencapture -x ${remote}`
    : `command -v grim >/dev/null && grim ${remote} || command -v import >/dev/null && import -window root ${remote}`;
  return { remotePathHint: SHOT_NAME, command: `${shot} && printf '%s' ${remote}` };
}

export function transferDirCommand(os: RemoteSessionOs): string {
  if (os === "windows") {
    return "powershell.exe -NoProfile -NonInteractive -Command \"$d=Join-Path $env:TEMP 'sagax-transfer'; New-Item -ItemType Directory -Force -Path $d | Out-Null; Write-Output $d\"";
  }
  return "d=\"$HOME/sagax-transfer\"; mkdir -p \"$d\" && printf '%s' \"$d\"";
}

export function deleteRemoteCommand(os: RemoteSessionOs, remotePath: string): string {
  const quoted = `'${remotePath.replaceAll("'", "'\\''")}'`;
  if (os === "windows") {
    return `powershell.exe -NoProfile -NonInteractive -Command "Remove-Item -LiteralPath '${remotePath.replaceAll("'", "''")}' -Force"`;
  }
  return `rm -f ${quoted}`;
}

/** Stop file the end-user script watches, best effort. */
export function stopCommand(id: string): string {
  // Same stop file the end-user script watches (Flow tailcat_session.py).
  // The id is 12 hex, so it is safe inside this fixed command.
  return `printf '' > /tmp/px-assist-${id}/stop 2>/dev/null || type nul > %TEMP%\\px-assist-${id}\\stop`;
}

export function tailcatPtyArgv(bin: string, keyPath: string, address: string): string[] {
  return [bin, "ssh", "--key", keyPath, address];
}

export function tailcatSshArgv(bin: string, keyPath: string, address: string, command: string): string[] {
  return [...tailcatPtyArgv(bin, keyPath, address), command];
}

export function tailcatCopyArgv(bin: string, keyPath: string, from: string, to: string): string[] {
  return [bin, "cp", "--key", keyPath, from, to];
}

export const runCommand: RunCommand = (argv, timeoutMs) => new Promise((resolve) => {
  execFile(argv[0]!, argv.slice(1), { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
    const failed = error as { code?: number } | null;
    const code = typeof failed?.code === "number" ? failed.code : error ? 1 : 0;
    resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
  });
});


