// The generic security-agent hook for persistent local VMs, against a fake guest.
import assert from "node:assert/strict";
import test from "node:test";

import { checksumMatches, readHookConfig, redact, runProtectionHook, sha256Hex, vmIsPersistent } from "./vm-protection-hook.mjs";

const PKG = Buffer.from("example installer bytes");
const SUM = sha256Hex(PKG);
const SECRET = "enroll-abc123";
const files = { "/h/install.sh": Buffer.from("install"), "/h/health.sh": Buffer.from("health"), "/h/rollback.sh": Buffer.from("rollback"), "/h/agent.deb": PKG };
const readHostFile = async (p) => { if (!(p in files)) throw new Error(`missing ${p}`); return files[p]; };

function fakeGuest({ install = 0, health = [0], rollback = 0, keepSecret = false } = {}) {
  const log = [];
  const fs = new Map();
  let h = 0;
  return {
    log, fs,
    async writeFile(path, bytes, { mode }) { fs.set(path, { bytes, mode }); log.push(`write ${path}`); },
    async exec(cmd, opts = {}) {
      log.push(cmd);
      if (cmd.startsWith("umask 077; cat >")) { fs.set(cmd.split("> ")[1], { bytes: opts.stdin }); return { code: 0 }; }
      if (cmd.startsWith("rm -f")) { if (!keepSecret) fs.delete(cmd.slice(6)); return { code: 0 }; }
      if (cmd.startsWith("test -e")) return { code: fs.has(cmd.slice(8)) ? 0 : 1 };
      if (cmd.endsWith("install.sh")) return { code: install, stdout: `installed with ${SECRET}`, stderr: "" };
      if (cmd.endsWith("health.sh")) { const c = health[Math.min(h++, health.length - 1)]; return { code: c, stdout: c ? "not ready" : "ok" }; }
      if (cmd.endsWith("rollback.sh")) return { code: rollback, stdout: "removed" };
      return { code: 0 };
    },
  };
}

const ENV = {
  SAGAX_VM_AGENT_INSTALL_SCRIPT: "/h/install.sh",
  SAGAX_VM_AGENT_HEALTH_SCRIPT: "/h/health.sh",
  SAGAX_VM_AGENT_ROLLBACK_SCRIPT: "/h/rollback.sh",
  SAGAX_VM_AGENT_PACKAGE: "/h/agent.deb",
  SAGAX_VM_AGENT_PACKAGE_SHA256: SUM,
  SAGAX_VM_AGENT_SECRET: SECRET,
};
const opts = (guest, env = ENV, extra = {}) => ({ guest, env, readHostFile, sleep: async () => {}, pollMs: 1, ...extra });

test("config: off without an install script; package requires a valid checksum; multi-line secret refused", () => {
  assert.deepEqual(readHookConfig({}), { enabled: false });
  assert.match(readHookConfig({ SAGAX_VM_AGENT_INSTALL_SCRIPT: "/x", SAGAX_VM_AGENT_PACKAGE: "/p" }).error, /SHA256/);
  assert.match(readHookConfig({ SAGAX_VM_AGENT_INSTALL_SCRIPT: "/x", SAGAX_VM_AGENT_PACKAGE_SHA256: "zz" }).error, /digest/);
  assert.match(readHookConfig({ SAGAX_VM_AGENT_INSTALL_SCRIPT: "/x", SAGAX_VM_AGENT_SECRET: "a\nb" }).error, /single line/);
  const c = readHookConfig(ENV);
  assert.equal(c.enabled, true);
  assert.equal(c.timeoutMs, 60_000);
});

test("checksum and redaction helpers", () => {
  assert.equal(checksumMatches(PKG, SUM.toUpperCase()), true);
  assert.equal(checksumMatches(Buffer.from("tampered"), SUM), false);
  assert.equal(checksumMatches(PKG, undefined), false);
  assert.equal(redact(`x ${SECRET} y`, SECRET), "x [hidden] y");
  assert.equal(vmIsPersistent(undefined), true);
  assert.equal(vmIsPersistent({ persistent: false }), false);
});

test("skips ephemeral machines and unconfigured hosts without touching the guest", async () => {
  const g = fakeGuest();
  assert.equal((await runProtectionHook(opts(g, ENV, { target: { persistent: false } }))).status, "skipped");
  assert.equal((await runProtectionHook(opts(g, {}))).status, "skipped");
  assert.equal(g.log.length, 0);
});

test("happy path: package verified and copied, secret written then wiped, health ok, output redacted", async () => {
  const g = fakeGuest({ health: [1, 1, 0] });
  const r = await runProtectionHook(opts(g));
  assert.equal(r.status, "healthy");
  assert.ok(g.fs.has("/run/sagax-vm-agent/agent.deb"));
  assert.equal(g.fs.has("/run/sagax-vm-agent/enroll.secret"), false);
  assert.ok(!g.log.some((l) => l.includes(SECRET)), "secret never in a command line");
});

test("checksum mismatch stops before anything is installed", async () => {
  const g = fakeGuest();
  const r = await runProtectionHook(opts(g, { ...ENV, SAGAX_VM_AGENT_PACKAGE_SHA256: "0".repeat(64) }));
  assert.deepEqual([r.status, r.step], ["failed", "checksum"]);
  assert.ok(!g.log.some((l) => l.endsWith("install.sh")));
});

test("install failure runs rollback and redacts the secret from detail", async () => {
  const g = fakeGuest({ install: 2 });
  const r = await runProtectionHook(opts(g));
  assert.deepEqual([r.status, r.step], ["rolled-back", "install"]);
  assert.ok(!r.detail.includes(SECRET));
  assert.ok(g.log.some((l) => l.endsWith("rollback.sh")));
});

test("health timeout rolls back; failed rollback is reported as failed", async () => {
  let t = 0;
  const now = () => (t += 10);
  const g = fakeGuest({ health: [1], rollback: 1 });
  const r = await runProtectionHook(opts(g, { ...ENV, SAGAX_VM_AGENT_TIMEOUT_MS: "50" }, { now }));
  assert.deepEqual([r.status, r.step], ["failed", "health"]);
  assert.match(r.detail, /Rollback failed/);
});

test("a secret left behind in the guest triggers rollback", async () => {
  const g = fakeGuest({ keepSecret: true });
  const r = await runProtectionHook(opts(g));
  assert.deepEqual([r.status, r.step], ["rolled-back", "secret"]);
});
