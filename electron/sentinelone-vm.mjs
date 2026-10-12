// SentinelOne agent for a persistent local virtual machine.
//
// The site token (SAGAX_S1_SITE_TOKEN) stays on the server. An install writes
// it to a root-only file in the guest, the installer reads that file, and the
// file is removed before the install reports back. The token is never placed
// in a command argument, a guest environment variable, a log line, or an API
// body. Scripts below contain no token and no network address: tests never
// call SentinelOne.
//
// The site is "Pulsatrix Technologies Inc." and the policy is detect-only.
// The token is that site's token; nothing here calls the SentinelOne API.

export const S1_SITE = "Pulsatrix Technologies Inc.";
export const S1_POLICY = "detect-only";
export const S1_TOKEN_ENV = "SAGAX_S1_SITE_TOKEN";
export const S1_TIMEOUT_MS = 50_000;
export const S1_POLL_MS = 2_000;
export const TOKEN_MAX = 512;
export const PACKAGE_MISSING = "The SentinelOne package for this system is not configured.";
export const INSTALLING_PROBLEM = "SentinelOne protection is being installed";
export const TIMEOUT_ERROR = "SentinelOne did not report online before the time limit. Try again.";
export const TOKEN_LEFT_ERROR = "The site token was still in the virtual machine after install.";
export const INSTALL_FAILED = "The SentinelOne agent did not install.";

const GUEST_OS = new Set(["linux-deb", "linux-rpm", "windows", "macos"]);

/** Absent or any value other than false: a long-lived virtual machine. */
export function vmIsPersistent(target) {
  return !target || target.persistent !== false;
}

export function guestOs(value) {
  return GUEST_OS.has(value) ? value : "linux-deb";
}

/** A configured site token, or null. Empty, huge, or multi-line values are refused. */
export function readSiteToken(env = process.env) {
  const raw = env?.[S1_TOKEN_ENV];
  if (typeof raw !== "string") return null;
  if (/[\r\n\0]/.test(raw)) return null;
  const token = raw.trim();
  if (!token || token.length > TOKEN_MAX) return null;
  return token;
}

/** Install only for a persistent machine, with the organization switch on and a token set. */
export function protectionRequired({ persistent = true, enabled = true, token } = {}) {
  return persistent !== false && enabled !== false && typeof token === "string" && token.length > 0;
}

export function redactText(text, token) {
  const value = typeof text === "string" ? text : text == null ? "" : String(text);
  if (!token) return value;
  return value.split(token).join("[hidden]");
}

/** Online only when the agent says so, and never when it says it is offline. */
export function agentOnline(output) {
  const text = String(output ?? "").toLowerCase();
  if (!text.trim()) return false;
  if (/\boffline\b|\bnot connected\b|\bnot registered\b|\bdisconnected\b|\bunreachable\b/.test(text)) return false;
  return /\bonline\b|\bconnected\b/.test(text);
}

export function tokenPath(os) {
  if (guestOs(os) === "windows") return "C:\\Windows\\Temp\\sagax-s1.token";
  if (guestOs(os) === "macos") return "/private/tmp/sagax-s1.token";
  return "/run/sagax-s1.token";
}

export function packagePathFor(os, env = process.env) {
  const name = os === "linux-rpm" ? "SAGAX_S1_PACKAGE_RPM"
    : os === "windows" ? "SAGAX_S1_PACKAGE_MSI"
    : os === "macos" ? "SAGAX_S1_PACKAGE_PKG"
    : "SAGAX_S1_PACKAGE_DEB";
  const specific = env?.[name];
  const fallback = env?.SAGAX_S1_PACKAGE;
  const value = typeof specific === "string" && specific.trim() ? specific.trim()
    : typeof fallback === "string" ? fallback.trim() : "";
  return value || undefined;
}

function lastLine(text) {
  const lines = String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}

const REGISTER_PY = `python3 - "$TOKEN_FILE" "$CTL" "$VERB" <<'PY'
import pathlib, subprocess, sys
token = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").strip()
ctl, verb = sys.argv[2], sys.argv[3].split()
proc = subprocess.run([ctl, *verb, token], capture_output=True, text=True)
sys.stdout.write(proc.stdout or "")
sys.stderr.write(proc.stderr or "")
raise SystemExit(proc.returncode)
PY`;

