import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkChromeLaunch, chromeLaunchArgs } from "./chrome-launch-check.mjs";

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// A fake chrome: a shell script that reads --user-data-dir like Chrome does.
function fakeChrome(body) {
  const dir = mkdtempSync(join(tmpdir(), "fake-chrome-"));
  dirs.push(dir);
  const path = join(dir, "chrome");
  writeFileSync(path, `#!/bin/sh
for a in "$@"; do case "$a" in --user-data-dir=*) profile="\${a#--user-data-dir=}";; esac; done
mkdir -p "$profile"
${body}
`, { mode: 0o755 });
  return path;
}

const CRASHPAD_FATAL = "[13:13:1015/185954.486399:FATAL:third_party/crashpad/crashpad/util/posix/spawn_subprocess.cc:231] posix_spawn /opt/chrome/chrome_crashpad_handler: Permission denied (13)";

// The fake Chrome is a /bin/sh script, and the check guards the Linux image's
// Chrome: Windows cannot spawn a shell script, so those cases are POSIX only.
const posixOnly = it.skipIf(process.platform === "win32");

describe("chrome launch check", () => {
  it("launches headless with a fresh profile and DevTools on a free port", () => {
    const args = chromeLaunchArgs("/tmp/p");
    expect(args).toEqual(expect.arrayContaining(["--headless=new", "--no-sandbox", "--remote-debugging-port=0", "--user-data-dir=/tmp/p"]));
  });

  posixOnly("passes when Chrome writes DevToolsActivePort and logs no FATAL", async () => {
    const chrome = fakeChrome(`printf '41655\\n/devtools/browser/x\\n' > "$profile/DevToolsActivePort"\nexec sleep 30`);
    await expect(checkChromeLaunch(chrome, { timeoutMs: 5_000, settleMs: 100 })).resolves.toEqual({ port: 41655 });
  });

  posixOnly("fails on the crash handler FATAL even when DevToolsActivePort is written", async () => {
    const chrome = fakeChrome(`echo '${CRASHPAD_FATAL}' >&2\nprintf '41655\\n' > "$profile/DevToolsActivePort"\nexec sleep 30`);
    await expect(checkChromeLaunch(chrome, { timeoutMs: 5_000, settleMs: 100 })).rejects.toThrow(/FATAL.*chrome_crashpad_handler: Permission denied/);
  });

  posixOnly("fails when Chrome exits before writing DevToolsActivePort", async () => {
    const chrome = fakeChrome("exit 1");
    await expect(checkChromeLaunch(chrome, { timeoutMs: 5_000, settleMs: 100 })).rejects.toThrow(/exited \(1\) before writing DevToolsActivePort/);
  });

  posixOnly("fails when Chrome never writes DevToolsActivePort", async () => {
    const chrome = fakeChrome("exec sleep 30");
    await expect(checkChromeLaunch(chrome, { timeoutMs: 300, settleMs: 100 })).rejects.toThrow(/timed out after 300 ms/);
  });
});
