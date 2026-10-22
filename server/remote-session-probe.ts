// Fixed read-only probes for a Tailcat session. The command text is ours:
// nothing the person or the model typed is interpolated into it.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { isTailcatAddress, parseRemoteSessionCode, REMOTE_SESSION_ID, type RemoteSessionOs } from "../shared/remote-session.ts";

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
  return isTailcatAddress(address);
}

/** The row a tunnel is resolved for: its id, its support code and who owns it. */
export interface TunnelOwner {
  id: string;
  code?: string;
  principalId?: string;
  botId?: string;
}

/** Who remote_support_open recorded as the opener of `sessions/<CODE>/`, or null. */
export function supportFolderOwner(dir: string, code: string): { id: string; principalId?: string; botId?: string } | null {
  const compact = parseRemoteSessionCode(code);
  if (!compact) return null;
  const folder = path.join(path.resolve(dir), "sessions", compact);
  let id = "";
  try {
    id = readFileSync(path.join(folder, "session"), "utf8").trim();
  } catch {
    return null;
  }
  if (!REMOTE_SESSION_ID.test(id)) return null;
  let meta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path.join(folder, "open.json"), "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
  } catch {
    /* an owner-less folder */
  }
  const principalId = typeof meta.principalId === "string" && meta.principalId.trim() ? normPrincipal(meta.principalId) : undefined;
  const botId = typeof meta.botId === "string" && meta.botId.trim() ? meta.botId.trim() : undefined;
  return { id, ...(principalId ? { principalId } : {}), ...(botId ? { botId } : {}) };
}

interface ScannedOwner { code: string; id: string; principalId?: string; botId?: string }
// The sessions directory is scanned once per change, not once per publish or
// close: the scan is cached and reused while the directory's mtime is
// unchanged (a new session folder bumps it, which re-scans).
const scanCache = new Map<string, { mtimeMs: number; owners: ScannedOwner[] }>();

function scanSupportOwners(dir: string): ScannedOwner[] {
  const sessions = path.join(path.resolve(dir), "sessions");
  let mtimeMs: number;
  try {
    mtimeMs = statSync(sessions).mtimeMs;
  } catch {
    scanCache.delete(path.resolve(dir));
    return [];
  }
  const cached = scanCache.get(path.resolve(dir));
  if (cached && cached.mtimeMs === mtimeMs) return cached.owners;
  const owners: ScannedOwner[] = [];
  let codes: string[] = [];
  try {
    codes = readdirSync(sessions);
  } catch {
    codes = [];
  }
  for (const code of codes) {
    const owner = supportFolderOwner(dir, code);
    if (!owner) continue;
    owners.push({ code, id: owner.id, ...(owner.principalId ? { principalId: owner.principalId } : {}), ...(owner.botId ? { botId: owner.botId } : {}) });
  }
  scanCache.set(path.resolve(dir), { mtimeMs, owners });
  return owners;
}

/** Every support folder that holds this session id, with its recorded owner. */
export function supportOwnersOfId(dir: string, id: string): Array<{ code: string; principalId?: string; botId?: string }> {
  if (!REMOTE_SESSION_ID.test(id)) return [];
  return scanSupportOwners(dir)
    .filter((owner) => owner.id === id)
    .map((owner) => ({ code: owner.code, ...(owner.principalId ? { principalId: owner.principalId } : {}), ...(owner.botId ? { botId: owner.botId } : {}) }));
}

export function normPrincipal(value: string): string {
  return value.trim().toLowerCase();
}

/** Remove session folders under `<dir>/sessions` not touched in `maxAgeMs`
 * (default 48 h). Best effort, synchronous, nothing thrown. Returns how many
 * folders were removed. */
export function pruneSupportSessions(dir: string, now: number, maxAgeMs = 48 * 60 * 60 * 1000): number {
  const sessions = path.join(path.resolve(dir), "sessions");
  let codes: string[] = [];
  try {
    codes = readdirSync(sessions);
  } catch {
    return 0;
  }
  const cutoff = now - maxAgeMs;
  let removed = 0;
  for (const code of codes) {
    const folder = path.join(sessions, code);
    try {
      if (statSync(folder).mtimeMs >= cutoff) continue;
      rmSync(folder, { recursive: true, force: true });
      removed++;
    } catch { /* leave it for the next sweep */ }
  }
  if (removed) scanCache.delete(path.resolve(dir));
  return removed;
}