function linuxFamily(os) {
  const file = tokenPath(os);
  const installPkg = os === "linux-rpm" ? 'rpm -U "$PKG"' : "DEBIAN_FRONTEND=noninteractive dpkg -i \"$PKG\"";
  const verb = "management token set";
  return {
    write: `umask 077; cat > ${file} && chmod 600 ${file}`,
    wipe: `rm -f ${file}`,
    env: "unset HISTFILE; env",
    probe: `#!/bin/sh
unset HISTFILE
CTL=/opt/sentinelone/bin/sentinelctl
if [ ! -x "$CTL" ]; then
  echo "not registered"
  exit 1
fi
"$CTL" management status 2>/dev/null || "$CTL" status
`,
    install: `#!/bin/sh
set -eu
unset HISTFILE
TOKEN_FILE=${file}
CTL=/opt/sentinelone/bin/sentinelctl
PKG="\${SAGAX_S1_PACKAGE:-}"
VERB="${verb}"
if [ ! -x "$CTL" ]; then
  if [ -z "$PKG" ] || [ ! -f "$PKG" ]; then
    echo "${PACKAGE_MISSING}" >&2
    exit 3
  fi
  ${installPkg}
fi
if [ ! -x "$CTL" ]; then
  echo "${INSTALL_FAILED}" >&2
  exit 4
fi
if ! "$CTL" $VERB - < "$TOKEN_FILE"; then
  ${REGISTER_PY}
fi
"$CTL" control start || true
rm -f "$TOKEN_FILE"
"$CTL" management status 2>/dev/null || "$CTL" status || true
`,
  };
}

function macosScripts() {
  const file = tokenPath("macos");
  return {
    write: `umask 077; cat > ${file} && chmod 600 ${file}`,
    wipe: `rm -f ${file}`,
    env: "unset HISTFILE; env",
    probe: `#!/bin/sh
unset HISTFILE
CTL=/Library/Sentinel/sentinelctl
if [ ! -x "$CTL" ]; then
  echo "not registered"
  exit 1
fi
"$CTL" status 2>/dev/null || "$CTL" management status
`,
    install: `#!/bin/sh
set -eu
unset HISTFILE
TOKEN_FILE=${file}
CTL=/Library/Sentinel/sentinelctl
PKG="\${SAGAX_S1_PACKAGE:-}"
VERB="set registration-token"
if [ ! -x "$CTL" ]; then
  if [ -z "$PKG" ] || [ ! -f "$PKG" ]; then
    echo "${PACKAGE_MISSING}" >&2
    exit 3
  fi
  installer -pkg "$PKG" -target /
fi
if [ ! -x "$CTL" ]; then
  echo "${INSTALL_FAILED}" >&2
  exit 4
fi
if ! "$CTL" $VERB - < "$TOKEN_FILE"; then
  ${REGISTER_PY}
fi
rm -f "$TOKEN_FILE"
"$CTL" status 2>/dev/null || "$CTL" management status || true
`,
  };
}

function windowsScripts() {
  const file = tokenPath("windows");
  return {
    write: `[IO.File]::WriteAllText('${file}', [Console]::In.ReadToEnd())`,
    wipe: `Remove-Item -LiteralPath '${file}' -Force -ErrorAction SilentlyContinue`,
    env: "Get-ChildItem Env: | ForEach-Object { $_.Name + '=' + $_.Value }",
    probe: `$ctl = Get-ChildItem -Path 'C:\\Program Files\\SentinelOne' -Filter SentinelCtl.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ctl) { Write-Output 'not registered'; exit 1 }
& $ctl.FullName status`,
    install: `$ErrorActionPreference = 'Stop'
$tokenFile = '${file}'
$pkg = $env:SAGAX_S1_PACKAGE
$ctl = Get-ChildItem -Path 'C:\\Program Files\\SentinelOne' -Filter SentinelCtl.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ctl) {
  if (-not $pkg -or -not (Test-Path -LiteralPath $pkg)) {
    Write-Error '${PACKAGE_MISSING}'
    exit 3
  }
  $site = [IO.File]::ReadAllText($tokenFile).Trim()
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'msiexec.exe'
  $psi.Arguments = '/i "' + $pkg + '" /qn /norestart SITE_TOKEN=' + $site
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $proc = [Diagnostics.Process]::Start($psi)
  $proc.WaitForExit()
  Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
  if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) { exit $proc.ExitCode }
  $ctl = Get-ChildItem -Path 'C:\\Program Files\\SentinelOne' -Filter SentinelCtl.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $ctl) { Write-Error '${INSTALL_FAILED}'; exit 4 }
Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
& $ctl.FullName status`,
  };
}

export function guestScripts(os) {
  const system = guestOs(os);
  if (system === "windows") return windowsScripts();
  if (system === "macos") return macosScripts();
  return linuxFamily(system);
}

export function writeScript(os) { return guestScripts(os).write; }
export function wipeScript(os) { return guestScripts(os).wipe; }
export function envScript(os) { return guestScripts(os).env; }
export function probeScript(os) { return guestScripts(os).probe; }
export function installScript(os) { return guestScripts(os).install; }