/** A session Sagax opened itself (server/remote-support-local.ts): the
 * technician key is `<dir>/technician.private.json` and the address is in
 * `<dir>/sessions/<row.code>/address`. The folder must hold this very id and
 * name this row's person and bot as its opener: the id alone (it is on the
 * chat card) never resolves a tunnel, and a folder without an owner never does. */
export function readSupportTunnel(dir: string, row: TunnelOwner): { keyPath: string; address: string } | null {
  if (!REMOTE_SESSION_ID.test(row.id) || !row.code || !row.principalId || !row.botId) return null;
  const root = path.resolve(dir);
  const keyPath = path.join(root, "technician.private.json");
  try {
    readFileSync(keyPath);
  } catch {
    return null;
  }
  const owner = supportFolderOwner(root, row.code);
  if (!owner || owner.id !== row.id) return null;
  if (!owner.principalId || owner.principalId !== normPrincipal(row.principalId)) return null;
  if (!owner.botId || owner.botId !== row.botId) return null;
  let address = "";
  try {
    address = readFileSync(path.join(root, "sessions", parseRemoteSessionCode(row.code)!, "address"), "utf8").trim();
  } catch {
    return null;
  }
  return validAddress(address) ? { keyPath, address } : null;
}

/** The on-disk tunnel, or null when this host does not have it. The address
 * stays in the file; callers pass it only as an argv element and never log it.
 * The Flow session folder first, then the folder of a session Sagax opened. */
export function readTunnel(home: string, row: TunnelOwner, supportDir?: string): { keyPath: string; address: string } | null {
  if (!REMOTE_SESSION_ID.test(row.id)) return null;
  const flow = readFlowTunnel(home, row);
  if (flow) return flow;
  return supportDir ? readSupportTunnel(supportDir, row) : null;
}

/** A Flow session folder (`~/.pulsatrix-flow/tailcat/<id>`) carries no owner
 * when a Flow skill first drops it. The first person to publish it binds it
 * (bindFlowOwner); after that only that person and bot resolve its tunnel. */
export function flowOwner(home: string, id: string): { principalId: string; botId: string } | null {
  if (!REMOTE_SESSION_ID.test(id)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path.join(sessionDir(home, id), "owner.json"), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const principalId = typeof record.principalId === "string" ? normPrincipal(record.principalId) : "";
    const botId = typeof record.botId === "string" ? record.botId.trim() : "";
    return principalId && botId ? { principalId, botId } : null;
  } catch {
    return null;
  }
}

export type FlowBindResult = "no-folder" | "bound" | "match" | "other";

/** Bind a Flow folder to the first publisher. The folder must already exist
 * (a Flow skill created it); the binding goes in owner.json and never changes. */
export function bindFlowOwner(home: string, id: string, owner: { principalId: string; botId: string }): FlowBindResult {
  if (!REMOTE_SESSION_ID.test(id)) return "no-folder";
  const dir = sessionDir(home, id);
  try {
    statSync(dir);
  } catch {
    return "no-folder";
  }
  const existing = flowOwner(home, id);
  if (existing) {
    return existing.principalId === normPrincipal(owner.principalId) && existing.botId === owner.botId.trim() ? "match" : "other";
  }
  try {
    writeFileSync(path.join(dir, "owner.json"), `${JSON.stringify({ principalId: normPrincipal(owner.principalId), botId: owner.botId.trim() })}\n`, { mode: 0o600 });
    return "bound";
  } catch {
    return "no-folder";
  }
}

function readFlowTunnel(home: string, row: TunnelOwner): { keyPath: string; address: string } | null {
  const id = row.id;
  const dir = sessionDir(home, id);
  const keyPath = path.join(dir, "client.private.json");
  const addressPath = path.join(dir, "address");
  // A bound folder resolves only for the person and bot that first published it.
  const owner = flowOwner(home, id);
  if (owner && (!row.principalId || !row.botId || normPrincipal(row.principalId) !== owner.principalId || row.botId !== owner.botId)) {
    return null;
  }
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