/**
 * Arguments for `runtime exec` that carry a script. Throws when the token
 * would ride on the command line or in a guest environment variable.
 * `stdin` is not an argument: the caller writes the token there, for the
 * file step only.
 */
export function guestExecArgv({ runtime = "docker", container, os, script, env, token } = {}) {
  if (typeof script !== "string" || !script) throw new Error("missing guest script");
  if (typeof token === "string" && token && script.includes(token)) {
    throw new Error("refusing to pass the site token on the command line");
  }
  const args = [runtime, "exec", "-i"];
  for (const [key, value] of Object.entries(env ?? {})) {
    if (/token|secret|password/i.test(key)) throw new Error("refusing to pass a secret variable into the virtual machine");
    if (typeof token === "string" && token && String(value).includes(token)) {
      throw new Error("refusing to pass the site token into the virtual machine environment");
    }
    args.push("-e", `${key}=${value}`);
  }
  if (!container || /[\r\n\0]/.test(container)) throw new Error("missing virtual machine");
  args.push(container);
  if (guestOs(os) === "windows") args.push("powershell", "-NoProfile", "-Command", script);
  else args.push("sh", "-c", script);
  if (typeof token === "string" && token && args.some((part) => String(part).includes(token))) {
    throw new Error("refusing to pass the site token on the command line");
  }
  return args;
}

/** A guest reached by `exec({ argv, stdin })`. The token is stdin of the write step only. */
export function commandGuestTransport({ os, token, container, runtime = "docker", exec }) {
  const system = guestOs(os);
  const run = async (script, extra = {}) => {
    const argv = guestExecArgv({ runtime, container, os: system, script, env: extra.env, token });
    const answer = await exec({ argv, stdin: extra.stdin, kind: extra.kind, script });
    return {
      code: answer?.code ?? 0,
      stdout: answer?.stdout ?? "",
      stderr: answer?.stderr ?? "",
      argv,
    };
  };
  return {
    writeToken(contents) {
      return run(writeScript(system), { stdin: contents, kind: "write" }).then(() => undefined);
    },
    run(script, env) {
      return run(script, { env, kind: "run" });
    },
    wipe() {
      return run(wipeScript(system), { kind: "wipe" }).then(() => undefined);
    },
    async environment() {
      const answer = await run(envScript(system), { kind: "env" });
      return `${answer.stdout}\n${answer.stderr}`;
    },
  };
}

export function publicProtection(result) {
  if (!result) return null;
  const out = { state: result.state };
  if (result.error) out.error = result.error;
  if (result.code) out.code = result.code;
  return out;
}

/**
 * Probe, install once, poll until the agent is online or the time limit
 * passes. The token file is removed in every outcome.
 */
export async function runSentinelOneInstall({
  transport, token, os = "linux-deb", timeoutMs = S1_TIMEOUT_MS, pollMs = S1_POLL_MS,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), packagePath,
} = {}) {
  const system = guestOs(os);
  try {
    const probe = await transport.run(probeScript(system));
    if (probe.code === 0 && agentOnline(`${probe.stdout}\n${probe.stderr}`)) {
      return { state: "active", audited: false };
    }
    await transport.writeToken(token);
    const started = now();
    const env = packagePath ? { SAGAX_S1_PACKAGE: packagePath } : undefined;
    const install = await transport.run(installScript(system), env);
    const installText = `${install.stdout}\n${install.stderr}`;
    if (install.code !== 0 && !agentOnline(installText)) {
      const line = redactText(lastLine(install.stderr || install.stdout) || INSTALL_FAILED, token);
      const code = installText.includes(PACKAGE_MISSING) ? "package_missing" : "install_failed";
      return { state: "failed", error: line.slice(0, 300), code, audited: true };
    }
    while (now() - started < timeoutMs) {
      const envText = await transport.environment();
      if (token && envText.includes(token)) {
        return { state: "failed", error: TOKEN_LEFT_ERROR, code: "token_left", audited: true };
      }
      const status = await transport.run(probeScript(system));
      const out = `${status.stdout}\n${status.stderr}`;
      if (token && out.includes(token)) {
        return { state: "failed", error: redactText(lastLine(out), token).slice(0, 300), code: "install_failed", audited: true };
      }
      if (agentOnline(out)) return { state: "active", audited: true };
      const wait = Math.min(pollMs, timeoutMs - (now() - started));
      if (wait <= 0) break;
      await sleep(wait);
    }
    return { state: "failed", error: TIMEOUT_ERROR, code: "timeout", audited: true };
  } catch (error) {
    const message = redactText(error instanceof Error ? error.message : String(error), token).slice(0, 300);
    return { state: "failed", error: message || INSTALL_FAILED, code: "install_failed", audited: true };
  } finally {
    try { await transport.wipe(); } catch { /* the outcome is already decided */ }
  }
}
